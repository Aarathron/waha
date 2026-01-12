import {
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AppsService,
  IAppsService,
} from '@waha/apps/app_sdk/services/IAppsService';
import { EngineBootstrap } from '@waha/core/abc/EngineBootstrap';
import { GowsEngineConfigService } from '@waha/core/config/GowsEngineConfigService';
import { WebJSEngineConfigService } from '@waha/core/config/WebJSEngineConfigService';
// Engine imports are now lazy-loaded in getEngine() to reduce bundle size
// Only the configured engine will be loaded at runtime
import { WebhookConductor } from '@waha/core/integrations/webhooks/WebhookConductor';
import { MediaStorageFactory } from '@waha/core/media/MediaStorageFactory';
import { DefaultMap } from '@waha/utils/DefaultMap';
import { getPinoLogLevel, LoggerBuilder } from '@waha/utils/logging';
import { promiseTimeout, sleep } from '@waha/utils/promiseTimeout';
import { complete } from '@waha/utils/reactive/complete';
import { SwitchObservable } from '@waha/utils/reactive/SwitchObservable';
import { PinoLogger } from 'nestjs-pino';
import { Observable, retry, share } from 'rxjs';
import { map } from 'rxjs/operators';

import { WhatsappConfigService } from '../config.service';
import {
  WAHAEngine,
  WAHAEvents,
  WAHASessionStatus,
} from '../structures/enums.dto';
import {
  ProxyConfig,
  SessionConfig,
  SessionDetailedInfo,
  SessionDTO,
  SessionInfo,
} from '../structures/sessions.dto';
import { WebhookConfig } from '../structures/webhooks.config.dto';
import { populateSessionInfo, SessionManager } from './abc/manager.abc';
import { SessionParams, WhatsappSession } from './abc/session.abc';
import { EngineConfigService } from './config/EngineConfigService';
import { DOCS_URL } from './exceptions';
import { getProxyConfig } from './helpers.proxy';
import { MediaManager } from './media/MediaManager';
import { ISessionConfigRepository } from './storage/ISessionConfigRepository';
import { LocalSessionAuthRepository } from './storage/LocalSessionAuthRepository';
import { LocalSessionConfigRepository } from './storage/LocalSessionConfigRepository';
import { LocalStoreCore } from './storage/LocalStoreCore';
import { PostgresSessionConfigRepository } from './storage/PostgresSessionConfigRepository';

// Cache for lazy-loaded engine classes
let cachedEngineClass: typeof WhatsappSession | null = null;

export class OnlyDefaultSessionIsAllowed extends UnprocessableEntityException {
  constructor(name: string) {
    const encoded = Buffer.from(name, 'utf-8').toString('base64');
    super(
      `WAHA Core support only 'default' session. You tried to access '${name}' session (base64: ${encoded}). ` +
        `If you want to run more then one WhatsApp account - please get WAHA PLUS version. Check this out: ${DOCS_URL}`,
    );
  }
}

@Injectable()
export class SessionManagerCore extends SessionManager implements OnModuleInit {
  SESSION_STOP_TIMEOUT = 3000;

  // Multi-session storage using Maps
  // sessions: running sessions (WhatsappSession instances)
  // sessionConfigs: configuration for each session (persists across stop/start)
  // stoppedSessions: tracks sessions that exist but are not running
  private sessions: Map<string, WhatsappSession> = new Map();
  private sessionConfigs: Map<string, SessionConfig | null> = new Map();
  private stoppedSessions: Set<string> = new Set();

  protected EngineClass: typeof WhatsappSession;
  protected events2: DefaultMap<WAHAEvents, SwitchObservable<any>>;
  protected readonly engineBootstrap: EngineBootstrap;

  private engineName: WAHAEngine;

