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
    it('returns false for first occurrence of any code', () => {
      expect(tracker.trackDisconnectCode(405)).toBe(false);
      expect(tracker.trackDisconnectCode(408)).toBe(false);
    });

    it('returns true when same code appears 3 times consecutively', () => {
      tracker.trackDisconnectCode(405);
      tracker.trackDisconnectCode(405);
      expect(tracker.trackDisconnectCode(405)).toBe(true);
    });

    it('returns true for any code appearing 3 times consecutively', () => {
      tracker.trackDisconnectCode(408);
      tracker.trackDisconnectCode(408);
      expect(tracker.trackDisconnectCode(408)).toBe(true);
    });

    it('continues returning true after threshold is reached', () => {
      tracker.trackDisconnectCode(405);
      tracker.trackDisconnectCode(405);
      expect(tracker.trackDisconnectCode(405)).toBe(true);
      expect(tracker.trackDisconnectCode(405)).toBe(true);
      expect(tracker.trackDisconnectCode(405)).toBe(true);
    });

    it('resets counter when a different code appears', () => {
      tracker.trackDisconnectCode(405);
      tracker.trackDisconnectCode(405);
      tracker.trackDisconnectCode(408); // different code
      expect(tracker.trackDisconnectCode(405)).toBe(false);
    });

    it('resets counter when a different permanent code appears', () => {
      tracker.trackDisconnectCode(405);
      tracker.trackDisconnectCode(405);
      tracker.trackDisconnectCode(401); // different permanent code
      tracker.trackDisconnectCode(401);
      expect(tracker.trackDisconnectCode(401)).toBe(true);
    });

    it('handles undefined/null codes', () => {
      expect(tracker.trackDisconnectCode(undefined)).toBe(false);
      expect(tracker.trackDisconnectCode(null)).toBe(false);
    });

    it('null/undefined resets the consecutive counter', () => {
      tracker.trackDisconnectCode(405);
      tracker.trackDisconnectCode(405);
      tracker.trackDisconnectCode(null);
      expect(tracker.trackDisconnectCode(405)).toBe(false);
    });
  });

  describe('resetDisconnectCode', () => {
    it('clears an in-progress streak', () => {
      tracker.trackDisconnectCode(408);
      tracker.trackDisconnectCode(408);
      tracker.resetDisconnectCode();
      tracker.trackDisconnectCode(408);
      expect(tracker.trackDisconnectCode(408)).toBe(false);
      expect(tracker.trackDisconnectCode(408)).toBe(true);
    });

    it('clears the streak start timestamp', () => {
      tracker.trackDisconnectCode(408, 1000);
      tracker.resetDisconnectCode();
      expect(tracker.streakElapsedMs(9999)).toBe(0);
    });
  });

  describe('streakElapsedMs', () => {
    it('is 0 with no active streak', () => {
      expect(tracker.streakElapsedMs(5000)).toBe(0);
    });

    it('measures from the first disconnect of a same-code streak', () => {
      tracker.trackDisconnectCode(408, 1000);
      tracker.trackDisconnectCode(408, 3000);
      tracker.trackDisconnectCode(408, 5000);
      expect(tracker.streakElapsedMs(5000)).toBe(4000);
    });

    it('resets the start when a different code appears', () => {
      tracker.trackDisconnectCode(408, 1000);
      tracker.trackDisconnectCode(500, 9000);
      expect(tracker.streakElapsedMs(9000)).toBe(0);
    });

    it('a null code clears the streak start', () => {
      tracker.trackDisconnectCode(408, 1000);
      tracker.trackDisconnectCode(null, 2000);
      expect(tracker.streakElapsedMs(8000)).toBe(0);
    });
  });

  describe('trackConflict', () => {
    it('counts conflicts within the window', () => {
      expect(tracker.trackConflict(1000)).toBe(1);
      expect(tracker.trackConflict(2000)).toBe(2);
      expect(tracker.trackConflict(3000)).toBe(3);
    });

    it('ages out conflicts older than the 2-minute window', () => {
      tracker.trackConflict(0);
      tracker.trackConflict(1000);
      // 130s later — the first two are outside the 120s window
      expect(tracker.trackConflict(130_000)).toBe(1);
    });

    it('survives (does not reset on) successful connections', () => {
      // A conflict fight interleaves opens; the counter must keep climbing.
      tracker.trackConflict(1000);
      tracker.resetDisconnectCode(); // simulates an 'open' in between
      tracker.trackConflict(2000);
      tracker.resetDisconnectCode();
      expect(tracker.trackConflict(3000)).toBe(3);
    });

    it('resetConflicts clears the window', () => {
      tracker.trackConflict(1000);
      tracker.trackConflict(2000);
      tracker.resetConflicts();
      expect(tracker.trackConflict(3000)).toBe(1);
    });
  });
});
