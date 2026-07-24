import { EventEmitter } from 'events';

// Mock @adiwajshing/baileys before any imports that depend on it
jest.mock('@adiwajshing/baileys', () => ({
  __esModule: true,
  default: jest.fn(), // makeWASocket
  Browsers: {
    appropriate: jest.fn(),
    macOS: jest.fn().mockReturnValue(['Mac OS', 'Chrome', '14.4.1']),
    ubuntu: jest.fn(),
    windows: jest.fn(),
  },
  fetchLatestBaileysVersion: jest.fn(),
  DisconnectReason: {
    connectionClosed: 428,
    connectionLost: 408,
    connectionReplaced: 440,
    timedOut: 408,
    loggedOut: 401,
    badSession: 500,
    restartRequired: 515,
    multideviceMismatch: 411,
    forbidden: 403,
    unavailableService: 503,
  },
  makeCacheableSignalKeyStore: jest.fn((keys) => keys),
  proto: { Message: { create: jest.fn() } },
  normalizeMessageContent: jest.fn(),
  decryptPollVote: jest.fn(),
  jidNormalizedUser: jest.fn(),
  getContentType: jest.fn(),
  getKeyAuthor: jest.fn(),
  getAggregateVotesInPollMessage: jest.fn(),
  isPnUser: jest.fn(),
  isRealMessage: jest.fn(),
  extractMessageContent: jest.fn(),
  generateMessageIDV2: jest.fn(),
  downloadMediaMessage: jest.fn(),
  prepareWAMessageMedia: jest.fn(),
}));
jest.mock('@adiwajshing/baileys/lib/Types/Call', () => ({}));
jest.mock('@adiwajshing/baileys/lib/Types/Events', () => ({}));
jest.mock('@adiwajshing/baileys/lib/Types/GroupMetadata', () => ({}));
jest.mock('@adiwajshing/baileys/lib/Types/Label', () => ({}));
jest.mock('@adiwajshing/baileys/lib/Types/LabelAssociation', () => ({
  LabelAssociationType: {},
}));
jest.mock('@adiwajshing/baileys/lib/Types/Message', () => ({}));
jest.mock('@adiwajshing/baileys/lib/Utils/logger', () => ({}));
jest.mock('@adiwajshing/baileys/lib/WABinary/jid-utils', () => ({
  isLidUser: jest.fn(),
}));

// Mock other heavy dependencies that session.noweb.core.ts imports
jest.mock('node-cache', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    keys: jest.fn().mockReturnValue([]),
    flushAll: jest.fn(),
  }));
});
jest.mock('promise-retry', () => jest.fn());

import { WAHASessionStatus } from '@waha/structures/enums.dto';
import { UnprocessableEntityException } from '@nestjs/common';

import { WhatsappSessionNoWebCore } from './session.noweb.core';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockLogger() {
  const logger: any = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
  return logger;
}

function createMockSock() {
  return {
    ev: new EventEmitter(),
    ws: { removeAllListeners: jest.fn(), isConnecting: false },
    end: jest.fn(),
  };
}