  constructor(
    config: WhatsappConfigService,
    private engineConfigService: EngineConfigService,
    private webjsEngineConfigService: WebJSEngineConfigService,
    gowsConfigService: GowsEngineConfigService,
    log: PinoLogger,
    private mediaStorageFactory: MediaStorageFactory,
    @Inject(AppsService)
    appsService: IAppsService,
  ) {
    super(log, config, gowsConfigService, appsService);
    // Maps are initialized in property declarations
    this.engineName = this.engineConfigService.getDefaultEngineName();
    // Engine class is loaded lazily in onModuleInit() to reduce startup memory
    this.engineBootstrap = this.getEngineBootstrap(this.engineName);

    this.events2 = new DefaultMap<WAHAEvents, SwitchObservable<any>>(
      (key) =>
        new SwitchObservable((obs$) => {
          return obs$.pipe(retry(), share());
        }),
    );

    this.store = new LocalStoreCore(this.engineName.toLowerCase());
    this.sessionAuthRepository = new LocalSessionAuthRepository(this.store);

    // Initialize session config repository based on configuration
    const postgresUrl = this.config.getSessionPostgresUrl();
    if (postgresUrl) {
      this.log.info('Using PostgreSQL for session config persistence');
      this.sessionConfigRepository = new PostgresSessionConfigRepository(
        postgresUrl,
      );
    } else {
      this.log.info('Using local file storage for session config persistence');
      this.sessionConfigRepository = new LocalSessionConfigRepository(
        this.store,
      );
    }

    this.clearStorage().catch((error) => {
      this.log.error({ error }, 'Error while clearing storage');
    });
  }

  /**
   * Lazy-load engine class to reduce startup memory footprint
   * Only the configured engine module is loaded, avoiding puppeteer/gRPC when not needed
   */
  protected async getEngineAsync(engine: WAHAEngine): Promise<typeof WhatsappSession> {
    // Return cached class if available
    if (cachedEngineClass) {
      return cachedEngineClass;
    }

    let EngineClass: typeof WhatsappSession;

    if (engine === WAHAEngine.WEBJS) {
      // Lazy load WEBJS engine (includes puppeteer)
      const module = await import('./engines/webjs/session.webjs.core');
      EngineClass = module.WhatsappSessionWebJSCore;
    } else if (engine === WAHAEngine.NOWEB) {
      // Lazy load NOWEB engine (Baileys-based)
      const module = await import('./engines/noweb/session.noweb.core');
      EngineClass = module.WhatsappSessionNoWebCore;
    } else if (engine === WAHAEngine.GOWS) {
      // Lazy load GOWS engine (Go-based with gRPC)
      const module = await import('./engines/gows/session.gows.core');
      EngineClass = module.WhatsappSessionGoWSCore;
    } else {
      throw new NotFoundException(`Unknown whatsapp engine '${engine}'.`);
    }

    // Cache for future use
    cachedEngineClass = EngineClass;
    return EngineClass;
  }

  // Sync version for backward compatibility (returns cached value or throws)
  protected getEngine(engine: WAHAEngine): typeof WhatsappSession {
    if (cachedEngineClass) {
      return cachedEngineClass;
    }
    throw new Error('Engine not yet loaded. Call loadEngine() first.');
  }

  // Initialize engine class asynchronously
  protected async loadEngine(engine: WAHAEngine): Promise<void> {
    this.EngineClass = await this.getEngineAsync(engine);
  }

  /**
   * Check if we've hit the maximum session limit
   * Can be configured via WAHA_MAX_SESSIONS environment variable (default: 20)
   */
  private checkSessionLimit(name: string): void {
    const MAX_SESSIONS = parseInt(process.env.WAHA_MAX_SESSIONS || '20', 10);
    // Only check limit if this is a new session (not already tracked)
    const isExistingSession =
      this.sessions.has(name) || this.stoppedSessions.has(name);
    if (!isExistingSession && this.sessions.size >= MAX_SESSIONS) {
      throw new UnprocessableEntityException(
        `Maximum session limit (${MAX_SESSIONS}) reached. Delete unused sessions first.`,
      );
    }
  }

