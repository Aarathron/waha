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
