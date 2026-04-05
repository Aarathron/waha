import { DataStore } from '../../abc/DataStore';
import { LocalStore } from '../../storage/LocalStore';
import { LocalStoreCore } from '../../storage/LocalStoreCore';
import { useSQLiteAuthState } from './useSQLiteAuthState';

export class NowebAuthFactoryCore {
  buildAuth(store: DataStore, name: string) {
    if (store instanceof LocalStore) return this.buildLocalAuth(store, name);
    throw new Error(`Unsupported store type '${store.constructor.name}'`);
  }

  protected async buildLocalAuth(store: LocalStore, name: string) {
    await store.init(name);
    const authFolder = store.getSessionDirectory(name);
    if (!(store instanceof LocalStoreCore)) {
      throw new Error(
        `buildLocalAuth requires a LocalStoreCore instance but got '${store.constructor.name}'. SQLite auth state is not available for this store type.`,
      );
    }
    const knex = store.getWAHADatabase();
    const { state, saveCreds, close } = await useSQLiteAuthState(knex, name, {
      migrateFromFolder: authFolder,
    });
    return { state, saveCreds, close };
  }
}
