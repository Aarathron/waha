# Connection Resilience Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix infinite reconnect loops on permanent auth failures (405, 403) by classifying disconnect errors and handling each category appropriately.

**Architecture:** Introduce a `DisconnectAction` enum and `classifyDisconnect()` function that maps Baileys status codes to three action categories (PERMANENT, RESTART, TRANSIENT). Refactor `listenConnectionEvents()` to use this classifier. On permanent failures, clean auth state and transition to SCAN_QR_CODE instead of endlessly retrying.

**Tech Stack:** TypeScript, NestJS, Baileys (WhatsApp Web library), Jest

---

### Task 1: Add disconnect classifier function

**Files:**
- Create: `src/core/engines/noweb/disconnect-classifier.ts`
- Test: `src/core/engines/noweb/disconnect-classifier.test.ts`

**Step 1: Write the failing tests**

Create `src/core/engines/noweb/disconnect-classifier.test.ts`:

```typescript
import { classifyDisconnect, DisconnectAction } from './disconnect-classifier';

describe('classifyDisconnect', () => {
  describe('PERMANENT actions (auth is dead, stop retrying)', () => {
    it.each([401, 403, 405])('returns PERMANENT for status code %d', (code) => {
      expect(classifyDisconnect(code)).toBe(DisconnectAction.PERMANENT);
    });
  });

  describe('RESTART actions (server requested restart)', () => {
    it('returns RESTART for status code 515', () => {
      expect(classifyDisconnect(515)).toBe(DisconnectAction.RESTART);
    });
  });

  describe('TRANSIENT actions (retry with delay)', () => {
    it.each([408, 411, 428, 440, 500, 503])(
      'returns TRANSIENT for status code %d',
      (code) => {
        expect(classifyDisconnect(code)).toBe(DisconnectAction.TRANSIENT);
      },
    );

    it('returns TRANSIENT for unknown status codes', () => {
      expect(classifyDisconnect(999)).toBe(DisconnectAction.TRANSIENT);
    });

    it('returns TRANSIENT for undefined', () => {
      expect(classifyDisconnect(undefined)).toBe(DisconnectAction.TRANSIENT);
    });

    it('returns TRANSIENT for null', () => {
      expect(classifyDisconnect(null)).toBe(DisconnectAction.TRANSIENT);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest --config package.json disconnect-classifier.test.ts --no-cache`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/core/engines/noweb/disconnect-classifier.ts`:

```typescript
export enum DisconnectAction {
  /** Auth is permanently invalid. Clean credentials, show QR. */
  PERMANENT = 'PERMANENT',
  /** Server requested a restart. Reconnect immediately. */
  RESTART = 'RESTART',
  /** Transient network/server issue. Retry with delay. */
  TRANSIENT = 'TRANSIENT',
}

/**
 * Status codes that indicate the session's auth state is permanently
 * invalid — retrying with the same credentials will never succeed.
 *
 * 401 = loggedOut (user logged out from another device)
 * 403 = forbidden (account banned or restricted)
 * 405 = registration rejected (WhatsApp rejects pairing, auth keys are stale)
 */
const PERMANENT_CODES = new Set([401, 403, 405]);

/**
 * Status codes where the server explicitly tells us to restart.
 *
 * 515 = restartRequired
 */
const RESTART_CODES = new Set([515]);

/**
 * Classify a Baileys disconnect status code into an action category.
 *
 * Baileys' CB:failure handler passes the raw reason code from WhatsApp
 * as statusCode. Not all codes are in the DisconnectReason enum —
 * e.g., 405 is not — so we must handle unknown codes gracefully.
 */
