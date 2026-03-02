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