  async beforeApplicationShutdown(signal?: string) {
    // Stop all running sessions gracefully
    for (const [name] of this.sessions) {
      await this.stop(name, true);
    }
    this.stopEvents();
    await this.engineBootstrap.shutdown();
    // Close session config repository connection pool
    await this.sessionConfigRepository.close();
  }

  async onApplicationBootstrap() {
    await this.engineBootstrap.bootstrap();
    this.startPredefinedSessions();
  }

  private async clearStorage() {
    const storage = await this.mediaStorageFactory.build(
      'all',
      this.log.logger.child({ name: 'Storage' }),
    );
    await storage.purge();
  }

  //
  // API Methods
  //
  async exists(name: string): Promise<boolean> {
    // Session exists if it's running OR if it's in stopped state
    return this.sessions.has(name) || this.stoppedSessions.has(name);
  }

  isRunning(name: string): boolean {
    return this.sessions.has(name);
  }

  async upsert(name: string, config?: SessionConfig): Promise<void> {
    this.checkSessionLimit(name);
    const sessionConfig = config || null;

    // Persist to repository FIRST - if this fails, don't modify in-memory state
    await this.sessionConfigRepository.saveConfig(name, sessionConfig || {});
    this.log.debug({ session: name }, 'Session config saved to repository');

    // Only update in-memory state after successful persistence
    this.sessionConfigs.set(name, sessionConfig);

    // If session doesn't exist yet, add to stopped sessions
    if (!this.sessions.has(name)) {
      this.stoppedSessions.add(name);
    }
  }

  async start(name: string): Promise<SessionDTO> {
    this.checkSessionLimit(name);
    if (this.sessions.has(name)) {
      throw new UnprocessableEntityException(
        `Session '${name}' is already started.`,
      );
    }
    this.log.info({ session: name }, `Starting session...`);

    // Get config for this session (may have been set via upsert)
    const storedConfig = this.sessionConfigs.get(name);
    const logger = this.log.logger.child({ session: name });
    logger.level = getPinoLogLevel(storedConfig?.debug);
    const loggerBuilder: LoggerBuilder = logger;

    const storage = await this.mediaStorageFactory.build(
      name,
      loggerBuilder.child({ name: 'Storage' }),
    );
    await storage.init();
    const mediaManager = new MediaManager(
      storage,
      this.config.mimetypes,
      loggerBuilder.child({ name: 'MediaManager' }),
    );

    const webhook = new WebhookConductor(loggerBuilder);
    const proxyConfig = this.getProxyConfig(name);
    const sessionConfig: SessionParams = {
      name,
      mediaManager,
      loggerBuilder,
      printQR: this.engineConfigService.shouldPrintQR,
      sessionStore: this.store,
      proxyConfig: proxyConfig,
      sessionConfig: storedConfig,
      ignore: this.ignoreChatsConfig(storedConfig),
    };
    // Set engine-specific config based on engine name (classes are lazy-loaded)
    if (this.engineName === WAHAEngine.WEBJS) {
      sessionConfig.engineConfig = this.webjsEngineConfigService.getConfig();
    } else if (this.engineName === WAHAEngine.GOWS) {
      sessionConfig.engineConfig = this.gowsConfigService.getConfig();
    }
    await this.sessionAuthRepository.init(name);
    // @ts-ignore
    const session = new this.EngineClass(sessionConfig);

    // Store in sessions map and remove from stopped set
    this.sessions.set(name, session);
    this.stoppedSessions.delete(name);
    this.updateSession(name);

    // configure webhooks
    const webhooks = this.getWebhooks(name);
    webhook.configure(session, webhooks);

    // Apps
    try {
      await this.appsService.beforeSessionStart(session, this.store);
    } catch (e) {
      logger.error(`Apps Error: ${e}`);
      session.status = WAHASessionStatus.FAILED;
    }

    // start session
    if (session.status !== WAHASessionStatus.FAILED) {
      await session.start();
      logger.info('Session has been started.');
      // Apps
      await this.appsService.afterSessionStart(session, this.store);
    }

    // Apps
    await this.appsService.afterSessionStart(session, this.store);

    return {
      name: session.name,
      status: session.status,
      config: session.sessionConfig,
    };
  }