export function classifyDisconnect(
  statusCode: number | undefined | null,
): DisconnectAction {
  if (statusCode == null) {
    return DisconnectAction.TRANSIENT;
  }
  if (PERMANENT_CODES.has(statusCode)) {
    return DisconnectAction.PERMANENT;
  }
  if (RESTART_CODES.has(statusCode)) {
    return DisconnectAction.RESTART;
  }
  return DisconnectAction.TRANSIENT;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest --config package.json disconnect-classifier.test.ts --no-cache`
Expected: All tests PASS

**Step 5: Commit**

```
feat: add disconnect error classifier for WhatsApp connection handling
```

---

### Task 2: Refactor listenConnectionEvents() to use classifier

**Files:**
- Modify: `src/core/engines/noweb/session.noweb.core.ts` (lines 536-607)

**Step 1: Add import at top of file**

After existing imports (around line 213), add:

```typescript
import {
  classifyDisconnect,
  DisconnectAction,
} from '@waha/core/engines/noweb/disconnect-classifier';
```

**Step 2: Replace listenConnectionEvents() method**

Replace lines 536-607 with:

```typescript
  protected listenConnectionEvents() {
    this.logger.debug(`Start listening ${BaileysEvents.CONNECTION_UPDATE}...`);
    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update;
      if (isNewLogin) {
        this.restartClient();
      } else if (connection === 'open') {
        this.qr.save('');
        this.status = WAHASessionStatus.WORKING;
        return;
      } else if (connection === 'close') {
        this.qr.save('');
        await this.handleConnectionClose(lastDisconnect);
      }

      // Save QR
      if (qr) {
        this.qr.save(qr);
        this.printQR(this.qr);
        this.status = WAHASessionStatus.SCAN_QR_CODE;
      }
    });
  }

  private async handleConnectionClose(lastDisconnect: any) {
    const error = lastDisconnect?.error as any;
    const statusCode: number | undefined = error?.output?.statusCode;
    const action = classifyDisconnect(statusCode);

    this.logger.info(
      {
        statusCode,
        action,
        error: lastDisconnect?.error?.message,
      },
      `Connection closed, action: ${action}`,
    );

    // Stuck in STARTING status — break the loop regardless of action
    if (this.statusTracker.isStuckInStarting()) {
      this.logger.error(
        'Session stuck in STARTING status, force stopping the session.',
      );
      await this.failed();
      return;
    }

    switch (action) {
      case DisconnectAction.PERMANENT:
        await this.handlePermanentDisconnect(statusCode, lastDisconnect);
        return;

      case DisconnectAction.RESTART:
        this.restartClient();
        return;

      case DisconnectAction.TRANSIENT:
        // Do not reconnect if QR code hasn't been scanned yet
        if (this.status === WAHASessionStatus.SCAN_QR_CODE) {
          this.logger.warn(
            'QR code has not been scanned yet, force stopping the session.',
          );
          await this.failed();
          return;
        }
        if (lastDisconnect?.error) {
          this.logger.info(
            `Connection closed due to '${lastDisconnect.error}', reconnecting...`,
          );
        }
        this.restartClient();
        return;
    }
  }

  /**
   * Handle permanent disconnects (auth is dead).
   * Clean credentials and transition to SCAN_QR_CODE so the
   * dashboard/API shows the session needs re-pairing.
   */
  private async handlePermanentDisconnect(
    statusCode: number,
    lastDisconnect: any,
  ) {
    this.logger.error(
      `Permanent disconnect (status ${statusCode}): '${lastDisconnect?.error}'. ` +
        'Cleaning auth state, session will require QR scan.',
    );
    await this.cleanupAuthOnLogout();

    // Stop reconnection attempts
    this.shouldRestart = false;
    this.startDelayedJob.cancel();
    this.autoRestartJob.stop();

    // Transition to SCAN_QR_CODE (not FAILED) so the user sees
    // the session needs re-pairing rather than thinking it crashed
    this.status = WAHASessionStatus.SCAN_QR_CODE;

    await this.end();
    await this.store?.close();
  }
```

**Step 3: Verify the build compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -30`
Expected: No errors related to the changed files

**Step 4: Run existing tests**

Run: `npx jest --config package.json --no-cache 2>&1 | tail -20`
Expected: All existing tests pass (no regressions)

**Step 5: Commit**

```
refactor: use disconnect classifier in connection event handler

Replace the scattered if/else chain with a clear classifier that
maps status codes to PERMANENT, RESTART, or TRANSIENT actions.

Permanent failures (401, 403, 405) now clean auth state and
transition to SCAN_QR_CODE instead of retrying forever.
```

---

