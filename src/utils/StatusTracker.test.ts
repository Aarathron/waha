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
});
