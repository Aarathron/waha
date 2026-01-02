import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { BanPreventionConfig, WarmupStage } from '../config/ban-prevention.config';
import { Logger } from 'pino';
import pino from 'pino';

export interface WarmupConfig {
  id: string;
  sessionName: string;
  stage: WarmupStage;
  startDate: Date;
  dailyQuota: number;
  lastReset: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecipientRateLimit {
  id: string;
  sessionName: string;
  recipient: string;
  messageCount: number;
  windowStart: Date;
  lastMessageAt: Date | null;
}

export interface SafetyMetrics {
  id: string;
  sessionName: string;
  date: Date;
  messagesSent: number;
  messagesDelivered: number;
  messagesFailed: number;
  uniqueRecipients: number;
  responsesReceived: number;
}

@Injectable()
export class BanPreventionDatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;
  private logger: Logger;

  constructor(private config: BanPreventionConfig) {
    this.logger = pino().child({ name: 'BanPreventionDB' });
  }

  async onModuleInit() {
    if (!this.config.enabled) {
      this.logger.info('Ban prevention is disabled, skipping database connection');
      return;
    }

    this.pool = new Pool({
      connectionString: this.config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      this.logger.info('Ban prevention database connected successfully');
    } catch (error) {
      this.logger.error({ error }, 'Failed to connect to ban prevention database');
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
      this.logger.info('Ban prevention database connection closed');
    }
  }

  // ==================== WARMUP CONFIG ====================

  async getWarmupConfig(sessionName: string): Promise<WarmupConfig | null> {
    const result = await this.pool.query<WarmupConfig>(
      `SELECT id, session_name as "sessionName", stage, start_date as "startDate",
              daily_quota as "dailyQuota", last_reset as "lastReset",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM warmup_configs WHERE session_name = $1`,
      [sessionName]
    );
    return result.rows[0] || null;
  }

  async createWarmupConfig(sessionName: string): Promise<WarmupConfig> {
    const result = await this.pool.query<WarmupConfig>(
      `INSERT INTO warmup_configs (session_name, stage, start_date, daily_quota, last_reset)
       VALUES ($1, 'PHASE_1_PROFILE', NOW(), 0, NOW())
       ON CONFLICT (session_name) DO NOTHING
       RETURNING id, session_name as "sessionName", stage, start_date as "startDate",
                 daily_quota as "dailyQuota", last_reset as "lastReset",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [sessionName]
    );

    if (result.rows.length === 0) {
      // Already exists, fetch it
      return this.getWarmupConfig(sessionName) as Promise<WarmupConfig>;
    }

    return result.rows[0];
  }

  async updateWarmupStage(sessionName: string, stage: WarmupStage): Promise<void> {
    await this.pool.query(
      `UPDATE warmup_configs SET stage = $2, updated_at = NOW()
       WHERE session_name = $1`,
      [sessionName, stage]
    );
  }

  async incrementDailyQuota(sessionName: string): Promise<number> {
    const result = await this.pool.query<{ daily_quota: number }>(
      `UPDATE warmup_configs SET daily_quota = daily_quota + 1, updated_at = NOW()
       WHERE session_name = $1
       RETURNING daily_quota`,
      [sessionName]
    );
    return result.rows[0]?.daily_quota || 0;
  }

  async resetAllDailyQuotas(): Promise<number> {
    const result = await this.pool.query(
      `UPDATE warmup_configs SET daily_quota = 0, last_reset = NOW(), updated_at = NOW()
       WHERE daily_quota > 0`
    );
    return result.rowCount || 0;
  }

  async getAllWarmupConfigs(): Promise<WarmupConfig[]> {
    const result = await this.pool.query<WarmupConfig>(
      `SELECT id, session_name as "sessionName", stage, start_date as "startDate",
              daily_quota as "dailyQuota", last_reset as "lastReset",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM warmup_configs`
    );
    return result.rows;
  }

  // ==================== RECIPIENT RATE LIMITS ====================

  async getRecipientRateLimit(
    sessionName: string,
    recipient: string
  ): Promise<RecipientRateLimit | null> {
    const result = await this.pool.query<RecipientRateLimit>(
      `SELECT id, session_name as "sessionName", recipient,
              message_count as "messageCount", window_start as "windowStart",
              last_message_at as "lastMessageAt"
       FROM recipient_rate_limits
       WHERE session_name = $1 AND recipient = $2`,
      [sessionName, recipient]
    );
    return result.rows[0] || null;
  }

  async upsertRecipientRateLimit(
    sessionName: string,
    recipient: string
  ): Promise<RecipientRateLimit> {
    const result = await this.pool.query<RecipientRateLimit>(
      `INSERT INTO recipient_rate_limits (session_name, recipient, message_count, window_start)
       VALUES ($1, $2, 0, NOW())
       ON CONFLICT (session_name, recipient) DO UPDATE
       SET message_count = recipient_rate_limits.message_count
       RETURNING id, session_name as "sessionName", recipient,
                 message_count as "messageCount", window_start as "windowStart",
                 last_message_at as "lastMessageAt"`,
      [sessionName, recipient]
    );
    return result.rows[0];
  }

  async incrementRecipientMessageCount(
    sessionName: string,
    recipient: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE recipient_rate_limits
       SET message_count = message_count + 1, last_message_at = NOW()
       WHERE session_name = $1 AND recipient = $2`,
      [sessionName, recipient]
    );
  }

  async resetRecipientWindow(sessionName: string, recipient: string): Promise<void> {
    await this.pool.query(
      `UPDATE recipient_rate_limits
       SET message_count = 0, window_start = NOW(), last_message_at = NULL
       WHERE session_name = $1 AND recipient = $2`,
      [sessionName, recipient]
    );
  }

  async cleanupExpiredRecipientWindows(windowDurationMs: number): Promise<number> {
    const windowDurationInterval = `${Math.floor(windowDurationMs / 1000)} seconds`;
    const result = await this.pool.query(
      `DELETE FROM recipient_rate_limits
       WHERE window_start < NOW() - INTERVAL '${windowDurationInterval}'`
    );
    return result.rowCount || 0;
  }

  // ==================== SAFETY METRICS ====================

  async getTodayMetrics(sessionName: string): Promise<SafetyMetrics | null> {
    const result = await this.pool.query<SafetyMetrics>(
      `SELECT id, session_name as "sessionName", date,
              messages_sent as "messagesSent", messages_delivered as "messagesDelivered",
              messages_failed as "messagesFailed", unique_recipients as "uniqueRecipients",
              responses_received as "responsesReceived"
       FROM safety_metrics
       WHERE session_name = $1 AND date = CURRENT_DATE`,
      [sessionName]
    );
    return result.rows[0] || null;
  }

  async incrementMessagesSent(sessionName: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO safety_metrics (session_name, date, messages_sent)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (session_name, date)
       DO UPDATE SET messages_sent = safety_metrics.messages_sent + 1`
    );
  }

  async incrementMessagesDelivered(sessionName: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO safety_metrics (session_name, date, messages_delivered)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (session_name, date)
       DO UPDATE SET messages_delivered = safety_metrics.messages_delivered + 1`
    );
  }

