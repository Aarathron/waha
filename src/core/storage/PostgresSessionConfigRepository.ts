import Knex from 'knex';

import { SessionConfig } from '../../structures/sessions.dto';
import { ISessionConfigRepository } from './ISessionConfigRepository';

const TABLE_NAME = 'waha_session_configs';

export class PostgresSessionConfigRepository extends ISessionConfigRepository {
  private knex: Knex.Knex;
  private initialized = false;

  constructor(connectionString: string) {
    super();
    this.knex = Knex({
      client: 'pg',
      connection: connectionString,
      pool: {
        min: 1,
        max: 10,
        idleTimeoutMillis: 30_000,
      },
    });
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Create table if not exists
    const exists = await this.knex.schema.hasTable(TABLE_NAME);
    if (!exists) {
      await this.knex.schema.createTable(TABLE_NAME, (table) => {
        table.string('session_name', 255).primary();
        table.jsonb('config').notNullable().defaultTo('{}');
        table.timestamp('created_at').defaultTo(this.knex.fn.now());
        table.timestamp('updated_at').defaultTo(this.knex.fn.now());
      });
    }

    this.initialized = true;
  }

  async exists(sessionName: string): Promise<boolean> {
    const result = await this.knex(TABLE_NAME)
      .where('session_name', sessionName)
      .first();
    return !!result;
  }

  async getConfig(sessionName: string): Promise<SessionConfig | null> {
    const result = await this.knex(TABLE_NAME)
      .where('session_name', sessionName)
      .first();

    if (!result) {
      return null;
    }

    // Handle JSONB - PostgreSQL returns it as an object already
    return result.config as SessionConfig;
  }

  async saveConfig(sessionName: string, config: SessionConfig): Promise<void> {
    const now = new Date();
    const data = {
      session_name: sessionName,
      config: JSON.stringify(config || {}),
      updated_at: now,
    };

    // Upsert: insert or update on conflict
    await this.knex(TABLE_NAME)
      .insert({
        ...data,
        created_at: now,
      })
      .onConflict('session_name')
      .merge({
        config: data.config,
        updated_at: data.updated_at,
      });
  }

  async deleteConfig(sessionName: string): Promise<void> {
    await this.knex(TABLE_NAME).where('session_name', sessionName).delete();
  }

  async getAllConfigs(): Promise<string[]> {
    const results = await this.knex(TABLE_NAME).select('session_name');
    return results.map((row) => row.session_name);
  }

  async close(): Promise<void> {
    await this.knex.destroy();
  }
}
