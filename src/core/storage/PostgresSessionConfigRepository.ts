import Knex from 'knex';

import { SessionConfig } from '../../structures/sessions.dto';
import { ISessionConfigRepository } from './ISessionConfigRepository';

const TABLE_NAME = 'waha_session_configs';

export class PostgresSessionConfigRepository extends ISessionConfigRepository {
  private knex: Knex.Knex;
  private initPromise: Promise<void> | null = null;

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
    // Use promise-based initialization to prevent race conditions
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    // Validate connection first
    try {
      await this.knex.raw('SELECT 1');
    } catch (error) {
      throw new Error(
        `PostgreSQL connection failed. Please verify WHATSAPP_SESSIONS_POSTGRESQL_URL is correct ` +
          `and the database is accessible. Error: ${error.message}`,
      );
    }

    // Create table if not exists
    try {
      const exists = await this.knex.schema.hasTable(TABLE_NAME);
      if (!exists) {
        await this.knex.schema.createTable(TABLE_NAME, (table) => {
          table.string('session_name', 255).primary();
          table.jsonb('config').notNullable().defaultTo('{}');
          table.timestamp('created_at').defaultTo(this.knex.fn.now());
          table.timestamp('updated_at').defaultTo(this.knex.fn.now());
        });
      }
    } catch (error) {
      throw new Error(
        `Failed to initialize session config table. Error: ${error.message}`,
      );
    }
  }

  async exists(sessionName: string): Promise<boolean> {
    try {
      const result = await this.knex(TABLE_NAME)
        .where('session_name', sessionName)
        .first();
      return !!result;
    } catch (error) {
      throw new Error(
        `Failed to check if session '${sessionName}' exists. Error: ${error.message}`,
      );
    }
  }

  async getConfig(sessionName: string): Promise<SessionConfig | null> {
    try {
      const result = await this.knex(TABLE_NAME)
        .where('session_name', sessionName)
        .first();

      if (!result) {
        return null;
      }

      // Handle JSONB - PostgreSQL returns it as an object already
      return result.config as SessionConfig;
    } catch (error) {
      throw new Error(
        `Failed to get config for session '${sessionName}'. Error: ${error.message}`,
      );
    }
  }

  async saveConfig(sessionName: string, config: SessionConfig): Promise<void> {
    const now = new Date();

    try {
      // Upsert: insert or update on conflict
      // Note: Knex/pg handles JSONB serialization automatically
      await this.knex(TABLE_NAME)
        .insert({
          session_name: sessionName,
          config: config || {},
          created_at: now,
          updated_at: now,
        })
        .onConflict('session_name')
        .merge({
          config: config || {},
          updated_at: now,
        });
    } catch (error) {
      throw new Error(
        `Failed to save config for session '${sessionName}'. Error: ${error.message}`,
      );
    }
  }

  async deleteConfig(sessionName: string): Promise<void> {
    try {
      await this.knex(TABLE_NAME).where('session_name', sessionName).delete();
    } catch (error) {
      throw new Error(
        `Failed to delete config for session '${sessionName}'. Error: ${error.message}`,
      );
    }
  }

  async getAllConfigs(): Promise<string[]> {
    try {
      const results = await this.knex(TABLE_NAME).select('session_name');
      return results.map((row) => row.session_name);
    } catch (error) {
      throw new Error(
        `Failed to get all session configs. Error: ${error.message}`,
      );
    }
  }

  async close(): Promise<void> {
    try {
      await this.knex.destroy();
    } catch (error) {
      // Log but don't throw on close - best effort cleanup
      console.error('Error closing PostgreSQL connection:', error.message);
    }
  }
}