  async incrementMessagesFailed(sessionName: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO safety_metrics (session_name, date, messages_failed)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (session_name, date)
       DO UPDATE SET messages_failed = safety_metrics.messages_failed + 1`
    );
  }

  async incrementUniqueRecipients(sessionName: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO safety_metrics (session_name, date, unique_recipients)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (session_name, date)
       DO UPDATE SET unique_recipients = safety_metrics.unique_recipients + 1`
    );
  }

  async incrementResponsesReceived(sessionName: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO safety_metrics (session_name, date, responses_received)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (session_name, date)
       DO UPDATE SET responses_received = safety_metrics.responses_received + 1`
    );
  }

  async getMetricsHistory(
    sessionName: string,
    days: number = 30
  ): Promise<SafetyMetrics[]> {
    const result = await this.pool.query<SafetyMetrics>(
      `SELECT id, session_name as "sessionName", date,
              messages_sent as "messagesSent", messages_delivered as "messagesDelivered",
              messages_failed as "messagesFailed", unique_recipients as "uniqueRecipients",
              responses_received as "responsesReceived"
       FROM safety_metrics
       WHERE session_name = $1 AND date >= CURRENT_DATE - INTERVAL '${days} days'
       ORDER BY date DESC`,
      [sessionName]
    );
    return result.rows;
  }

  // ==================== MESSAGE LOGS ====================

  async logMessage(
    sessionName: string,
    recipient: string,
    messageType: string,
    status: string = 'PENDING'
  ): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO message_logs (session_name, recipient, message_type, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [sessionName, recipient, messageType, status]
    );
    return result.rows[0].id;
  }

  async updateMessageStatus(
    messageId: string,
    status: string,
    errorMessage?: string
  ): Promise<void> {
    if (status === 'DELIVERED') {
      await this.pool.query(
        `UPDATE message_logs SET status = $2, delivered_at = NOW()
         WHERE id = $1`,
        [messageId, status]
      );
    } else if (status === 'READ') {
      await this.pool.query(
        `UPDATE message_logs SET status = $2, read_at = NOW()
         WHERE id = $1`,
        [messageId, status]
      );
    } else if (status === 'FAILED') {
      await this.pool.query(
        `UPDATE message_logs SET status = $2, error_message = $3
         WHERE id = $1`,
        [messageId, status, errorMessage]
      );
    } else {
      await this.pool.query(
        `UPDATE message_logs SET status = $2
         WHERE id = $1`,
        [messageId, status]
      );
    }
  }
}