### Task 3: Enhance StatusTracker with reason-aware tracking

**Files:**
- Modify: `src/utils/StatusTracker.ts`
- Create: `src/utils/StatusTracker.test.ts`

**Step 1: Write the failing tests**

Create `src/utils/StatusTracker.test.ts`:

```typescript
import { WAHASessionStatus } from '../structures/enums.dto';
import { StatusTracker } from './StatusTracker';

describe('StatusTracker', () => {
  let tracker: StatusTracker;

  beforeEach(() => {
    tracker = new StatusTracker();
  });

  describe('isStuckInStarting', () => {
    it('returns false when no statuses tracked', () => {
      expect(tracker.isStuckInStarting()).toBe(false);
    });

    it('returns false after a few STARTING updates', () => {
      for (let i = 0; i < 10; i++) {
        tracker.track(WAHASessionStatus.STARTING);
      }
      expect(tracker.isStuckInStarting()).toBe(false);
    });

    it('returns true after 60 consecutive STARTING updates', () => {
      for (let i = 0; i < 60; i++) {
        tracker.track(WAHASessionStatus.STARTING);
      }
      expect(tracker.isStuckInStarting()).toBe(true);
    });

    it('resets counter when non-STARTING status is tracked', () => {
      for (let i = 0; i < 59; i++) {
        tracker.track(WAHASessionStatus.STARTING);
      }
      tracker.track(WAHASessionStatus.WORKING);
      for (let i = 0; i < 59; i++) {
        tracker.track(WAHASessionStatus.STARTING);
      }
      expect(tracker.isStuckInStarting()).toBe(false);
    });
  });

  describe('trackDisconnectCode', () => {
    it('returns false for first occurrence of a permanent code', () => {
      expect(tracker.trackDisconnectCode(405)).toBe(false);
    });

    it('returns true when same permanent code appears 3 times consecutively', () => {
      tracker.trackDisconnectCode(405);
      tracker.trackDisconnectCode(405);
      expect(tracker.trackDisconnectCode(405)).toBe(true);
    });

    it('resets counter when a different code appears', () => {
      tracker.trackDisconnectCode(405);
      tracker.trackDisconnectCode(405);
      tracker.trackDisconnectCode(408); // different code
      expect(tracker.trackDisconnectCode(405)).toBe(false);
    });

    it('returns false for transient codes even after many occurrences', () => {
      // Transient codes should not trigger the permanent short-circuit
      for (let i = 0; i < 10; i++) {
        expect(tracker.trackDisconnectCode(408)).toBe(false);
      }
    });

    it('handles undefined/null codes', () => {
      expect(tracker.trackDisconnectCode(undefined)).toBe(false);
      expect(tracker.trackDisconnectCode(null)).toBe(false);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest --config package.json StatusTracker.test.ts --no-cache`
Expected: FAIL — `trackDisconnectCode` is not a function

**Step 3: Implement the enhanced StatusTracker**

Replace `src/utils/StatusTracker.ts`:

```typescript
import { WAHASessionStatus } from '../structures/enums.dto';

const STUCK_IN_STARTING_THRESHOLD = 60;

/**
 * Consecutive occurrences of the same permanent disconnect code
 * before we short-circuit and treat it as definitely permanent.
 */
const PERMANENT_CODE_REPEAT_THRESHOLD = 3;

/**
 * Codes that are permanently fatal — auth is dead, retrying won't help.
 */
const PERMANENT_CODES = new Set([401, 403, 405]);

/**
 * Tracks session status transitions and disconnect codes to detect
 * stuck sessions and permanent failures.
 */
export class StatusTracker {
  private numberOfStarting: number = 0;
  private lastDisconnectCode: number | undefined | null = undefined;
  private disconnectCodeCount: number = 0;

  public track(status: WAHASessionStatus): void {
    if (status == WAHASessionStatus.STARTING) {
      this.numberOfStarting += 1;
    } else {
      this.numberOfStarting = 0;
    }
  }

  /**
   * Checks if the session has been continuously 'STARTING'
   */
  public isStuckInStarting(): boolean {
    return this.numberOfStarting >= STUCK_IN_STARTING_THRESHOLD;
  }

  /**
   * Track a disconnect status code and return whether it indicates
   * a confirmed permanent failure (same permanent code repeated).
   *
   * Returns true if the same permanent-category code has appeared
   * PERMANENT_CODE_REPEAT_THRESHOLD times consecutively.
   * Returns false for transient codes (they should be retried).
   */
  public trackDisconnectCode(
    statusCode: number | undefined | null,
  ): boolean {
    if (statusCode == null || !PERMANENT_CODES.has(statusCode)) {
      this.lastDisconnectCode = statusCode;
      this.disconnectCodeCount = 0;
      return false;
    }

    if (statusCode === this.lastDisconnectCode) {
      this.disconnectCodeCount += 1;
    } else {
      this.lastDisconnectCode = statusCode;
      this.disconnectCodeCount = 1;
    }

    return this.disconnectCodeCount >= PERMANENT_CODE_REPEAT_THRESHOLD;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest --config package.json StatusTracker.test.ts --no-cache`
