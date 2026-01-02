import { Injectable } from '@nestjs/common';
import { BanPreventionConfig } from '../config/ban-prevention.config';
import { BanPreventionDatabaseService } from './database.service';
import { Logger } from 'pino';
import pino from 'pino';

export interface RateLimitCheckResult {
  allowed: boolean;
  reason?: string;
  retryAfterSeconds?: number;
  messageCount?: number;
  maxMessages?: number;
  isNewRecipient?: boolean;
}

@Injectable()
export class RecipientRateLimitService {
  private logger: Logger;
  private readonly WINDOW_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    private config: BanPreventionConfig,
    private db: BanPreventionDatabaseService
  ) {
    this.logger = pino().child({ name: 'RecipientRateLimit' });
  }

  /**
   * Check if sending a message to a specific recipient is allowed
   */
  async checkAllowed(sessionName: string, recipient: string): Promise<RateLimitCheckResult> {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    // Normalize recipient (remove @c.us, @g.us suffixes if present)
    const normalizedRecipient = this.normalizeRecipient(recipient);

    let limit = await this.db.getRecipientRateLimit(sessionName, normalizedRecipient);
    const now = new Date();

    if (!limit) {
      // First message to this recipient - create rate limit record
      await this.db.upsertRecipientRateLimit(sessionName, normalizedRecipient);
      this.logger.debug(
        { sessionName, recipient: normalizedRecipient },
        'New recipient - rate limit initialized'
      );
      return {
        allowed: true,
        isNewRecipient: true,
        messageCount: 0,
        maxMessages: this.config.maxMessagesPerRecipientPerDay,
      };
    }

    // Check if window expired (24 hours)
    const windowAge = now.getTime() - new Date(limit.windowStart).getTime();
    if (windowAge > this.WINDOW_DURATION_MS) {
      // Reset window
      await this.db.resetRecipientWindow(sessionName, normalizedRecipient);
      this.logger.debug(
        { sessionName, recipient: normalizedRecipient, windowAgeHours: windowAge / 3600000 },
        'Rate limit window expired - reset'
      );
      return {
        allowed: true,
        messageCount: 0,
        maxMessages: this.config.maxMessagesPerRecipientPerDay,
      };
    }

    // Check daily limit per recipient
    if (limit.messageCount >= this.config.maxMessagesPerRecipientPerDay) {
      const retryAfterSeconds = Math.ceil((this.WINDOW_DURATION_MS - windowAge) / 1000);
      this.logger.warn(
        {
          sessionName,
          recipient: normalizedRecipient,
          messageCount: limit.messageCount,
          maxMessages: this.config.maxMessagesPerRecipientPerDay,
        },
        'Recipient daily limit reached'
      );
      return {
        allowed: false,
        reason: `Recipient daily limit reached (${limit.messageCount}/${this.config.maxMessagesPerRecipientPerDay})`,
        retryAfterSeconds,
        messageCount: limit.messageCount,
        maxMessages: this.config.maxMessagesPerRecipientPerDay,
      };
    }

    // Check minimum interval between messages to same recipient
    if (limit.lastMessageAt) {
      const timeSinceLast = now.getTime() - new Date(limit.lastMessageAt).getTime();
      const minInterval = this.config.minIntervalBetweenMessagesMs;

      if (timeSinceLast < minInterval) {
        const retryAfterSeconds = Math.ceil((minInterval - timeSinceLast) / 1000);
        this.logger.debug(
          {
            sessionName,
            recipient: normalizedRecipient,
            timeSinceLastMs: timeSinceLast,
            minIntervalMs: minInterval,
          },
          'Minimum interval not met'
        );
        return {
          allowed: false,
          reason: `Minimum interval not met (${Math.floor(timeSinceLast / 1000)}s / ${Math.floor(minInterval / 1000)}s)`,
          retryAfterSeconds,
          messageCount: limit.messageCount,
          maxMessages: this.config.maxMessagesPerRecipientPerDay,
        };
      }
    }

    return {
      allowed: true,
      messageCount: limit.messageCount,
      maxMessages: this.config.maxMessagesPerRecipientPerDay,
    };
  }

  /**
   * Record that a message was sent to a recipient
   */
  async recordMessage(sessionName: string, recipient: string): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const normalizedRecipient = this.normalizeRecipient(recipient);

    // Ensure rate limit record exists
    await this.db.upsertRecipientRateLimit(sessionName, normalizedRecipient);

    // Increment message count
    await this.db.incrementRecipientMessageCount(sessionName, normalizedRecipient);

    this.logger.debug(
      { sessionName, recipient: normalizedRecipient },
      'Recorded message to recipient'
    );
  }

  /**
   * Get rate limit status for a specific recipient
   */
  async getRecipientStatus(
    sessionName: string,
    recipient: string
  ): Promise<{
    messageCount: number;
    maxMessages: number;
    usagePercent: number;
    windowResetIn: number;
    canSendNow: boolean;
    nextAllowedIn: number;
  } | null> {
    const normalizedRecipient = this.normalizeRecipient(recipient);
    const limit = await this.db.getRecipientRateLimit(sessionName, normalizedRecipient);

    if (!limit) {
      return {
        messageCount: 0,
        maxMessages: this.config.maxMessagesPerRecipientPerDay,
        usagePercent: 0,
        windowResetIn: 0,
        canSendNow: true,
        nextAllowedIn: 0,
      };
    }

    const now = new Date();
    const windowAge = now.getTime() - new Date(limit.windowStart).getTime();
    const windowResetIn = Math.max(0, Math.ceil((this.WINDOW_DURATION_MS - windowAge) / 1000));

    let nextAllowedIn = 0;
    let canSendNow = true;

    // Check if at daily limit
    if (limit.messageCount >= this.config.maxMessagesPerRecipientPerDay) {
      canSendNow = false;
      nextAllowedIn = windowResetIn;
    } else if (limit.lastMessageAt) {
      // Check minimum interval
      const timeSinceLast = now.getTime() - new Date(limit.lastMessageAt).getTime();
      if (timeSinceLast < this.config.minIntervalBetweenMessagesMs) {
        canSendNow = false;
        nextAllowedIn = Math.ceil((this.config.minIntervalBetweenMessagesMs - timeSinceLast) / 1000);
      }
    }

    return {
      messageCount: limit.messageCount,
      maxMessages: this.config.maxMessagesPerRecipientPerDay,
      usagePercent: Math.round((limit.messageCount / this.config.maxMessagesPerRecipientPerDay) * 100),
      windowResetIn,
      canSendNow,
      nextAllowedIn,
    };
  }

  /**
   * Cleanup expired rate limit windows (cron job)
   */
  async cleanupExpiredWindows(): Promise<number> {
    const cleanedCount = await this.db.cleanupExpiredRecipientWindows(this.WINDOW_DURATION_MS * 2);
    if (cleanedCount > 0) {
      this.logger.info({ cleanedCount }, 'Cleaned up expired recipient rate limit windows');
    }
    return cleanedCount;
  }

  /**
   * Get a random delay for human-like message timing
   */
  getRandomDelay(): number {
    return this.config.getRandomDelay();
  }

  // ==================== HELPER METHODS ====================

  private normalizeRecipient(recipient: string): string {
    // Remove WhatsApp suffixes
    return recipient.replace(/@c\.us$/, '').replace(/@g\.us$/, '').replace(/@s\.whatsapp\.net$/, '');
  }
}
