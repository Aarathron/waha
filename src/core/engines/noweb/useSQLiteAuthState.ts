import type {
  AuthenticationCreds,
  AuthenticationState,
} from '@adiwajshing/baileys';
import { readdir, readFile, rename, stat } from 'fs/promises';
import { join } from 'path';
import type Knex from 'knex';
import esm from '@waha/vendor/esm';

export const AUTH_STATE_TABLE = 'noweb_auth_state';
export const AUTH_BACKUP_TABLE = 'noweb_auth_backup';

const CREDS_CATEGORY = 'creds';
const CREDS_ID = 'creds';

const MAX_BACKUPS = 5;
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * All Baileys key type names, longest-prefix-first so startsWith matching is unambiguous.
 * These are exactly the strings Baileys passes as the `type` argument to keys.get/set.
 */
const KNOWN_KEY_TYPES = [
  'app-state-sync-key',
  'app-state-sync-version',
  'sender-key-memory',
  'sender-key',
  'pre-key',
  'session',
];

/**
 * Key types whose IDs use '::' as a separator (encoded as '--' by fixFileName).
 * For these, we restore double-dashes to double-colons during migration.
 * Single dashes in JIDs (e.g. group IDs like "123456789-0@g.us") are left intact.
 */
const DOUBLE_COLON_ID_TYPES = new Set(['sender-key', 'sender-key-memory']);

/**
 * Key types whose IDs use a single ':' before a numeric device suffix.
 * Baileys session key IDs have the form "{jid}:{deviceId}" (e.g.
 * "1234567890@s.whatsapp.net:0"). fixFileName encodes ':' as '-', producing
 * "1234567890@s.whatsapp.net-0" on disk. We reverse this by replacing the
 * trailing "-{digits}" back to ":{digits}".
 * Phone/LID JIDs don't contain dashes, so this reversal is unambiguous.
 */
const DEVICE_SUFFIX_ID_TYPES = new Set(['session']);

function stringify(data: any): string {
  return JSON.stringify(data, esm.b.BufferJSON.replacer);
}

function parse(raw: string): any {
  return JSON.parse(raw, esm.b.BufferJSON.reviver);
}

// Tracks which Knex instances have already had tables created so session
// restarts don't pay 3 DDL round-trips every time.
const _tablesEnsured = new WeakSet<Knex.Knex>();

async function ensureTables(knex: Knex.Knex): Promise<void> {
  if (_tablesEnsured.has(knex)) return;
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS "${AUTH_STATE_TABLE}" (
      session TEXT NOT NULL,
      category TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (session, category, id)
    )
  `);
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS "${AUTH_BACKUP_TABLE}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session TEXT NOT NULL,
      snapshot_time INTEGER NOT NULL,
      data TEXT NOT NULL
    )
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS "idx_noweb_auth_backup_session_time"
    ON "${AUTH_BACKUP_TABLE}" (session, snapshot_time)
  `);
  _tablesEnsured.add(knex);
}

async function readRow(
  knex: Knex.Knex,
  session: string,
  category: string,
  id: string,
): Promise<any | null> {
  const row = await knex(AUTH_STATE_TABLE)
    .where({ session, category, id })
    .first();
  if (!row) return null;
  return parse(row.data);
}

async function writeRow(
  knex: Knex.Knex,
  session: string,
  category: string,
  id: string,
  data: any,
): Promise<void> {
  const raw = stringify(data);
  await knex.raw(
    `INSERT INTO "${AUTH_STATE_TABLE}" (session, category, id, data)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session, category, id) DO UPDATE SET data = excluded.data`,
    [session, category, id, raw],
  );
}

