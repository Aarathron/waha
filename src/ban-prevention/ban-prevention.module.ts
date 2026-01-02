import { Module, Global } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';

// Config
import { BanPreventionConfig } from './config/ban-prevention.config';

// Services
import { BanPreventionDatabaseService } from './services/database.service';
import { WarmupService } from './services/warmup.service';
import { RecipientRateLimitService } from './services/recipient-rate-limit.service';
import { BanPreventionCronService } from './services/cron.service';

// Interceptor
import { BanPreventionInterceptor } from './interceptors/ban-prevention.interceptor';

// Controllers
import { SafetyController } from './controllers/safety.controller';

@Global()
@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [SafetyController],
  providers: [
    // Config
    BanPreventionConfig,

    // Database service (must be initialized first)
    BanPreventionDatabaseService,

    // Core services
    WarmupService,
    RecipientRateLimitService,

    // Cron jobs
    BanPreventionCronService,

    // Interceptor
    BanPreventionInterceptor,
  ],
  exports: [
    BanPreventionConfig,
    BanPreventionDatabaseService,
    WarmupService,
    RecipientRateLimitService,
    BanPreventionInterceptor,
  ],
})
export class BanPreventionModule {}
