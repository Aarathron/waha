import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags, ApiParam, ApiQuery } from '@nestjs/swagger';
import { WarmupService } from '../services/warmup.service';
import { RecipientRateLimitService } from '../services/recipient-rate-limit.service';
import { BanPreventionDatabaseService } from '../services/database.service';
import { BanPreventionConfig } from '../config/ban-prevention.config';

@ApiSecurity('api_key')
@Controller('api/safety')
@ApiTags('🛡️ Ban Prevention')
export class SafetyController {
  constructor(
    private warmupService: WarmupService,
    private rateLimitService: RecipientRateLimitService,
    private db: BanPreventionDatabaseService,
    private config: BanPreventionConfig
  ) {}

  @Get('status')
  @ApiOperation({
    summary: 'Get ban prevention system status',
    description: 'Returns the overall status of the ban prevention system',
  })
  async getSystemStatus() {
    return {
      enabled: this.config.enabled,
      warmupConfig: {
        phase1Days: this.config.warmupPhase1Days,
        phase2Days: this.config.warmupPhase2Days,
        phase3Days: this.config.warmupPhase3Days,
        phase4Days: this.config.warmupPhase4Days,
        totalWarmupDays:
          this.config.warmupPhase1Days +
          this.config.warmupPhase2Days +
          this.config.warmupPhase3Days +
          this.config.warmupPhase4Days,
      },
      rateLimiting: {
        maxMessagesPerRecipientPerDay: this.config.maxMessagesPerRecipientPerDay,
        minIntervalBetweenMessagesSeconds: this.config.minIntervalBetweenMessagesMs / 1000,
        randomDelayRange: {
          minMs: this.config.randomDelayMinMs,
          maxMs: this.config.randomDelayMaxMs,
        },
      },
      warmupRules: this.config.warmupRules,
    };
  }

  @Get(':session')
  @ApiOperation({
    summary: 'Get safety status for a session',
    description:
      'Returns warmup status, daily quotas, and recommendations for a specific WhatsApp session',
  })
  @ApiParam({ name: 'session', description: 'Session name', example: 'default' })
  async getSessionSafetyStatus(@Param('session') sessionName: string) {
    const warmupStatus = await this.warmupService.getWarmupStatus(sessionName);
    const todayMetrics = await this.db.getTodayMetrics(sessionName);

    if (!warmupStatus) {
      return {
        sessionName,
        status: 'not_initialized',
        message: 'Session has not started warmup yet. Send a message to initialize.',
        recommendations: [
          'Set up profile: photo, name, status',
          'Complete warmup before high-volume messaging',
        ],
      };
    }

    const warnings = this.generateWarnings(warmupStatus);
    const recommendations = this.generateRecommendations(warmupStatus);

    return {
      sessionName,
      status: warmupStatus.isCompleted ? 'fully_warmed' : 'warming_up',
      warmup: {
        stage: warmupStatus.stage,
        description: warmupStatus.stageDescription,
        daysSinceStart: warmupStatus.daysSinceStart,
        daysUntilNextStage: warmupStatus.daysUntilNextStage,
        isCompleted: warmupStatus.isCompleted,
      },
      dailyUsage: {
        messagesUsed: warmupStatus.dailyQuota,
        messagesMax: warmupStatus.maxDaily,
        usagePercent: warmupStatus.usagePercent,
        remaining: warmupStatus.maxDaily - warmupStatus.dailyQuota,
      },
      todayMetrics: todayMetrics
        ? {
            sent: todayMetrics.messagesSent,
            delivered: todayMetrics.messagesDelivered,
            failed: todayMetrics.messagesFailed,
            uniqueRecipients: todayMetrics.uniqueRecipients,
            responses: todayMetrics.responsesReceived,
            deliveryRate:
              todayMetrics.messagesSent > 0
                ? Math.round((todayMetrics.messagesDelivered / todayMetrics.messagesSent) * 100)
                : 0,
          }
        : null,
      warnings,
      recommendations,
    };
  }

  @Get(':session/recipient/:recipient')
  @ApiOperation({
    summary: 'Get rate limit status for a specific recipient',
    description: 'Returns how many messages have been sent to a recipient and when you can send more',
  })
  @ApiParam({ name: 'session', description: 'Session name', example: 'default' })
  @ApiParam({
    name: 'recipient',
    description: 'Recipient phone number (with or without @c.us)',
    example: '1234567890',
  })
  async getRecipientStatus(
    @Param('session') sessionName: string,
    @Param('recipient') recipient: string
  ) {
    const status = await this.rateLimitService.getRecipientStatus(sessionName, recipient);

    return {
      sessionName,
      recipient,
      ...status,
      message: status?.canSendNow
        ? 'You can send a message now'
        : `Wait ${status?.nextAllowedIn} seconds before sending`,
    };
  }

