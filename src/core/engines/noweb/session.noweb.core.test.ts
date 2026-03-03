import { EventEmitter } from 'events';

// Mock @adiwajshing/baileys before any imports that depend on it
jest.mock('@adiwajshing/baileys', () => ({
  __esModule: true,
  default: jest.fn(), // makeWASocket
  Browsers: { appropriate: jest.fn(), macOS: jest.fn(), ubuntu: jest.fn(), windows: jest.fn() },
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
    it.each([401, 403, 405])(
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

      // First permanent disconnect — should restart
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(401),
      });
      expect((session as any).permanentRestartAttempted).toBe(true);

      // Second permanent disconnect — guard blocks restart
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(401),
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
        lastDisconnect: makeDisconnect(401),
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

    it('405 with established auth uses guard flag (existing behavior)', async () => {
      session.status = WAHASessionStatus.WORKING;
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };

      // First 405 — should clean auth, set guard, restart
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(405),
      });
      expect((session as any).permanentRestartAttempted).toBe(true);
      expect((session as any).cleanupAuthOnLogout).toHaveBeenCalled();
      expect((session as any).startDelayedJob.scheduled).toBe(true);

      // Second 405 — guard flag blocks, sets FAILED
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(405),
      });
      expect(session.status).toBe(WAHASessionStatus.FAILED);
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
    it('same transient code 3x upgrades to PERMANENT handling', async () => {
      session.status = WAHASessionStatus.WORKING;
      // Simulate established auth so the upgrade triggers full PERMANENT path
      (session as any).authNOWEBStore = {
        state: { creds: { me: { id: '123@s.whatsapp.net' } } },
        close: jest.fn(),
      };

      // Need to reset the delayed job between events so restartClient
      // can schedule again (simulating the timer firing between events)
      for (let i = 0; i < 2; i++) {
        await emitConnectionUpdate(session, {
          connection: 'close',
          lastDisconnect: makeDisconnect(408),
        });
        // Simulate the delayed job timer completing so it can be rescheduled
        (session as any).startDelayedJob.cancel();
      }

      // Third time — triggers PERMANENT path
      await emitConnectionUpdate(session, {
        connection: 'close',
        lastDisconnect: makeDisconnect(408),
      });

      // On upgrade to PERMANENT, cleanupAuthOnLogout is called
      expect((session as any).cleanupAuthOnLogout).toHaveBeenCalled();
      expect((session as any).permanentRestartAttempted).toBe(true);
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
});
