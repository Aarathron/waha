import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Observable, from, throwError } from 'rxjs';
import { switchMap, tap, catchError } from 'rxjs/operators';
import { WarmupService } from '../services/warmup.service';
import { RecipientRateLimitService } from '../services/recipient-rate-limit.service';
import { BanPreventionConfig } from '../config/ban-prevention.config';
import { BanPreventionDatabaseService } from '../services/database.service';
import { Logger } from 'pino';
import pino from 'pino';

export interface BanPreventionError {
  statusCode: number;
  error: string;
  message: string;
  retryAfter?: number;
  warmupStage?: string;
  dailyQuota?: number;
  maxDaily?: number;
  recipientMessageCount?: number;
  recipientMaxMessages?: number;
}

@Injectable()
export class BanPreventionInterceptor implements NestInterceptor {
  private logger: Logger;

  constructor(
    private warmupService: WarmupService,
    private rateLimitService: RecipientRateLimitService,
    private config: BanPreventionConfig,
    private db: BanPreventionDatabaseService
  ) {
    this.logger = pino().child({ name: 'BanPreventionInterceptor' });
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (!this.config.enabled) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const { body } = request;

    // Extract session and recipient from request body
    const session = body?.session || 'default';
    const chatId = body?.chatId || body?.to;

    // Skip if not a messaging endpoint or missing required fields
    if (!this.isMessageEndpoint(request.path) || !chatId) {
      return next.handle();
    }

    const messageType = this.getMessageType(request.path);

    return from(this.checkBanPrevention(session, chatId, messageType)).pipe(
      switchMap((checkResult) => {
        if (!checkResult.allowed) {
          const errorResponse: BanPreventionError = {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'Ban Prevention',
            message: checkResult.message,
            retryAfter: checkResult.retryAfterSeconds,
            warmupStage: checkResult.warmupStage,
            dailyQuota: checkResult.dailyQuota,
            maxDaily: checkResult.maxDaily,
            recipientMessageCount: checkResult.recipientMessageCount,
            recipientMaxMessages: checkResult.recipientMaxMessages,
          };

          throw new HttpException(errorResponse, HttpStatus.TOO_MANY_REQUESTS);
        }

        // Add random delay for human-like behavior
        return from(this.addHumanDelay()).pipe(
          switchMap(() => next.handle()),
          tap(async () => {
            // Record successful message send
            await this.recordMessageSent(session, chatId, messageType);
          }),
          catchError((error) => {
            // Record failed message
            this.recordMessageFailed(session, chatId, messageType).catch((e) =>
              this.logger.error({ error: e }, 'Failed to record message failure')
            );
            return throwError(() => error);
          })
        );
      })
    );
  }

  private async checkBanPrevention(
    session: string,
    chatId: string,
    messageType: string
  ): Promise<{
    allowed: boolean;
    message: string;
    retryAfterSeconds?: number;
    warmupStage?: string;
    dailyQuota?: number;
    maxDaily?: number;
    recipientMessageCount?: number;
    recipientMaxMessages?: number;
  }> {
    // 1. Check warmup rules
    const warmupCheck = await this.warmupService.checkMessageAllowed(session);
    if (!warmupCheck.allowed) {
      this.logger.warn(
        {
          session,
          chatId,
          messageType,
          warmupStage: warmupCheck.warmupStage,
          dailyQuota: warmupCheck.dailyQuota,
          maxDaily: warmupCheck.maxDaily,
        },
        'Message blocked by warmup rules'
      );

      return {
        allowed: false,
        message: warmupCheck.reason || 'Warmup rules not met',
        retryAfterSeconds: warmupCheck.retryAfterSeconds,
        warmupStage: warmupCheck.warmupStage,
        dailyQuota: warmupCheck.dailyQuota,
        maxDaily: warmupCheck.maxDaily,
      };
    }

    // 2. Check recipient rate limit (skip for group messages)
    const isGroupMessage = chatId.includes('@g.us');
    if (!isGroupMessage) {
      const rateLimitCheck = await this.rateLimitService.checkAllowed(session, chatId);
      if (!rateLimitCheck.allowed) {
        this.logger.warn(
          {
            session,
            chatId,
            messageType,
            messageCount: rateLimitCheck.messageCount,
            maxMessages: rateLimitCheck.maxMessages,
          },
          'Message blocked by recipient rate limit'
        );

        return {
          allowed: false,
          message: rateLimitCheck.reason || 'Recipient rate limit exceeded',
          retryAfterSeconds: rateLimitCheck.retryAfterSeconds,
          warmupStage: warmupCheck.warmupStage,
          dailyQuota: warmupCheck.dailyQuota,
          maxDaily: warmupCheck.maxDaily,
          recipientMessageCount: rateLimitCheck.messageCount,
          recipientMaxMessages: rateLimitCheck.maxMessages,
        };
      }
    }

    return {
      allowed: true,
      message: 'OK',
      warmupStage: warmupCheck.warmupStage,
      dailyQuota: warmupCheck.dailyQuota,
      maxDaily: warmupCheck.maxDaily,
    };
  }