  private updateSession(name: string) {
    const session = this.sessions.get(name);
    if (!session) {
      // Session was removed - clear events (null will stop the stream)
      for (const eventName in WAHAEvents) {
        const event = WAHAEvents[eventName];
        this.events2.get(event).switch(null);
      }
      return;
    }
    for (const eventName in WAHAEvents) {
      const event = WAHAEvents[eventName];
      const stream$ = session
        .getEventObservable(event)
        .pipe(map(populateSessionInfo(event, session)));
      this.events2.get(event).switch(stream$);
    }
  }

  getSessionEvent(session: string, event: WAHAEvents): Observable<any> {
    return this.events2.get(event);
  }

  async stop(name: string, silent: boolean): Promise<void> {
    if (!this.isRunning(name)) {
      this.log.debug({ session: name }, `Session is not running.`);
      return;
    }

    this.log.info({ session: name }, `Stopping session...`);
    try {
      const session = this.sessions.get(name);
      if (session) {
        await session.stop();
      }
    } catch (err) {
      this.log.warn(`Error while stopping session '${name}'`);
      if (!silent) {
        throw err;
      }
    }
    this.log.info({ session: name }, `Session has been stopped.`);
    // Move from running sessions to stopped sessions
    this.sessions.delete(name);
    this.stoppedSessions.add(name);
    this.updateSession(name);
    await sleep(this.SESSION_STOP_TIMEOUT);
  }

  async unpair(name: string) {
    const session = this.sessions.get(name);
    if (!session) {
      return;
    }

    this.log.info({ session: name }, 'Unpairing the device from account...');
    await session.unpair().catch((err) => {
      this.log.warn(`Error while unpairing from device: ${err}`);
    });
    await sleep(1000);
  }

  async logout(name: string): Promise<void> {
    await this.sessionAuthRepository.clean(name);
  }

  async delete(name: string): Promise<void> {
    await this.appsService.removeBySession(this, name);

    // Remove from repository FIRST - if this fails, don't modify in-memory state
    await this.sessionConfigRepository.deleteConfig(name);
    this.log.debug({ session: name }, 'Session config deleted from repository');

    // Only update in-memory state after successful repository deletion
    this.sessions.delete(name);
    this.stoppedSessions.delete(name);
    this.sessionConfigs.delete(name);

    this.updateSession(name);
  }

  /**
   * Combine per session and global webhooks
   */
  private getWebhooks(name: string) {
    let webhooks: WebhookConfig[] = [];
    const sessionConfig = this.sessionConfigs.get(name);
    if (sessionConfig?.webhooks) {
      webhooks = webhooks.concat(sessionConfig.webhooks);
    }
    const globalWebhookConfig = this.config.getWebhookConfig();
    if (globalWebhookConfig) {
      webhooks.push(globalWebhookConfig);
    }
    return webhooks;
  }

  /**
   * Get either session's or global proxy if defined
   * Per-session proxy takes priority over global proxy configuration
   */
  protected getProxyConfig(name: string): ProxyConfig | undefined {
    const sessionConfig = this.sessionConfigs.get(name);
    // Per-session proxy takes priority
    if (sessionConfig?.proxy) {
      return sessionConfig.proxy;
    }
    // Fall back to global proxy distribution
    const sessionsObj: Record<string, WhatsappSession> = {};
    this.sessions.forEach((s, n) => {
      sessionsObj[n] = s;
    });
    return getProxyConfig(this.config, sessionsObj, name);
  }

