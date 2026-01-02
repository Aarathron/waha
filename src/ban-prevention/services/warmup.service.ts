import { Injectable } from '@nestjs/common';
import { BanPreventionConfig, WarmupStage } from '../config/ban-prevention.config';
import { BanPreventionDatabaseService, WarmupConfig } from './database.service';
import { Logger } from 'pino';
import pino from 'pino';

export interface MessageAllowedResult {
  allowed: boolean;
  reason?: string;
  retryAfterSeconds?: number;
  warmupStage?: WarmupStage;
  dailyQuota?: number;
  maxDaily?: number;
}

@Injectable()
export class WarmupService {
  private logger: Logger;

  constructor(
    private config: BanPreventionConfig,
    private db: BanPreventionDatabaseService
  ) {
    this.logger = pino().child({ name: 'WarmupService' });
  }

  /**
   * Check if a session is allowed to send a message based on warmup rules
   */
  async checkMessageAllowed(sessionName: string): Promise<MessageAllowedResult> {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    let warmupConfig = await this.db.getWarmupConfig(sessionName);

    if (!warmupConfig) {
      // Create config for new session - starts in PHASE_1_PROFILE
      warmupConfig = await this.db.createWarmupConfig(sessionName);
      this.logger.info(
        { sessionName, stage: warmupConfig.stage },
        'Created new warmup config for session'
      );
    }

    // Check if we need to advance the stage
    await this.advanceStageIfNeeded(warmupConfig);

    // Refresh config after potential stage advancement
    warmupConfig = (await this.db.getWarmupConfig(sessionName)) as WarmupConfig;

    const rules = this.config.warmupRules[warmupConfig.stage];

    // Phase 1: No messaging allowed
    if (warmupConfig.stage === 'PHASE_1_PROFILE') {
      return {
        allowed: false,
        reason: `Session in warmup Phase 1 (profile setup only). No messaging allowed for ${this.config.warmupPhase1Days} days.`,
        warmupStage: warmupConfig.stage,
        dailyQuota: warmupConfig.dailyQuota,
        maxDaily: rules.maxDaily,
      };
    }

    // Check daily quota
    if (warmupConfig.dailyQuota >= rules.maxDaily) {
      const retryAfterSeconds = this.getSecondsUntilMidnight();
      return {
        allowed: false,
        reason: `Daily limit reached (${warmupConfig.dailyQuota}/${rules.maxDaily}) for ${warmupConfig.stage}`,
        retryAfterSeconds,
        warmupStage: warmupConfig.stage,
        dailyQuota: warmupConfig.dailyQuota,
        maxDaily: rules.maxDaily,
      };
    }

    return {
      allowed: true,
      warmupStage: warmupConfig.stage,
      dailyQuota: warmupConfig.dailyQuota,
      maxDaily: rules.maxDaily,
    };
  }

  /**
   * Record that a message was sent (increment daily quota)
   */
  async recordMessageSent(sessionName: string): Promise<number> {
    if (!this.config.enabled) {
      return 0;
    }

    const newQuota = await this.db.incrementDailyQuota(sessionName);
    await this.db.incrementMessagesSent(sessionName);

    this.logger.debug(
      { sessionName, dailyQuota: newQuota },
      'Recorded message sent'
    );

    return newQuota;
  }

  /**
   * Advance warmup stage if enough days have passed
   */
  async advanceStageIfNeeded(warmupConfig: WarmupConfig): Promise<boolean> {
    const daysSinceStart = this.getDaysSince(warmupConfig.startDate);
    const transitionDays = this.config.getPhaseTransitionDays();

    let newStage = warmupConfig.stage;

    if (daysSinceStart >= transitionDays.COMPLETED) {
      newStage = 'COMPLETED';
    } else if (daysSinceStart >= transitionDays.PHASE_4_GRADUAL) {
      newStage = 'PHASE_4_GRADUAL';
    } else if (daysSinceStart >= transitionDays.PHASE_3_LIMITED) {
      newStage = 'PHASE_3_LIMITED';
    } else if (daysSinceStart >= transitionDays.PHASE_2_RECEIVE) {
      newStage = 'PHASE_2_RECEIVE';
    }

    if (newStage !== warmupConfig.stage) {
      await this.db.updateWarmupStage(warmupConfig.sessionName, newStage);
      this.logger.info(
        {
          sessionName: warmupConfig.sessionName,
          oldStage: warmupConfig.stage,
          newStage,
          daysSinceStart,
        },
        'Advanced warmup stage'
      );
      return true;
    }

    return false;
  }

