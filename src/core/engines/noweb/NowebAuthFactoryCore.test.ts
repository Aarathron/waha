import { LocalStoreCore } from '../../storage/LocalStoreCore';
import { NowebAuthFactoryCore } from './NowebAuthFactoryCore';

jest.mock('./useSQLiteAuthState', () => ({
  useSQLiteAuthState: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useSQLiteAuthState } = require('./useSQLiteAuthState');

describe('NowebAuthFactoryCore', () => {
  let store: LocalStoreCore;
  let factory: NowebAuthFactoryCore;
  let authState: {
    state: any;
    saveCreds: jest.Mock;
    clear: jest.Mock;
    close: jest.Mock;
  };

  beforeEach(() => {
    store = new LocalStoreCore('noweb');
    jest.spyOn(store, 'init').mockResolvedValue(undefined);
    jest
      .spyOn(store, 'getSessionDirectory')
      .mockReturnValue('/tmp/test-session');
    jest.spyOn(store, 'getWAHADatabase').mockReturnValue({} as any);

    authState = {
      state: { creds: {}, keys: {} },
      saveCreds: jest.fn(),
      clear: jest.fn(),
      close: jest.fn(),
    };
    useSQLiteAuthState.mockResolvedValue(authState);
    factory = new NowebAuthFactoryCore();
  });

  it('returns state, saveCreds, clear and close from buildAuth', async () => {
    const auth = await factory.buildAuth(store, 'test');

    expect(auth.state).toBe(authState.state);
    expect(typeof auth.saveCreds).toBe('function');
    // clear() is what wipes dead SQLite credentials on permanent disconnect
    // (401/403/405). If it's missing, cleanupAuthOnLogout() silently no-ops
    // via optional chaining and the session resurrects dead creds forever.
    expect(typeof auth.clear).toBe('function');
    expect(typeof auth.close).toBe('function');

    await auth.clear();
    expect(authState.clear).toHaveBeenCalled();
  });
});
