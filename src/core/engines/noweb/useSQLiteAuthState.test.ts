import Knex from 'knex';

// The real Baileys is ESM-only and cannot be dynamically imported under Jest.
// Mock the small `esm.b` surface useSQLiteAuthState relies on. Plain JSON
// (replacer/reviver = undefined) round-trips the non-Buffer fixtures below, and
// initAuthCreds returns an UNPAIRED creds object (no `me`) matching real behavior.
jest.mock('@waha/vendor/esm', () => ({
  __esModule: true,
  default: {
    b: {
      BufferJSON: { replacer: undefined, reviver: undefined },
      initAuthCreds: () => ({ registrationId: 1 }),
      proto: { Message: { AppStateSyncKeyData: { create: (v: any) => v } } },
    },
  },
  loadESMModules: jest.fn(),
}));

import {
  AUTH_BACKUP_TABLE,
  AUTH_STATE_TABLE,
  useSQLiteAuthState,
  validateCreds,
} from './useSQLiteAuthState';

// The creds row lives under category='creds', id='creds' (private constants in
// the module — stable identifiers, safe to reference directly in a test).
const CREDS_CATEGORY = 'creds';
const CREDS_ID = 'creds';

/** A minimal object that passes validateCreds (paired, plausible key material). */
function validPairedCreds(id = '123@s.whatsapp.net') {
  return {
    me: { id, name: 'Tester' },
    registrationId: 42,
    signedPreKey: { keyPair: { public: 'pub', private: 'priv' }, signature: 'sig', keyId: 1 },
    advSecretKey: 'adv-secret',
    noiseKey: { public: 'n-pub', private: 'n-priv' },
  };
}

function silentLogger() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined };
}

describe('useSQLiteAuthState — corrupt creds recovery', () => {
  let knex: Knex.Knex;
  const session = 'test-session';

  beforeEach(async () => {
    knex = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    // Materialize the tables via a first init.
    const state = await useSQLiteAuthState(knex, session, { logger: silentLogger() });
    await state.close();
  });

  afterEach(async () => {
    await knex.destroy();
  });

  it('validPairedCreds fixture is actually valid (guards the test itself)', () => {
    expect(validateCreds(validPairedCreds() as any)).toBe(true);
  });

  it('recovers from a valid backup when the creds row is truncated/corrupt JSON', async () => {
    // A valid snapshot exists in the backup table...
    await knex(AUTH_BACKUP_TABLE).insert({
      session,
      snapshot_time: Date.now(),
      data: JSON.stringify(validPairedCreds()),
    });
    // ...but the live creds row is corrupt (truncated JSON — the OOM/disk-full
    // mid-write scenario). Before the fix, parse() threw here and the whole
    // session start crashed into an infinite STARTING->FAILED loop.
    await knex(AUTH_STATE_TABLE).insert({
      session,
      category: CREDS_CATEGORY,
      id: CREDS_ID,
      data: '{"me":{"id":"123@s.whatsapp', // truncated, invalid JSON
    });

    const state = await useSQLiteAuthState(knex, session, { logger: silentLogger() });

    // It must NOT throw, and must return the recovered paired creds.
    expect(state.state.creds?.me?.id).toBe('123@s.whatsapp.net');
    expect(validateCreds(state.state.creds as any)).toBe(true);
    await state.close();
  });

  it('starts fresh (unpaired) when the creds row is corrupt and no backup exists', async () => {
    await knex(AUTH_STATE_TABLE).insert({
      session,
      category: CREDS_CATEGORY,
      id: CREDS_ID,
      data: 'not-json-at-all',
    });

    const state = await useSQLiteAuthState(knex, session, { logger: silentLogger() });

    // No backup to recover from → fresh creds (initAuthCreds), which are
    // unpaired (no `me`). Crucially the call SUCCEEDS instead of throwing.
    expect(state.state.creds).toBeTruthy();
    expect(state.state.creds?.me).toBeUndefined();
    await state.close();
  });
});
