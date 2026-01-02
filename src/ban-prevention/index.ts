// Ban Prevention Module for WAHA
// Provides 21-day warmup, recipient rate limiting, and safety monitoring

export { BanPreventionModule } from './ban-prevention.module';

// Config
export { BanPreventionConfig, WarmupStage, WarmupPhaseConfig } from './config/ban-prevention.config';

// Services
export { BanPreventionDatabaseService, WarmupConfig, RecipientRateLimit, SafetyMetrics } from './services/database.service';
export { WarmupService, MessageAllowedResult } from './services/warmup.service';
export { RecipientRateLimitService, RateLimitCheckResult } from './services/recipient-rate-limit.service';
export { BanPreventionCronService } from './services/cron.service';

// Interceptor
export { BanPreventionInterceptor, BanPreventionError } from './interceptors/ban-prevention.interceptor';

// Controller
export { SafetyController } from './controllers/safety.controller';