  /**
   * Manually advance all sessions to appropriate warmup stages (cron job)
   */
  async advanceAllStages(): Promise<number> {
    const configs = await this.db.getAllWarmupConfigs();
    let advancedCount = 0;

    for (const config of configs) {
      const advanced = await this.advanceStageIfNeeded(config);
      if (advanced) {
        advancedCount++;
      }
    }

    this.logger.info(
      { totalConfigs: configs.length, advancedCount },
      'Completed warmup stage advancement check'
    );

    return advancedCount;
  }

  /**
   * Reset all daily quotas (cron job - runs at midnight)
   */
  async resetDailyQuotas(): Promise<number> {
    const resetCount = await this.db.resetAllDailyQuotas();
    this.logger.info({ resetCount }, 'Reset daily message quotas');
    return resetCount;
  }

  /**
   * Get warmup status for a session
   */
  async getWarmupStatus(sessionName: string): Promise<{
    stage: WarmupStage;
    daysSinceStart: number;
    dailyQuota: number;
    maxDaily: number;
    usagePercent: number;
    stageDescription: string;
    daysUntilNextStage: number;
    isCompleted: boolean;
  } | null> {
    const config = await this.db.getWarmupConfig(sessionName);
    if (!config) {
      return null;
    }

    const rules = this.config.warmupRules[config.stage];
    const daysSinceStart = this.getDaysSince(config.startDate);
    const transitionDays = this.config.getPhaseTransitionDays();

    let daysUntilNextStage = 0;
    if (config.stage !== 'COMPLETED') {
      const nextStageDay = this.getNextStageTransitionDay(config.stage, transitionDays);
      daysUntilNextStage = Math.max(0, nextStageDay - daysSinceStart);
    }

    return {
      stage: config.stage,
      daysSinceStart: Math.floor(daysSinceStart),
      dailyQuota: config.dailyQuota,
      maxDaily: rules.maxDaily,
      usagePercent: rules.maxDaily > 0 ? Math.round((config.dailyQuota / rules.maxDaily) * 100) : 0,
      stageDescription: rules.description,
      daysUntilNextStage: Math.ceil(daysUntilNextStage),
      isCompleted: config.stage === 'COMPLETED',
    };
  }

  /**
   * Force reset a session's warmup (use with caution - for testing or new numbers)
   */
  async resetWarmup(sessionName: string): Promise<void> {
    await this.db.updateWarmupStage(sessionName, 'PHASE_1_PROFILE');
    await this.db.resetAllDailyQuotas();
    this.logger.warn({ sessionName }, 'Warmup reset to Phase 1');
  }

  // ==================== HELPER METHODS ====================

  private getDaysSince(startDate: Date): number {
    const now = new Date();
    const diffMs = now.getTime() - new Date(startDate).getTime();
    return diffMs / (1000 * 60 * 60 * 24);
  }

  private getSecondsUntilMidnight(): number {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return Math.floor((midnight.getTime() - now.getTime()) / 1000);
  }

  private getNextStageTransitionDay(
    currentStage: WarmupStage,
    transitionDays: Record<WarmupStage, number>
  ): number {
    const stages: WarmupStage[] = [
      'PHASE_1_PROFILE',
      'PHASE_2_RECEIVE',
      'PHASE_3_LIMITED',
      'PHASE_4_GRADUAL',
      'COMPLETED',
    ];

    const currentIndex = stages.indexOf(currentStage);
    if (currentIndex < stages.length - 1) {
      return transitionDays[stages[currentIndex + 1]];
    }
    return 0;
  }
}