/**
 * Decode a filename (without extension) back to (category, id).
 *
 * Baileys' fixFileName encodes:
 *   '/' in IDs  → '__'  (double underscore)
 *   ':' in IDs  → '-'   (single dash)
 *
 * We reverse these transformations carefully:
 * - Use KNOWN_KEY_TYPES to identify the category prefix unambiguously.
 * - Reverse '__' → '/' in the id (unambiguous: the type names contain no '__').
 * - For sender-key types only, reverse '--' → '::' in the id. These types use
 *   '::' as a separator (e.g. "group@g.us::device::0"), and group JIDs may
 *   contain a single '-' (e.g. "1234-5678@g.us") so a blanket '-'→':' reversal
 *   would corrupt them.
 *
 * Returns null for unrecognised filenames.
 */
function decodeAuthFilename(name: string): { category: string; id: string } | null {
  for (const type of KNOWN_KEY_TYPES) {
    const prefix = type + '-';
    if (name.startsWith(prefix)) {
      let id = name.slice(prefix.length);
      // Reverse '/' encoding: '__' → '/' (unambiguous — type names never contain '__')
      id = id.replace(/__/g, '/');
      // Reverse '::' separator for sender-key types: '--' → '::'
      // (single dashes in group JIDs like "123456789-0@g.us" are left intact)
      if (DOUBLE_COLON_ID_TYPES.has(type)) {
        id = id.replace(/--/g, '::');
      }
      // Reverse ':' device suffix for session keys: trailing '-{digits}' → ':{digits}'
      // (phone/LID JIDs don't contain dashes, so this is unambiguous)
      if (DEVICE_SUFFIX_ID_TYPES.has(type)) {
        id = id.replace(/-(\d+)$/, ':$1');
      }
      return { category: type, id };
    }
  }
  return null;
}

/**
 * Migrate credentials from the legacy file-based auth folder into SQLite.
 *
 * On success, renames the folder to "{folder}.migrated" as a backup.
 * Idempotent: skips silently if the session already has rows in SQLite.
 *
 * If creds.json is unreadable, migration is aborted entirely so the original
 * folder is preserved for manual recovery. Non-critical key files that fail
 * to parse are skipped with a warning.
 *
 * Note: if a previous migration was interrupted after partial writes, the
 * remaining files will not be retried (the row-count guard fires early).
 */
