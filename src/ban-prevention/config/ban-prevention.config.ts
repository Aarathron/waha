import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface WarmupPhaseConfig {
  maxDaily: number;
  minIntervalMs: number;
  description: string;
}

export type WarmupStage =
  | 'PHASE_1_PROFILE'
  | 'PHASE_2_RECEIVE'
  | 'PHASE_3_LIMITED'
  | 'PHASE_4_GRADUAL'
  | 'COMPLETED';

@Injectable()
export class BanPreventionConfig {
  readonly enabled: boolean;
  readonly databaseUrl: string;

  // Warmup phase durations (in days)
  readonly warmupPhase1Days: number;
  readonly warmupPhase2Days: number;
  readonly warmupPhase3Days: number;
  readonly warmupPhase4Days: number;

  // Rate limiting
  readonly maxMessagesPerRecipientPerDay: number;
  readonly minIntervalBetweenMessagesMs: number;
  readonly randomDelayMinMs: number;
  readonly randomDelayMaxMs: number;

  // Warmup phase configurations
  readonly warmupRules: Record<WarmupStage, WarmupPhaseConfig>;

  constructor(private configService: ConfigService) {
    this.enabled = this.configService.get<string>('BAN_PREVENTION_ENABLED', 'true') === 'true';
    this.databaseUrl = this.configService.get<string>(
      'BAN_PREVENTION_DATABASE_URL',
      'postgres://postgres:postgres@localhost:5432/waha?sslmode=disable'
    );

    // Warmup durations
    this.warmupPhase1Days = parseInt(this.configService.get<string>('WARMUP_PHASE_1_DAYS', '2'), 10);
    this.warmupPhase2Days = parseInt(this.configService.get<string>('WARMUP_PHASE_2_DAYS', '2'), 10);
    this.warmupPhase3Days = parseInt(this.configService.get<string>('WARMUP_PHASE_3_DAYS', '4'), 10);
    this.warmupPhase4Days = parseInt(this.configService.get<string>('WARMUP_PHASE_4_DAYS', '13'), 10);

    // Rate limiting
    this.maxMessagesPerRecipientPerDay = parseInt(
      this.configService.get<string>('MAX_MESSAGES_PER_RECIPIENT_PER_DAY', '15'),
      10
    );
    this.minIntervalBetweenMessagesMs = parseInt(
      this.configService.get<string>('MIN_INTERVAL_BETWEEN_MESSAGES_MS', '180000'),
      10
    ); // 3 minutes
    this.randomDelayMinMs = parseInt(
      this.configService.get<string>('RANDOM_DELAY_MIN_MS', '2000'),
      10
    );
    this.randomDelayMaxMs = parseInt(
      this.configService.get<string>('RANDOM_DELAY_MAX_MS', '5000'),
      10
    );

    // Warmup rules per phase
    const phase1MaxDaily = parseInt(this.configService.get<string>('WARMUP_PHASE_1_MAX_DAILY', '0'), 10);
    const phase2MaxDaily = parseInt(this.configService.get<string>('WARMUP_PHASE_2_MAX_DAILY', '5'), 10);
    const phase3MaxDaily = parseInt(this.configService.get<string>('WARMUP_PHASE_3_MAX_DAILY', '40'), 10);
    const phase4MaxDaily = parseInt(this.configService.get<string>('WARMUP_PHASE_4_MAX_DAILY', '80'), 10);
    const completedMaxDaily = parseInt(this.configService.get<string>('WARMUP_COMPLETED_MAX_DAILY', '100'), 10);

    this.warmupRules = {
      PHASE_1_PROFILE: {
        maxDaily: phase1MaxDaily,
        minIntervalMs: 0,
        description: 'Profile setup only - no messaging allowed',
      },
      PHASE_2_RECEIVE: {
        maxDaily: phase2MaxDaily,
        minIntervalMs: 7200000, // 2 hours
        description: 'Receive and reply only - max 5 replies/day',
      },
      PHASE_3_LIMITED: {
        maxDaily: phase3MaxDaily,
        minIntervalMs: 180000, // 3 minutes
        description: 'Limited sending - max 40 messages/day',
      },
      PHASE_4_GRADUAL: {
        maxDaily: phase4MaxDaily,
        minIntervalMs: 120000, // 2 minutes
        description: 'Gradual increase - max 80 messages/day',
      },
      COMPLETED: {
        maxDaily: completedMaxDaily,
        minIntervalMs: 60000, // 1 minute
        description: 'Full operation - max 100 messages/day',
      },
    };
  }

  /**
   * Get cumulative days for each phase transition
   */
  getPhaseTransitionDays(): Record<WarmupStage, number> {
    return {
      PHASE_1_PROFILE: 0,
      PHASE_2_RECEIVE: this.warmupPhase1Days,
      PHASE_3_LIMITED: this.warmupPhase1Days + this.warmupPhase2Days,
      PHASE_4_GRADUAL: this.warmupPhase1Days + this.warmupPhase2Days + this.warmupPhase3Days,
      COMPLETED:
        this.warmupPhase1Days +
        this.warmupPhase2Days +
        this.warmupPhase3Days +
        this.warmupPhase4Days,
    };
  }

  /**
   * Get random delay between messages for human-like behavior
   */
  getRandomDelay(): number {
    return this.randomDelayMinMs + Math.random() * (this.randomDelayMaxMs - this.randomDelayMinMs);
  }
}