  private async addHumanDelay(): Promise<void> {
    const delay = this.rateLimitService.getRandomDelay();
    this.logger.debug({ delayMs: delay }, 'Adding human-like delay');
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  private async recordMessageSent(
    session: string,
    chatId: string,
    messageType: string
  ): Promise<void> {
    try {
      // Record in warmup (increments daily quota)
      await this.warmupService.recordMessageSent(session);

      // Record in recipient rate limit
      const isGroupMessage = chatId.includes('@g.us');
      if (!isGroupMessage) {
        await this.rateLimitService.recordMessage(session, chatId);
      }

      // Log message
      await this.db.logMessage(session, chatId, messageType, 'SENT');

      this.logger.debug({ session, chatId, messageType }, 'Message recorded successfully');
    } catch (error) {
      this.logger.error({ error, session, chatId }, 'Failed to record message');
    }
  }

  private async recordMessageFailed(
    session: string,
    chatId: string,
    messageType: string
  ): Promise<void> {
    try {
      await this.db.incrementMessagesFailed(session);
      await this.db.logMessage(session, chatId, messageType, 'FAILED');
    } catch (error) {
      this.logger.error({ error, session, chatId }, 'Failed to record message failure');
    }
  }

  private isMessageEndpoint(path: string): boolean {
    const messageEndpoints = [
      '/api/sendText',
      '/api/sendImage',
      '/api/sendFile',
      '/api/sendVoice',
      '/api/sendVideo',
      '/api/sendButtons',
      '/api/sendList',
      '/api/sendPoll',
      '/api/sendLocation',
      '/api/sendContactVcard',
      '/api/forwardMessage',
      '/api/reply',
      '/api/send/link-custom-preview',
      '/api/sendLinkPreview',
      '/api/sendPollVote',
      '/api/send/buttons/reply',
    ];

    return messageEndpoints.some((endpoint) => path.startsWith(endpoint));
  }

  private getMessageType(path: string): string {
    if (path.includes('sendText')) return 'TEXT';
    if (path.includes('sendImage')) return 'IMAGE';
    if (path.includes('sendFile')) return 'FILE';
    if (path.includes('sendVoice')) return 'VOICE';
    if (path.includes('sendVideo')) return 'VIDEO';
    if (path.includes('sendButtons')) return 'BUTTONS';
    if (path.includes('sendList')) return 'LIST';
    if (path.includes('sendPoll')) return 'POLL';
    if (path.includes('sendLocation')) return 'LOCATION';
    if (path.includes('sendContactVcard')) return 'VCARD';
    if (path.includes('forwardMessage')) return 'FORWARD';
    if (path.includes('reply')) return 'REPLY';
    if (path.includes('link')) return 'LINK_PREVIEW';
    return 'UNKNOWN';
  }
}