export async function migrateFromFiles(
  knex: Knex.Knex,
  session: string,
  folder: string,
  logger?: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<void> {
  const folderStat = await stat(folder).catch(() => null);
  if (!folderStat?.isDirectory()) return;

  const existing = await knex(AUTH_STATE_TABLE)
    .where({ session })
    .count({ count: '*' })
    .first();
  if (Number(existing?.count) > 0) return;

  const files = await readdir(folder).catch(() => [] as string[]);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  if (jsonFiles.length === 0) return;

  logger?.info(
    `Migrating ${jsonFiles.length} auth files from ${folder} to SQLite for session '${session}'`,
  );

  const rows: Array<{ session: string; category: string; id: string; data: any }> = [];

  for (const file of jsonFiles) {
    if (file === 'creds.json') {
      // creds.json is critical — abort the entire migration if it can't be read
      // so the source folder is not renamed and can be recovered manually.
      let data: any;
      try {
        const raw = await readFile(join(folder, file), 'utf-8');
        data = JSON.parse(raw, esm.b.BufferJSON.reviver);
      } catch (err: any) {
        logger?.warn(
          `creds.json is unreadable during migration for session '${session}': ${err?.message ?? String(err)}. Aborting migration to preserve source folder.`,
        );
        return;
      }
      rows.push({ session, category: CREDS_CATEGORY, id: CREDS_ID, data });
      continue;
    }

    // Non-critical key files — skip individually on failure
    try {
      const raw = await readFile(join(folder, file), 'utf-8');
      const data = JSON.parse(raw, esm.b.BufferJSON.reviver);
      const name = file.slice(0, -5); // strip ".json"
      const decoded = decodeAuthFilename(name);
      if (!decoded) {
        logger?.warn(`Skipping unrecognised auth file during migration: ${file}`);
        continue;
      }
      rows.push({ session, category: decoded.category, id: decoded.id, data });
    } catch {
      logger?.warn(`Failed to read auth file during migration: ${file}`);
    }
  }

  const skipped = jsonFiles.length - rows.length;
  if (skipped > 0) {
    logger?.warn(
      `Migration for session '${session}': ${rows.length}/${jsonFiles.length} files migrated, ${skipped} skipped.`,
    );
  }

  if (rows.length === 0) {
    logger?.warn(
      `Migration for session '${session}': no rows to insert, leaving source folder intact.`,
    );
    return;
  }

  await knex.transaction(async (trx) => {
    for (const row of rows) {
      await writeRow(trx, row.session, row.category, row.id, row.data);
    }
  });

  try {
    await rename(folder, `${folder}.migrated`);
    logger?.info(
      `Renamed auth folder to ${folder}.migrated — migration complete (${rows.length} entries).`,
    );
  } catch {
    logger?.warn(`Could not rename auth folder ${folder} after migration`);
  }
}

/**
 * Validate that stored credentials are structurally sound.
 * Checks the most session-critical fields; does not guarantee all
 * Baileys-required fields (e.g. noiseKey, signedIdentityKey) are present.
 */
export function validateCreds(creds: AuthenticationCreds | null): boolean {
  if (!creds) return false;
  if (!creds.me) return false;
  if (!creds.registrationId || creds.registrationId <= 0) return false;
  if (!creds.signedPreKey) return false;
  if (!creds.advSecretKey) return false;
  return true;
}

/**
 * Scans up to MAX_BACKUPS most recent snapshots and returns the first that
 * passes validateCreds, or null if none is found.
 */
async function recoverFromBackup(
  knex: Knex.Knex,
  session: string,
  logger?: { warn: (msg: string) => void },
): Promise<AuthenticationCreds | null> {
  const backups = await knex(AUTH_BACKUP_TABLE)
    .where({ session })
    .orderBy('snapshot_time', 'desc')
    .limit(MAX_BACKUPS)
    .select();

  for (const backup of backups) {
    try {
      const creds = parse(backup.data) as AuthenticationCreds;
      if (validateCreds(creds)) {
        logger?.warn(
          `Recovered credentials from backup (snapshot_time=${backup.snapshot_time}) for session '${session}'`,
        );
        return creds;
      }
    } catch (err: any) {
      logger?.warn(
        `Backup entry id=${backup.id} snapshot_time=${backup.snapshot_time} for session '${session}' is corrupt (${err?.message ?? String(err)}), trying next`,
      );
    }
  }
  return null;
}

/**
 * Snapshot current credentials into the backup table, keeping at most
 * MAX_BACKUPS per session (oldest are rotated out).
 */
async function snapshotCreds(
  knex: Knex.Knex,
  session: string,
  creds: AuthenticationCreds,
): Promise<void> {
  const now = Date.now();
  await knex(AUTH_BACKUP_TABLE).insert({
    session,
    snapshot_time: now,
    data: stringify(creds),
  });

  // Delete backups beyond the MAX_BACKUPS most recent in a single round-trip
  await knex.raw(
    `DELETE FROM "${AUTH_BACKUP_TABLE}" WHERE session = ? AND id NOT IN (
       SELECT id FROM "${AUTH_BACKUP_TABLE}" WHERE session = ? ORDER BY snapshot_time DESC LIMIT ?
     )`,
    [session, session, MAX_BACKUPS],
  );
}

/**
 * SQLite-backed authentication state for Baileys.
 *
 * Replaces useMultiFileAuthState for production use. Uses the existing
 * waha.sqlite3 database (via the Knex instance from LocalStoreCore) to store
 * credentials atomically, eliminating file-based race conditions.
 *
 * Features:
 * - Atomic single-statement writes for credentials; transactional batch writes
 *   for multi-key updates — no partial credential writes
 * - Automatic migration from file-based auth on first run (no QR re-scan required)
 * - Integrity check at startup with automatic recovery from the most recent valid backup
 * - Periodic credential backup every 6 hours (rotating, last 5 snapshots retained)
 * - Same interface as useMultiFileAuthState
 *
 * close() cancels the backup timer only; the Knex connection lifecycle is
 * managed externally by LocalStoreCore. Callers must invoke close() on all
 * exit paths to prevent the timer from firing against a destroyed connection.
 */
export const useSQLiteAuthState = async (
  knex: Knex.Knex,
  session: string,
  opts?: {
    logger?: {
      info: (msg: string) => void;
      warn: (msg: string) => void;
      error: (msg: string) => void;
    };
    /** Folder to migrate from (file-based auth). Only used once, on first run. */
    migrateFromFolder?: string;
  },
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clear: () => Promise<void>;
  close: () => Promise<void>;
}> => {
  const log = opts?.logger;

  await ensureTables(knex);

  if (opts?.migrateFromFolder) {
    await migrateFromFiles(knex, session, opts.migrateFromFolder, log);
  }

  let creds = (await readRow(
    knex,
    session,
    CREDS_CATEGORY,
    CREDS_ID,
  )) as AuthenticationCreds | null;

  if (!validateCreds(creds)) {
    if (creds !== null) {
      log?.warn(
        `Credentials for session '${session}' failed integrity check, attempting backup recovery`,
      );
      const recovered = await recoverFromBackup(knex, session, log);
      if (recovered) {
        creds = recovered;
        await writeRow(knex, session, CREDS_CATEGORY, CREDS_ID, creds);
      } else {
        log?.warn(`No valid backup found for session '${session}', starting fresh`);
        creds = null;
      }
    }
  }

  if (!creds) {
    creds = esm.b.initAuthCreds();
  }

  let backupTimer: ReturnType<typeof setInterval> | null = setInterval(async () => {
    try {
      await snapshotCreds(knex, session, creds);
    } catch (err: any) {
      // Non-fatal: a backup failure must not crash or interrupt session operation.
      // Log so operators can detect if backups have permanently stopped (e.g. DB full).
      log?.warn(
        `Credential backup failed for session '${session}': ${err?.message ?? String(err)}`,
      );
    }
  }, BACKUP_INTERVAL_MS);

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: Record<string, any> = {};
          await Promise.all(
            ids.map(async (id) => {
              try {
                const value = await readRow(knex, session, type, id);
                if (type === 'app-state-sync-key' && value) {
                  data[id] = esm.b.proto.Message.AppStateSyncKeyData.create(value);
                } else {
                  data[id] = value;
                }
              } catch (err: any) {
                log?.warn(
                  `Failed to read auth key type='${type}' id='${id}' for session '${session}': ${err?.message ?? String(err)}`,
                );
                data[id] = null;
              }
            }),
          );
          return data;
        },
        set: async (data) => {
          try {
            await knex.transaction(async (trx) => {
              for (const category in data) {
                for (const id in data[category]) {
                  const value = data[category][id];
                  if (value) {
                    await writeRow(trx, session, category, id, value);
                  } else {
                    await trx(AUTH_STATE_TABLE)
                      .where({ session, category, id })
                      .delete();
                  }
                }
              }
            });
          } catch (err: any) {
            log?.error(
              `CRITICAL: Failed to write auth keys for session '${session}': ${err?.message ?? String(err)}. Encryption state may be inconsistent.`,
            );
            throw err;
          }
        },
      },
    },
    saveCreds: async () => {
      await writeRow(knex, session, CREDS_CATEGORY, CREDS_ID, creds);
    },
    clear: async () => {
      await knex(AUTH_STATE_TABLE).where({ session }).delete();
      await knex(AUTH_BACKUP_TABLE).where({ session }).delete();
    },
    close: async () => {
      if (backupTimer) {
        clearInterval(backupTimer);
        backupTimer = null;
      }
    },
  };
};
