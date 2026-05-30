// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs-extra');

import { ISessionAuthRepository } from './ISessionAuthRepository';
import { LocalStore } from './LocalStore';
import { LocalStoreCore } from './LocalStoreCore';
import {
  AUTH_STATE_TABLE,
  AUTH_BACKUP_TABLE,
} from '../engines/noweb/useSQLiteAuthState';
// Keep all waha related files, ".waha.session.*"
const KEEP_FILES = /^\.waha\.session\..*$/;

export class LocalSessionAuthRepository extends ISessionAuthRepository {
  private store: LocalStore;

  constructor(store: LocalStore) {
    super();
    this.store = store;
  }

  async init(sessionName?: string) {
    await this.store.init(sessionName);
  }

  async clean(sessionName: string) {
    // Clear SQLite auth rows so the next startup generates a fresh QR
    if (this.store instanceof LocalStoreCore) {
      const knex = this.store.getWAHADatabase();
      await knex(AUTH_STATE_TABLE).where({ session: sessionName }).delete();
      await knex(AUTH_BACKUP_TABLE).where({ session: sessionName }).delete();
    }

    // Remove all files and directories recursively, but keep waha files
    const sessionDirectory = this.store.getSessionDirectory(sessionName);
    // Check it exists and it's directory
    const exists = await fs.pathExists(sessionDirectory);
    if (!exists) {
      return;
    }
    const files = await fs.readdir(sessionDirectory);
    const filesToRemove = files.filter((file) => !file.match(KEEP_FILES));
    for (const file of filesToRemove) {
      await fs.remove(`${sessionDirectory}/${file}`);
    }
  }
}