  getSession(name: string): WhatsappSession {
    const session = this.sessions.get(name);
    if (!session) {
      throw new NotFoundException(
        `We didn't find a running session with name '${name}'.\n` +
          `Please start it first by using POST /api/sessions/${name}/start request`,
      );
    }
    return session;
  }

  async getSessions(all: boolean): Promise<SessionInfo[]> {
    const results: SessionInfo[] = [];

    // Add all running sessions
    for (const [name, session] of this.sessions) {
      const me = session?.getSessionMeInfo();
      results.push({
        name: session.name,
        status: session.status,
        config: session.sessionConfig,
        me: me,
        presence: session.presence,
        timestamps: {
          activity: session?.getLastActivityTimestamp(),
        },
      });
    }

    // Add stopped sessions if 'all' flag is set
    if (all) {
      for (const name of this.stoppedSessions) {
        // Skip if already in running sessions (shouldn't happen, but be safe)
        if (!this.sessions.has(name)) {
          results.push({
            name: name,
            status: WAHASessionStatus.STOPPED,
            config: this.sessionConfigs.get(name) || undefined,
            me: null,
            presence: null,
            timestamps: {
              activity: null,
            },
          });
        }
      }
    }

    return results;
  }

  private async fetchEngineInfo(name: string) {
    const session = this.sessions.get(name);
    // Get engine info
    let engineInfo = {};
    if (session) {
      try {
        engineInfo = await promiseTimeout(1000, session.getEngineInfo());
      } catch (error) {
        this.log.debug(
          { session: name, error: `${error}` },
          'Can not get engine info',
        );
      }
    }
    const engine = {
      engine: session?.engine,
      ...engineInfo,
    };
    return engine;
  }

  async getSessionInfo(name: string): Promise<SessionDetailedInfo | null> {
    const session = this.sessions.get(name);

    // Check if session exists (running or stopped)
    if (!session && !this.stoppedSessions.has(name)) {
      return null;
    }

    // Return stopped session info
    if (!session) {
      return {
        name: name,
        status: WAHASessionStatus.STOPPED,
        config: this.sessionConfigs.get(name) || undefined,
        me: null,
        presence: null,
        timestamps: { activity: null },
        engine: null,
      };
    }

    // Return running session info with engine details
    const engine = await this.fetchEngineInfo(name);
    const me = session.getSessionMeInfo();
    return {
      name: session.name,
      status: session.status,
      config: session.sessionConfig,
      me: me,
      presence: session.presence,
      timestamps: { activity: session.getLastActivityTimestamp() },
      engine: engine,
    };
  }

  protected stopEvents() {
    complete(this.events2);
  }

  async onModuleInit() {
    // Lazy-load the engine class before any other initialization
    await this.loadEngine(this.engineName);
    await this.init();
  }

  async init() {
    await this.store.init();
    const knex = this.store.getWAHADatabase();
    await this.appsService.migrate(knex);

    // Initialize session config repository and load existing sessions
    await this.sessionConfigRepository.init();
    await this.loadSessionsFromRepository();
  }

  /**
   * Load all session configs from the repository on startup
   * This restores sessions that were created before the server restarted
   * Errors are propagated to prevent silent startup with missing sessions
   */
  private async loadSessionsFromRepository(): Promise<void> {
    const sessionNames = await this.sessionConfigRepository.getAllConfigs();
    this.log.info(
      { count: sessionNames.length },
      'Loading session configs from repository',
    );

    for (const sessionName of sessionNames) {
      const config = await this.sessionConfigRepository.getConfig(sessionName);
      this.sessionConfigs.set(sessionName, config);
      this.stoppedSessions.add(sessionName);
      this.log.debug({ session: sessionName }, 'Loaded session config');
    }

    this.log.info(
      { count: sessionNames.length },
      'Session configs loaded from repository',
    );
  }
}
