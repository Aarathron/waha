import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WarmupService } from './warmup.service';
import { RecipientRateLimitService } from './recipient-rate-limit.service';
import { BanPreventionConfig } from '../config/ban-prevention.config';
import { Logger } from 'pino';
import pino from 'pino';

@Injectable()
export class BanPreventionCronService implements OnModuleInit {
  private logger: Logger;

  constructor(
    private warmupService: WarmupService,
    private rateLimitService: RecipientRateLimitService,
    private config: BanPreventionConfig
  ) {
    this.logger = pino().child({ name: 'BanPreventionCron' });
  }

  onModuleInit() {
    if (this.config.enabled) {
      this.logger.info('Ban prevention cron jobs initialized');
    } else {
      this.logger.info('Ban prevention is disabled - cron jobs will not run');
    }
  }

  /**
   * Reset daily quotas at midnight (server timezone)
   * Runs every day at 00:00
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async resetDailyQuotas() {
    if (!this.config.enabled) return;

    try {
      this.logger.info('Starting daily quota reset...');
      const resetCount = await this.warmupService.resetDailyQuotas();
      this.logger.info({ resetCount }, 'Daily quota reset completed');
    } catch (error) {
      this.logger.error({ error }, 'Failed to reset daily quotas');
    }
  }

  /**
   * Advance warmup stages at 1 AM
   * Runs every day at 01:00
   */
  @Cron('0 1 * * *')
  async advanceWarmupStages() {
    if (!this.config.enabled) return;

    try {
      this.logger.info('Starting warmup stage advancement check...');
      const advancedCount = await this.warmupService.advanceAllStages();
      this.logger.info({ advancedCount }, 'Warmup stage advancement completed');
    } catch (error) {
      this.logger.error({ error }, 'Failed to advance warmup stages');
    }
  }

  /**
   * Cleanup expired rate limit windows
   * Runs every 6 hours
   */
  @Cron('0 */6 * * *')
  async cleanupExpiredWindows() {
    if (!this.config.enabled) return;

    try {
      this.logger.debug('Starting expired rate limit cleanup...');
      const cleanedCount = await this.rateLimitService.cleanupExpiredWindows();
      if (cleanedCount > 0) {
        this.logger.info({ cleanedCount }, 'Rate limit cleanup completed');
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to cleanup expired rate limits');
    }
  }

  /**
   * Health check - runs every hour to ensure cron is working
   */
  @Cron(CronExpression.EVERY_HOUR)
  async healthCheck() {
    if (!this.config.enabled) return;
    this.logger.debug('Ban prevention cron health check - OK');
  }
}