Expected: All tests PASS

**Step 5: Run all tests to check for regressions**

Run: `npx jest --config package.json --no-cache 2>&1 | tail -20`
Expected: All tests pass

**Step 6: Commit**

```
feat: enhance StatusTracker with disconnect code tracking

Add trackDisconnectCode() that detects when the same permanent
failure code (401, 403, 405) appears 3+ times consecutively,
confirming the failure is not transient.
```

---

### Task 4: Wire StatusTracker.trackDisconnectCode into handleConnectionClose

**Files:**
- Modify: `src/core/engines/noweb/session.noweb.core.ts` (the `handleConnectionClose` method from Task 2)

**Step 1: Update handleConnectionClose to use trackDisconnectCode**

In `handleConnectionClose`, add the `trackDisconnectCode` call right after getting the action. This provides a secondary safety net: even if a code is classified as TRANSIENT, if the StatusTracker detects it's actually a permanent code repeating, it overrides to PERMANENT.

Find this block in `handleConnectionClose`:

```typescript
    const action = classifyDisconnect(statusCode);
```

Replace with:

```typescript
    let action = classifyDisconnect(statusCode);

    // Safety net: if the same permanent-category code keeps repeating,
    // the StatusTracker confirms it's genuinely permanent
    if (
      action === DisconnectAction.TRANSIENT &&
      this.statusTracker.trackDisconnectCode(statusCode)
    ) {
      this.logger.warn(
        { statusCode },
        'Disconnect code repeated — upgrading to PERMANENT',
      );
      action = DisconnectAction.PERMANENT;
    }
```

**Step 2: Also call trackDisconnectCode for PERMANENT/RESTART actions** (to keep tracker state consistent)

After the `let action = ...` and safety net block, add:

```typescript
    // Always track the code to keep the tracker's state accurate
    if (action !== DisconnectAction.TRANSIENT) {
      this.statusTracker.trackDisconnectCode(statusCode);
    }
```

**Step 3: Verify the build compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -30`
Expected: No errors

**Step 4: Run all tests**

Run: `npx jest --config package.json --no-cache 2>&1 | tail -20`
Expected: All tests pass

**Step 5: Commit**

```
feat: wire StatusTracker disconnect code tracking into connection handler

The handleConnectionClose method now uses trackDisconnectCode() as
a safety net to upgrade repeated permanent codes from TRANSIENT to
PERMANENT, preventing infinite reconnect loops.
```

---

### Task 5: Final verification and cleanup

**Step 1: Run the full test suite**

Run: `npx jest --config package.json --no-cache`
Expected: All tests pass

**Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: No errors

**Step 3: Review all changes together**

Run: `git diff --stat`
Expected files changed:
- `src/core/engines/noweb/disconnect-classifier.ts` (new)
- `src/core/engines/noweb/disconnect-classifier.test.ts` (new)
- `src/core/engines/noweb/session.noweb.core.ts` (modified)
- `src/utils/StatusTracker.ts` (modified)
- `src/utils/StatusTracker.test.ts` (new)
- `docs/plans/2026-03-02-connection-resilience-design.md` (new)
