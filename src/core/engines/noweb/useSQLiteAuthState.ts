import type {
  AuthenticationCreds,
  AuthenticationState,
} from '@adiwajshing/baileys';
import { readdir, readFile, rename, stat } from 'fs/promises';
import { join } from 'path';
import type Knex from 'knex';
import esm from '@waha/vendor/esm';

const AUTH_STATE_TABLE = 'noweb_auth_state';
const AUTH_BACKUP_TABLE = 'noweb_auth_backup';

const CREDS_CATEGORY = 'creds';
const CREDS_ID = 'creds';

const MAX_BACKUPS = 5;
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

function stringify(data: any): string {
  return JSON.stringify(data, esm.b.BufferJSON.replacer);
}

function parse(raw: string): any {
  return JSON.parse(raw, esm.b.BufferJSON.reviver);
}

async function ensureTables(knex: Knex.Knex): Promise<void> {
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

async function deleteRow(
  knex: Knex.Knex,
  session: string,
  category: string,
  id: string,
): Promise<void> {
  await knex(AUTH_STATE_TABLE).where({ session, category, id }).delete();
}

/**
 * Migrate credentials from the legacy file-based auth folder into SQLite.
 * On success, renames the folder to "{folder}.migrated" as a backup.
 * Safe to call even if migration has already been done.
 */
export async function migrateFromFiles(
  knex: Knex.Knex,
  session: string,
  folder: string,
  logger?: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<void> {
  const folderStat = await stat(folder).catch(() => null);
  if (!folderStat?.isDirectory()) return;

  // Check if there's already data in SQLite for this session
  const existing = await knex(AUTH_STATE_TABLE)
    .where({ session })
    .count({ count: '*' })
    .first();
  if (existing && parseInt(String(existing.count), 10) > 0) return;

  const files = await readdir(folder).catch(() => [] as string[]);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  if (jsonFiles.length === 0) return;

  logger?.info(`Migrating ${jsonFiles.length} auth files from ${folder} to SQLite for session '${session}'`);

  const rows: Array<{ session: string; category: string; id: string; data: string }> = [];

  for (const file of jsonFiles) {
    try {
      const raw = await readFile(join(folder, file), 'utf-8');
      const data = JSON.parse(raw, esm.b.BufferJSON.reviver);

      let category: string;
      let id: string;

      if (file === 'creds.json') {
        category = CREDS_CATEGORY;
        id = CREDS_ID;
      } else {
        // Files are named like "pre-key-123.json" or "app-state-sync-key-abc.json"
        // Strip the .json extension, then split on the last dash to get type + id
        const name = file.slice(0, -5); // remove ".json"
        // The original fixFileName replaces "/" with "__" and ":" with "-"
        // Reverse: replace "__" with "/" and the LAST occurrence pattern back
        // Key format from Baileys: "{type}-{id}" where type can contain dashes
        // We store as category = type, id = id
        const underscoreIdx = name.indexOf('__');
        if (underscoreIdx !== -1) {
          category = name.slice(0, underscoreIdx).replace(/__/g, '/').replace(/-/g, ':');
          id = name.slice(underscoreIdx + 2);
        } else {
          // Find last separator by known Baileys key types
          const knownTypes = [
            'pre-key',
            'session',
            'sender-key',
            'sender-key-memory',
            'app-state-sync-key',
            'app-state-sync-version',
          ];
          let matched = false;
          for (const type of knownTypes) {
            if (name.startsWith(type + '-')) {
              category = type;
              id = name.slice(type.length + 1);
              matched = true;
              break;
            }
          }
          if (!matched) {
            logger?.warn(`Skipping unknown auth file during migration: ${file}`);
            continue;
          }
        }
      }

      rows.push({
        session,
        category,
        id,
        data: stringify(data),
      });
    } catch {
      logger?.warn(`Failed to read auth file during migration: ${file}`);
    }
  }

  if (rows.length > 0) {
    // Insert all rows in a single transaction
    await knex.transaction(async (trx) => {
      for (const row of rows) {
        await trx.raw(
          `INSERT INTO "${AUTH_STATE_TABLE}" (session, category, id, data)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(session, category, id) DO UPDATE SET data = excluded.data`,
          [row.session, row.category, row.id, row.data],
        );
      }
    });
  }

  // Rename old folder as backup
  try {
    await rename(folder, `${folder}.migrated`);
    logger?.info(`Renamed auth folder to ${folder}.migrated after successful migration`);
  } catch {
    logger?.warn(`Could not rename auth folder ${folder} after migration`);
  }
}

/**
 * Validate that stored credentials are structurally sound.
 * Returns true if creds look valid for use.
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
 * Attempt to recover credentials from the backup table.
 * Returns the most recent valid backup, or null if none found.
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
    } catch {
      // corrupt backup, try next
    }
  }
  return null;
}

/**
 * Take a credential snapshot into the backup table.
 * Keeps at most MAX_BACKUPS snapshots per session (rotating oldest).
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

  // Rotate: delete old snapshots beyond MAX_BACKUPS
  const oldest = await knex(AUTH_BACKUP_TABLE)
    .where({ session })
    .orderBy('snapshot_time', 'desc')
    .offset(MAX_BACKUPS)
    .select('id');

  if (oldest.length > 0) {
    const ids = oldest.map((r) => r.id);
    await knex(AUTH_BACKUP_TABLE).whereIn('id', ids).delete();
  }
}

/**
 * SQLite-backed authentication state for Baileys.
 *
 * Replaces useMultiFileAuthState for production use. Uses the existing
 * waha.sqlite3 database (via the Knex instance from LocalStoreCore) to store
 * credentials atomically, eliminating file-based race conditions.
 *
 * Features:
 * - ACID transactions: no partial credential writes
 * - Automatic migration from file-based auth (no QR re-scan required)
 * - Periodic credential backup with integrity validation
 * - Same interface as useMultiFileAuthState
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
  close: () => Promise<void>;
}> => {
  const log = opts?.logger;

  await ensureTables(knex);

  // Migrate from file-based auth if needed
  if (opts?.migrateFromFolder) {
    await migrateFromFiles(knex, session, opts.migrateFromFolder, log);
  }

  // Load credentials
  let creds = await readRow(knex, session, CREDS_CATEGORY, CREDS_ID) as AuthenticationCreds | null;

  if (!validateCreds(creds)) {
    if (creds !== null) {
      log?.warn(`Credentials for session '${session}' failed integrity check, attempting backup recovery`);
      const recovered = await recoverFromBackup(knex, session, log);
      if (recovered) {
        creds = recovered;
        // Persist the recovered creds immediately
        await writeRow(knex, session, CREDS_CATEGORY, CREDS_ID, creds);
      } else {
        log?.warn(`No valid backup found for session '${session}', starting fresh`);
        creds = null;
      }
    }
  }

  // Fall back to fresh credentials (will trigger QR scan)
  if (!creds) {
    creds = esm.b.initAuthCreds();
  }

  // Periodic credential backup
  let backupTimer: ReturnType<typeof setInterval> | null = setInterval(async () => {
    try {
      await snapshotCreds(knex, session, creds);
    } catch {
      // Non-fatal: backup failure should not affect session operation
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
              const value = await readRow(knex, session, type, id);
              if (type === 'app-state-sync-key' && value) {
                data[id] = esm.b.proto.Message.AppStateSyncKeyData.create(value);
              } else {
                data[id] = value;
              }
            }),
          );
          return data;
        },
        set: async (data) => {
          await knex.transaction(async (trx) => {
            for (const category in data) {
              for (const id in data[category]) {
                const value = data[category][id];
                if (value) {
                  await trx.raw(
                    `INSERT INTO "${AUTH_STATE_TABLE}" (session, category, id, data)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(session, category, id) DO UPDATE SET data = excluded.data`,
                    [session, category, id, stringify(value)],
                  );
                } else {
                  await trx(AUTH_STATE_TABLE)
                    .where({ session, category, id })
                    .delete();
                }
              }
            }
          });
        },
      },
    },
    saveCreds: async () => {
      await writeRow(knex, session, CREDS_CATEGORY, CREDS_ID, creds);
    },
    close: async () => {
      if (backupTimer) {
        clearInterval(backupTimer);
        backupTimer = null;
      }
    },
  };
};