  @Get(':session/metrics')
  @ApiOperation({
    summary: 'Get historical metrics for a session',
    description: 'Returns message statistics for the past N days',
  })
  @ApiParam({ name: 'session', description: 'Session name', example: 'default' })
  @ApiQuery({ name: 'days', required: false, description: 'Number of days (default: 30)' })
  async getMetricsHistory(
    @Param('session') sessionName: string,
    @Query('days') days?: string
  ) {
    const numDays = parseInt(days || '30', 10);
    const history = await this.db.getMetricsHistory(sessionName, numDays);

    const totals = history.reduce(
      (acc, day) => ({
        messagesSent: acc.messagesSent + day.messagesSent,
        messagesDelivered: acc.messagesDelivered + day.messagesDelivered,
        messagesFailed: acc.messagesFailed + day.messagesFailed,
        uniqueRecipients: acc.uniqueRecipients + day.uniqueRecipients,
        responsesReceived: acc.responsesReceived + day.responsesReceived,
      }),
      {
        messagesSent: 0,
        messagesDelivered: 0,
        messagesFailed: 0,
        uniqueRecipients: 0,
        responsesReceived: 0,
      }
    );

    return {
      sessionName,
      period: {
        days: numDays,
        from: history.length > 0 ? history[history.length - 1].date : null,
        to: history.length > 0 ? history[0].date : null,
      },
      totals: {
        ...totals,
        averagePerDay: history.length > 0 ? Math.round(totals.messagesSent / history.length) : 0,
        deliveryRate:
          totals.messagesSent > 0
            ? Math.round((totals.messagesDelivered / totals.messagesSent) * 100)
            : 0,
        responseRate:
          totals.messagesSent > 0
            ? Math.round((totals.responsesReceived / totals.messagesSent) * 100)
            : 0,
      },
      daily: history.map((day) => ({
        date: day.date,
        sent: day.messagesSent,
        delivered: day.messagesDelivered,
        failed: day.messagesFailed,
        uniqueRecipients: day.uniqueRecipients,
        responses: day.responsesReceived,
      })),
    };
  }

  @Post(':session/reset-warmup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset warmup for a session',
    description:
      'WARNING: Resets the session back to Phase 1. Use only for testing or with new numbers.',
  })
  @ApiParam({ name: 'session', description: 'Session name', example: 'default' })
  async resetWarmup(@Param('session') sessionName: string) {
    await this.warmupService.resetWarmup(sessionName);

    return {
      message: `Warmup reset to Phase 1 for session "${sessionName}"`,
      warning:
        'The session will now go through the full 21-day warmup period. Do not send messages for the first 2 days.',
    };
  }

  // ==================== HELPER METHODS ====================

  private generateWarnings(warmupStatus: {
    usagePercent: number;
    stage: string;
    daysSinceStart: number;
  }): string[] {
    const warnings: string[] = [];

    if (warmupStatus.usagePercent > 90) {
      warnings.push('⚠️ Approaching daily limit - slow down messaging');
    }

    if (warmupStatus.usagePercent > 75) {
      warnings.push('⚠️ 75%+ of daily quota used');
    }

    if (warmupStatus.stage !== 'COMPLETED' && warmupStatus.daysSinceStart < 21) {
      warnings.push(
        `⚠️ Still in warmup (day ${warmupStatus.daysSinceStart}/21) - follow strict limits`
      );
    }

    return warnings;
  }

  private generateRecommendations(warmupStatus: {
    stage: string;
    daysSinceStart: number;
    isCompleted: boolean;
  }): string[] {
    const recommendations: string[] = [];

    switch (warmupStatus.stage) {
      case 'PHASE_1_PROFILE':
        recommendations.push('✅ Set up profile: photo, name, status');
        recommendations.push('✅ Add contacts and join groups');
        recommendations.push('❌ Do not send messages in Phase 1');
        break;

      case 'PHASE_2_RECEIVE':
        recommendations.push('✅ Only reply to messages you receive');
        recommendations.push('✅ Keep replies short and natural');
        recommendations.push('✅ Engage in real conversations');
        break;

      case 'PHASE_3_LIMITED':
        recommendations.push('✅ Start initiating conversations slowly');
        recommendations.push('✅ Vary message content - avoid templates');
        recommendations.push('✅ Space messages throughout the day');
        break;

      case 'PHASE_4_GRADUAL':
        recommendations.push('✅ Gradually increase messaging volume');
        recommendations.push('✅ Monitor delivery rates');
        recommendations.push('✅ Continue varying content');
        break;

      case 'COMPLETED':
        recommendations.push('✅ Warmup complete - full operation allowed');
        recommendations.push('✅ Still respect daily limits');
        recommendations.push('✅ Monitor for any ban signals');
        break;
    }

    if (!warmupStatus.isCompleted) {
      recommendations.push(`📅 ${21 - warmupStatus.daysSinceStart} days until warmup complete`);
    }

    return recommendations;
  }
}