function createMockStore() {
  return {
    bind: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    loadMessage: jest.fn().mockResolvedValue(null),
    init: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockMediaManager() {
  return { processMedia: jest.fn(), close: jest.fn() };
}

function createMockSessionStore() {
  return {
    init: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    getWAHADatabase: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Testable subclass
// ---------------------------------------------------------------------------

class TestableNoWebSession extends WhatsappSessionNoWebCore {
  public sock: any;

  constructor() {
    const logger = createMockLogger();
    super({
      name: 'test-session',
      printQR: false,
      mediaManager: createMockMediaManager() as any,
      loggerBuilder: { child: () => logger } as any,
      sessionStore: createMockSessionStore() as any,
      sessionConfig: undefined,
      engineConfig: undefined,
      ignore: {},
    });
  }

  /** Widen the protected status setter back to public for direct test manipulation */
  public set status(value: WAHASessionStatus) {
    super.status = value;
  }

  public get status() {
    return super.status;
  }

  /**
   * Override buildClient to avoid real socket/store creation.
   * Installs a mock sock with EventEmitter, a mock store,
   * sets shouldRestart = true (matching real buildClient), and
   * wires up listenConnectionEvents().
   */
  async buildClient() {
    (this as any).shouldRestart = true;
    this.sock = createMockSock();
    (this as any).store = createMockStore();
    this.listenConnectionEvents();
  }

  /**
   * Override start to set STARTING status and call buildClient() directly
   * (bypassing the real start() which calls buildClient in a fire-and-forget
   * .catch() chain).
   */
  async start() {
    this.status = WAHASessionStatus.STARTING;
    await this.buildClient();
  }

  /**
   * Expose the protected listenConnectionEvents for test setup.
   */
  public listenConnectionEvents() {
    super.listenConnectionEvents();
  }
}

// ---------------------------------------------------------------------------
// Helper: emit a connection.update event and await the async handler
// ---------------------------------------------------------------------------

async function emitConnectionUpdate(
  session: TestableNoWebSession,
  update: Record<string, any>,
) {
  const listeners = session.sock.ev.listeners('connection.update');
  if (listeners.length === 0) {
    throw new Error(
      'No connection.update listener registered — did listenConnectionEvents() run?',
    );
  }
  const handler = listeners[listeners.length - 1];
  await handler(update);
}

/** Build a Boom-like lastDisconnect object for a given status code */
function makeDisconnect(statusCode: number) {
  return {
    error: {
      message: `status ${statusCode}`,
      output: { statusCode },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WhatsappSessionNoWebCore — connection resilience', () => {
  let session: TestableNoWebSession;

  beforeEach(async () => {
    jest.useFakeTimers();
    session = new TestableNoWebSession();
    await session.start();

    // Stub heavy I/O methods so tests stay fast and isolated
    (session as any).end = jest.fn().mockResolvedValue(undefined);
    (session as any).cleanupAuthOnLogout = jest
      .fn()
      .mockResolvedValue(true);
  });

  afterEach(() => {
    (session as any).startDelayedJob.cancel();
    (session as any).autoRestartJob?.stop();
    (session as any).presenceKeepAliveJob?.stop();
    jest.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // 1. Connection open
  // -----------------------------------------------------------------------
  describe('connection open', () => {
    it('sets status to WORKING', async () => {
      await emitConnectionUpdate(session, { connection: 'open' });
      expect(session.status).toBe(WAHASessionStatus.WORKING);
    });

    it('clears QR data', async () => {
      // First set a QR code
      await emitConnectionUpdate(session, { qr: 'some-qr-string' });
      expect((session as any).qr.raw).toBe('some-qr-string');

      // Then open the connection — QR should be cleared
      await emitConnectionUpdate(session, { connection: 'open' });
      expect((session as any).qr.raw).toBe('');
    });

    it('resets permanentRestartAttempted flag', async () => {
      (session as any).permanentRestartAttempted = true;
      await emitConnectionUpdate(session, { connection: 'open' });
      expect((session as any).permanentRestartAttempted).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 2. QR code handling
  // -----------------------------------------------------------------------
  describe('QR code handling', () => {
    it('saves QR string and sets SCAN_QR_CODE status', async () => {
      await emitConnectionUpdate(session, { qr: 'qr-data-here' });
      expect((session as any).qr.raw).toBe('qr-data-here');
      expect(session.status).toBe(WAHASessionStatus.SCAN_QR_CODE);
    });
  });

  // -----------------------------------------------------------------------
  // 3. PERMANENT disconnect — first occurrence
  // -----------------------------------------------------------------------
  describe('PERMANENT disconnect — first occurrence', () => {
    // 403 (forbidden/banned) is not retryable — wipe on first occurrence.
    // (401 and 405 get a one-retry grace; see their dedicated tests below.)
    it.each([403])(
      'status %d: cleans auth, sets guard flag, schedules restart',
      async (statusCode) => {
        session.status = WAHASessionStatus.WORKING;
        // Simulate established auth so we test the guard-flag path
        (session as any).authNOWEBStore = {
          state: { creds: { me: { id: '123@s.whatsapp.net' } } },
          close: jest.fn(),
        };
        expect((session as any).startDelayedJob.scheduled).toBe(false);

        await emitConnectionUpdate(session, {
          connection: 'close',
          lastDisconnect: makeDisconnect(statusCode),
        });

        // Auth cleanup was called
        expect((session as any).cleanupAuthOnLogout).toHaveBeenCalled();
        // Guard flag set
        expect((session as any).permanentRestartAttempted).toBe(true);
        // restartClient() delegates to startDelayedJob.schedule()
        expect((session as any).startDelayedJob.scheduled).toBe(true);
      },
    );

    it.each([401, 405])(
      'status %d: retries once with existing creds before wiping',
      async (statusCode) => {
        session.status = WAHASessionStatus.WORKING;
        (session as any).authNOWEBStore = {
          state: { creds: { me: { id: '123@s.whatsapp.net' } } },
          close: jest.fn(),
        };

        // First occurrence — retry, do NOT wipe
        await emitConnectionUpdate(session, {
          connection: 'close',
          lastDisconnect: makeDisconnect(statusCode),
        });
        expect((session as any).cleanupAuthOnLogout).not.toHaveBeenCalled();
        expect((session as any).logoutRetryCount).toBe(1);
        expect((session as any).startDelayedJob.scheduled).toBe(true);
        (session as any).startDelayedJob.cancel();

        // Second occurrence — genuine, wipe
        await emitConnectionUpdate(session, {
          connection: 'close',
          lastDisconnect: makeDisconnect(statusCode),
        });
        expect((session as any).cleanupAuthOnLogout).toHaveBeenCalled();
      },
    );

    it('status 401: retries once with existing creds before wiping', async () => {
      session.status = WAHASessionStatus.WORKING;
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };
      expect((session as any).startDelayedJob.scheduled).toBe(false);

      // First 401 — should retry, NOT wipe
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(401),
      });

      expect((session as any).cleanupAuthOnLogout).not.toHaveBeenCalled();
      expect((session as any).logoutRetryCount).toBe(1);
      expect((session as any).permanentRestartAttempted).toBe(false);
      expect((session as any).startDelayedJob.scheduled).toBe(true);
    });

    it('status 401: second 401 after retry wipes auth', async () => {
      session.status = WAHASessionStatus.WORKING;
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };

      // First 401 — retry
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(401),
      });
      expect((session as any).logoutRetryCount).toBe(1);

      // Second 401 — genuine logout, wipe
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(401),
      });

      expect((session as any).cleanupAuthOnLogout).toHaveBeenCalled();
      expect((session as any).logoutRetryCount).toBe(0);
    });

    it('status 401: retry counter resets on successful connection', async () => {
      session.status = WAHASessionStatus.WORKING;
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };

      // First 401 — retry
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(401),
      });
      expect((session as any).logoutRetryCount).toBe(1);

      // Connection opens — reset
      await emitConnectionUpdate(session, { connection: 'open' });
      expect((session as any).logoutRetryCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 4. PERMANENT disconnect — guard flag (second attempt)
  // -----------------------------------------------------------------------
  describe('PERMANENT disconnect — guard flag', () => {
    it('second permanent disconnect sets FAILED, stops restart, and stops auto-restart job', async () => {
      session.status = WAHASessionStatus.WORKING;
      // Simulate established auth so we test the guard-flag path
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };
      const autoRestartStopSpy = jest.spyOn(
        (session as any).autoRestartJob,
        'stop',
      );

      // First permanent disconnect (403) — should restart
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(403),
      });
      expect((session as any).permanentRestartAttempted).toBe(true);

      // Second permanent disconnect — guard blocks restart
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(403),
      });
      expect(session.status).toBe(WAHASessionStatus.FAILED);
      expect((session as any).shouldRestart).toBe(false);
      expect(autoRestartStopSpy).toHaveBeenCalled();
    });

    it('auth cleanup failure sets FAILED immediately', async () => {
      session.status = WAHASessionStatus.WORKING;
      // Simulate established auth so we test the cleanup-failure path
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };
      (session as any).cleanupAuthOnLogout = jest
        .fn()
        .mockResolvedValue(false);

      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(403),
      });

      expect(session.status).toBe(WAHASessionStatus.FAILED);
      expect((session as any).shouldRestart).toBe(false);
    });

    it('end()/store.close() errors are caught (no unhandled rejections)', async () => {
      session.status = WAHASessionStatus.WORKING;
      // Simulate established auth so we test the guard-flag FAILED path
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };
      (session as any).permanentRestartAttempted = true;
      const endMock = jest
        .fn()
        .mockRejectedValue(new Error('end failed'));
      const storeCloseMock = jest
        .fn()
        .mockRejectedValue(new Error('store close failed'));
      (session as any).end = endMock;
      (session as any).store.close = storeCloseMock;

      // Should not throw despite both end() and store.close() rejecting
      await expect(
        emitConnectionUpdate(session, {
          connection: 'close',
          lastDisconnect: makeDisconnect(403),
        }),
      ).resolves.toBeUndefined();

      expect(session.status).toBe(WAHASessionStatus.FAILED);
      // Verify the operations were actually attempted
      expect(endMock).toHaveBeenCalled();
      expect(storeCloseMock).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 4b. PERMANENT disconnect — no established auth (registration rejection)
  // -----------------------------------------------------------------------
  describe('PERMANENT disconnect — no established auth', () => {
    it('405 with no paired auth clears auth store and retries', async () => {
      session.status = WAHASessionStatus.STARTING;
      // No authNOWEBStore set — simulates brand new session
      expect((session as any).startDelayedJob.scheduled).toBe(false);

      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(405),
      });

      // Should retry via restartClient
      expect((session as any).startDelayedJob.scheduled).toBe(true);
      // Guard flag should NOT be set
      expect((session as any).permanentRestartAttempted).toBe(false);
      // Should NOT have called cleanupAuthOnLogout (early return)
      expect((session as any).cleanupAuthOnLogout).not.toHaveBeenCalled();
      // Auth store should be null so makeSocket() generates fresh keys
      expect((session as any).authNOWEBStore).toBeNull();
      // Status should NOT be FAILED
      expect(session.status).not.toBe(WAHASessionStatus.FAILED);
    });

    it('405 with unpaired auth store clears it and retries with fresh keys', async () => {
      session.status = WAHASessionStatus.STARTING;
      // Auth store exists (created by makeSocket) but creds.me is null (never paired)
      const mockClose = jest.fn();
      (session as any).authNOWEBStore = {
        state: { creds: { me: null } },
        close: mockClose,
      };

      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(405),
      });

      // Should close the existing auth store
      expect(mockClose).toHaveBeenCalled();
      // Auth store should be null so makeSocket() generates fresh keys
      expect((session as any).authNOWEBStore).toBeNull();
      // Should retry via restartClient
      expect((session as any).startDelayedJob.scheduled).toBe(true);
      // Guard flag should NOT be set
      expect((session as any).permanentRestartAttempted).toBe(false);
      expect(session.status).not.toBe(WAHASessionStatus.FAILED);
    });

    it('multiple 405s with no auth keep retrying with fresh keys (never FAILED)', async () => {
      session.status = WAHASessionStatus.STARTING;

      for (let i = 0; i < 5; i++) {
        // Simulate makeSocket() creating a new auth store on each start()
        (session as any).authNOWEBStore = {
          state: { creds: { me: null } },
          close: jest.fn(),
        };
        // Reset the delayed job to allow re-scheduling
        (session as any).startDelayedJob.cancel();

        await emitConnectionUpdate(session, {
          connection: 'close',
          lastDisconnect: makeDisconnect(405),
        });

        expect((session as any).permanentRestartAttempted).toBe(false);
        // Auth store cleared each time
        expect((session as any).authNOWEBStore).toBeNull();
        expect((session as any).startDelayedJob.scheduled).toBe(true);
        expect(session.status).not.toBe(WAHASessionStatus.FAILED);
      }
    });

    it('405 with established auth: retries once, then wipes + sets guard', async () => {
      session.status = WAHASessionStatus.WORKING;
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };

      // First 405 — retry once with existing creds (version rejection ≠ dead auth)
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(405),
      });
      expect((session as any).cleanupAuthOnLogout).not.toHaveBeenCalled();
      expect((session as any).logoutRetryCount).toBe(1);
      expect((session as any).startDelayedJob.scheduled).toBe(true);
      (session as any).startDelayedJob.cancel();

      // Second 405 — grace exhausted, clean auth, set guard, restart
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(405),
      });
      expect((session as any).permanentRestartAttempted).toBe(true);
      expect((session as any).cleanupAuthOnLogout).toHaveBeenCalled();
      expect((session as any).startDelayedJob.scheduled).toBe(true);
    });

    it('permanent code during stop() (shouldRestart=false, not unpairing) does not wipe', async () => {
      session.status = WAHASessionStatus.WORKING;
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };
      // Simulate a stop() in flight: shouldRestart cleared, NOT unpairing.
      (session as any).shouldRestart = false;
      (session as any).unpairing = false;

      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(401),
      });

      // Creds and backups must survive — this is shutdown, not dead auth.
      expect((session as any).cleanupAuthOnLogout).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 440 connectionReplaced — conflict detection
  // -----------------------------------------------------------------------
  describe('440 connectionReplaced', () => {
    it('reconnects on a single 440 (one-off takeover)', async () => {
      session.status = WAHASessionStatus.WORKING;
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };

      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(440),
      });

      expect(session.status).not.toBe(WAHASessionStatus.FAILED);
      expect((session as any).startDelayedJob.scheduled).toBe(true);
    });

    it('repeated 440 within the window stops the reconnect fight (FAILED, creds kept)', async () => {
      session.status = WAHASessionStatus.WORKING;
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };

      // A conflict fight: each 440 is followed by a successful 'open' (the
      // reconnect), which resets the same-code streak but must NOT reset the
      // conflict counter. 5 conflicts in the window → give up.
      for (let i = 0; i < 4; i++) {
        await emitConnectionUpdate(session, {
          connection: 'close',
          lastDisconnect: makeDisconnect(440),
        });
        expect(session.status).not.toBe(WAHASessionStatus.FAILED);
        (session as any).startDelayedJob.cancel();
        await emitConnectionUpdate(session, { connection: 'open' });
      }

      // 5th conflict crosses CONFLICT_THRESHOLD
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(440),
      });

      expect(session.status).toBe(WAHASessionStatus.FAILED);
      expect((session as any).cleanupAuthOnLogout).not.toHaveBeenCalled();
      expect((session as any).shouldRestart).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Reconnect backoff
  // -----------------------------------------------------------------------
  describe('reconnect backoff', () => {
    it('doubles the reconnect delay each attempt and resets on open', async () => {
      session.status = WAHASessionStatus.WORKING;

      const delays: number[] = [];
      const realSchedule = (session as any).startDelayedJob.schedule.bind(
        (session as any).startDelayedJob,
      );
      jest
        .spyOn((session as any).startDelayedJob, 'schedule')
        .mockImplementation((fn: any, delayMs?: number) => {
          delays.push(delayMs);
          return realSchedule(fn, delayMs);
        });

      // Three transient drops (different codes so we never escalate) —
      // delays should be 2s, 4s, 8s.
      for (const code of [408, 500, 503]) {
        await emitConnectionUpdate(session, {
          connection: 'close',
          lastDisconnect: makeDisconnect(code),
        });
        (session as any).startDelayedJob.cancel();
      }
      expect(delays).toEqual([2000, 4000, 8000]);

      // A successful connection resets the backoff.
      await emitConnectionUpdate(session, { connection: 'open' });
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(408),
      });
      expect(delays[delays.length - 1]).toBe(2000);
    });

    it('caps the backoff delay at 60s', async () => {
      session.status = WAHASessionStatus.WORKING;
      // Drive reconnectAttempts high enough that 2 * 2^n would exceed 60s.
      (session as any).reconnectAttempts = 10;
      const delayMs = (session as any).nextReconnectDelayMs();
      expect(delayMs).toBe(60_000);
    });
  });

  // -----------------------------------------------------------------------
  // 5. RESTART disconnect
  // -----------------------------------------------------------------------
  describe('RESTART disconnect', () => {
    it('515 triggers restartClient', async () => {
      session.status = WAHASessionStatus.WORKING;
      expect((session as any).startDelayedJob.scheduled).toBe(false);

      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(515),
      });

      expect((session as any).startDelayedJob.scheduled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 6. TRANSIENT disconnect
  // -----------------------------------------------------------------------
  describe('TRANSIENT disconnect', () => {
    it('transient code triggers restartClient when WORKING', async () => {
      session.status = WAHASessionStatus.WORKING;
      expect((session as any).startDelayedJob.scheduled).toBe(false);

      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(408),
      });

      expect((session as any).startDelayedJob.scheduled).toBe(true);
    });

    it('TRANSIENT during SCAN_QR_CODE calls failed()', async () => {
      session.status = WAHASessionStatus.SCAN_QR_CODE;

      // Stub failed() to avoid uninitialized autoRestartJob.stop() and
      // side effects from real cleanup (sleep, end, store.close)
      const failedSpy = jest
        .fn()
        .mockImplementation(async () => {
          (session as any).shouldRestart = false;
          session.status = WAHASessionStatus.FAILED;
        });
      (session as any).failed = failedSpy;

      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(500),
      });

      expect(failedSpy).toHaveBeenCalled();
      expect(session.status).toBe(WAHASessionStatus.FAILED);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Safety net — transient code repeat upgrade
  // -----------------------------------------------------------------------
  describe('safety net', () => {
    it('same transient code 3x within the retry window keeps retrying (not FAILED)', async () => {
      session.status = WAHASessionStatus.WORKING;
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };

      // Three quick drops, same code, no time advance — a routine proxy blip.
      // The streak counter trips at 3 but the elapsed window is ~0, so the
      // session must KEEP retrying rather than fail a recoverable connection.
      for (let i = 0; i < 3; i++) {
        await emitConnectionUpdate(session, {
          connection: 'close',
          lastDisconnect: makeDisconnect(408),
        });
        expect(session.status).not.toBe(WAHASessionStatus.FAILED);
        expect((session as any).startDelayedJob.scheduled).toBe(true);
        (session as any).startDelayedJob.cancel();
      }

      expect((session as any).cleanupAuthOnLogout).not.toHaveBeenCalled();
      expect(session.status).not.toBe(WAHASessionStatus.FAILED);
    });

    it('sustained same-code transient past the window sets FAILED without wiping auth', async () => {
      session.status = WAHASessionStatus.WORKING;
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };

      // First drop stamps the streak start.
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(408),
      });
      (session as any).startDelayedJob.cancel();
      expect(session.status).not.toBe(WAHASessionStatus.FAILED);

      // Outage persists beyond the retry window (~3 min).
      jest.advanceTimersByTime(3 * 60 * 1000 + 1000);

      // Next same-code drops now cross the window → FAILED, creds intact.
      for (let i = 0; i < 2; i++) {
        await emitConnectionUpdate(session, {
          connection: 'close',
          lastDisconnect: makeDisconnect(408),
        });
        (session as any).startDelayedJob.cancel();
      }

      expect((session as any).cleanupAuthOnLogout).not.toHaveBeenCalled();
      expect(session.status).toBe(WAHASessionStatus.FAILED);
      expect((session as any).shouldRestart).toBe(false);
    });

    it('successful connection resets the repeat streak', async () => {
      session.status = WAHASessionStatus.WORKING;
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };

      // Two transient drops with the same code
      for (let i = 0; i < 2; i++) {
        await emitConnectionUpdate(session, {
          connection: 'close',
          lastDisconnect: makeDisconnect(408),
        });
        (session as any).startDelayedJob.cancel();
      }

      // Reconnect succeeds — streak must reset
      await emitConnectionUpdate(session, { connection: 'open' });

      // Two more drops with the same code: still below threshold
      for (let i = 0; i < 2; i++) {
        await emitConnectionUpdate(session, {
          connection: 'close',
          lastDisconnect: makeDisconnect(408),
        });
        (session as any).startDelayedJob.cancel();
      }

      expect((session as any).cleanupAuthOnLogout).not.toHaveBeenCalled();
      expect(session.status).not.toBe(WAHASessionStatus.FAILED);
    });

    it('different codes reset the counter (no upgrade)', async () => {
      session.status = WAHASessionStatus.WORKING;

      // Two hits of 408
      for (let i = 0; i < 2; i++) {
        await emitConnectionUpdate(session, {
          connection: 'close',
          lastDisconnect: makeDisconnect(408),
        });
        (session as any).startDelayedJob.cancel();
      }

      // Then a different code resets the counter
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(500),
      });

      // cleanupAuthOnLogout should NOT have been called (no upgrade)
      expect((session as any).cleanupAuthOnLogout).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 8. Stuck in STARTING
  // -----------------------------------------------------------------------
  describe('stuck in STARTING', () => {
    it('60+ STARTING transitions force failed() on disconnect', async () => {
      // Stub failed()
      const failedSpy = jest
        .fn()
        .mockImplementation(async () => {
          (session as any).shouldRestart = false;
          session.status = WAHASessionStatus.FAILED;
        });
      (session as any).failed = failedSpy;

      // Simulate 60 STARTING transitions by setting status repeatedly
      for (let i = 0; i < 60; i++) {
        session.status = WAHASessionStatus.STARTING;
      }

      // Verify precondition: the tracker actually thinks we're stuck
      expect((session as any).statusTracker.isStuckInStarting()).toBe(true);

      // Any disconnect should now trigger failed()
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(408),
      });

      expect(failedSpy).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 9. getScreenshot
  // -----------------------------------------------------------------------
  describe('getScreenshot', () => {
    it('FAILED → throws "session has failed"', async () => {
      session.status = WAHASessionStatus.FAILED;
      await expect(session.getScreenshot()).rejects.toThrow(
        UnprocessableEntityException,
      );
      await expect(session.getScreenshot()).rejects.toThrow(/failed/i);
    });

    it('STOPPED → throws "session is stopped"', async () => {
      session.status = WAHASessionStatus.STOPPED;
      await expect(session.getScreenshot()).rejects.toThrow(
        UnprocessableEntityException,
      );
      await expect(session.getScreenshot()).rejects.toThrow(/stopped/i);
    });

    it('STARTING → throws "session is starting"', async () => {
      session.status = WAHASessionStatus.STARTING;
      await expect(session.getScreenshot()).rejects.toThrow(
        UnprocessableEntityException,
      );
      await expect(session.getScreenshot()).rejects.toThrow(/starting/i);
    });

    it('WORKING → throws "non chrome"', async () => {
      session.status = WAHASessionStatus.WORKING;
      await expect(session.getScreenshot()).rejects.toThrow(
        UnprocessableEntityException,
      );
      await expect(session.getScreenshot()).rejects.toThrow(/chrome/i);
    });

    it('SCAN_QR_CODE → returns Buffer', async () => {
      // QRCode.toDataURL uses real timers internally, so switch back
      jest.useRealTimers();
      session.status = WAHASessionStatus.SCAN_QR_CODE;
      // Set a valid QR string so the QR library can produce a data-URL
      (session as any).qr.save('test-qr-data');
      const result = await session.getScreenshot();
      expect(Buffer.isBuffer(result)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 10. Error handling in connection.update handler
  // -----------------------------------------------------------------------
  describe('error handling in handler', () => {
    it('error thrown in handler sets status to FAILED and logs the error', async () => {
      const loggerErrorSpy = (session as any).logger.error;
      loggerErrorSpy.mockClear();

      // Force an error in handleConnectionClose by making the
      // lastDisconnect.error getter throw. This triggers the catch block
      // in listenConnectionEvents before classifyDisconnect is reached.
      const badDisconnect = {
        get error() {
          throw new Error('boom');
        },
      };

      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: badDisconnect,
      });

      expect(session.status).toBe(WAHASessionStatus.FAILED);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: 'boom' }),
        expect.stringContaining('Unhandled error'),
      );
    });
  });

  // -----------------------------------------------------------------------
  // 11. isNewLogin
  // -----------------------------------------------------------------------
  describe('isNewLogin', () => {
    it('triggers restartClient', async () => {
      expect((session as any).startDelayedJob.scheduled).toBe(false);
      await emitConnectionUpdate(session, { isNewLogin: true });
      expect((session as any).startDelayedJob.scheduled).toBe(true);
    });

    it('takes priority over connection open', async () => {
      await emitConnectionUpdate(session, {
        isNewLogin: true,
        connection: 'open',
      });
      // isNewLogin path runs restartClient, NOT the open handler
      expect((session as any).startDelayedJob.scheduled).toBe(true);
      // Status should NOT be WORKING since connection open branch was skipped
      expect(session.status).not.toBe(WAHASessionStatus.WORKING);
    });
  });

  // -----------------------------------------------------------------------
  // 12. restartClient guards
  // -----------------------------------------------------------------------
  describe('restartClient guards', () => {
    it('restartClient is a no-op when shouldRestart is false', async () => {
      (session as any).shouldRestart = false;
      expect((session as any).startDelayedJob.scheduled).toBe(false);

      // Trigger a RESTART disconnect — would normally schedule a restart
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(515),
      });

      // No job should have been scheduled
      expect((session as any).startDelayedJob.scheduled).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 13. WA version resolution
  // -----------------------------------------------------------------------
  describe('WA version resolution', () => {
    const {
      fetchLatestBaileysVersion: mockFetch,
    } = jest.requireMock('@adiwajshing/baileys');
    const env = require('@waha/core/env');

    afterEach(() => {
      env.WAHA_WA_VERSION = null;
      mockFetch.mockReset();
    });

    it('resolveWAVersion uses WAHA_WA_VERSION env var when set', async () => {
      env.WAHA_WA_VERSION = '2,3000,9999999';
      const version = await (session as any).resolveWAVersion();
      expect(version).toEqual([2, 3000, 9999999]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('resolveWAVersion fetches version on success', async () => {
      mockFetch.mockResolvedValue({
        version: [2, 3000, 1034386130] as any,
        isLatest: true,
      });
      const version = await (session as any).resolveWAVersion();
      expect(version).toEqual([2, 3000, 1034386130]);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('resolveWAVersion handles fetch timeout gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('AbortError: signal timed out'));
      const version = await (session as any).resolveWAVersion();
      expect(version).toBeUndefined();
    });

    it('resolveWAVersion returns undefined when fetch fails (Baileys default used)', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));
      const version = await (session as any).resolveWAVersion();
      expect(version).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 14. Default browser is Mac OS Chrome
  // -----------------------------------------------------------------------
  describe('default browser', () => {
    it('default browser is Mac OS Chrome', () => {
      const config = (session as any).getSocketConfig(undefined, {});
      expect(config.browser).toEqual(['Mac OS', 'Chrome', '14.4.1']);
    });
  });
});
