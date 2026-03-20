import { Browsers, WABrowserDescription } from '@adiwajshing/baileys';
import makeWASocket, {
  Chat,
  Contact,
  decryptPollVote,
  downloadMediaMessage,
  extractMessageContent,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  getAggregateVotesInPollMessage,
  getContentType,
  getKeyAuthor,
  isPnUser,
  isRealMessage,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  MiscMessageGenerationOptions,
  normalizeMessageContent,
  prepareWAMessageMedia,
  PresenceData,
  proto,
  SocketConfig,
  WAMessageContent,
  WAMessageKey,
  WAMessageUpdate,
  WAVersion,
} from '@adiwajshing/baileys';
import { WACallEvent } from '@adiwajshing/baileys/lib/Types/Call';
import { BaileysEventMap } from '@adiwajshing/baileys/lib/Types/Events';
import { GroupMetadata } from '@adiwajshing/baileys/lib/Types/GroupMetadata';
import {
  Label as NOWEBLabel,
  LabelActionBody,
} from '@adiwajshing/baileys/lib/Types/Label';
import {
  ChatLabelAssociation,
  LabelAssociationType,
} from '@adiwajshing/baileys/lib/Types/LabelAssociation';
import { MessageUserReceiptUpdate } from '@adiwajshing/baileys/lib/Types/Message';
import { ILogger } from '@adiwajshing/baileys/lib/Utils/logger';
import { isLidUser } from '@adiwajshing/baileys/lib/WABinary/jid-utils';
import { UnprocessableEntityException } from '@nestjs/common';
import {
  getChannelInviteLink,
  getPublicUrlFromDirectPath,
  WhatsappSession,
} from '@waha/core/abc/session.abc';
import {
  ToGroupParticipant,
  ToGroupV2JoinEvent,
  ToGroupV2LeaveEvent,
  ToGroupV2Participants,
  ToGroupV2UpdateEvent,
} from '@waha/core/engines/noweb/groups.noweb';
import { sendButtonMessage } from '@waha/core/engines/noweb/noweb.buttons';
import { sendListMessage } from '@waha/core/engines/noweb/noweb.list';
import {
  NOWEBNewsletterMetadata,
  toNewsletterMetadata,
} from '@waha/core/engines/noweb/noweb.newsletter';
import { NowebAuthFactoryCore } from '@waha/core/engines/noweb/NowebAuthFactoryCore';
import { NowebInMemoryStore } from '@waha/core/engines/noweb/store/NowebInMemoryStore';
import {
  AvailableInPlusVersion,
  NotImplementedByEngineError,
} from '@waha/core/exceptions';
import { toVcardV3 } from '@waha/core/vcard';
import { createAgentProxy } from '@waha/core/helpers.proxy';
import type { Agent } from 'https';
import { IMediaEngineProcessor } from '@waha/core/media/IMediaEngineProcessor';
import { QR } from '@waha/core/QR';
import { AckToStatus, StatusToAck } from '@waha/core/utils/acks';
import { pairs } from '@waha/utils/pairs';
import { ExtractMessageKeysForRead } from '@waha/core/utils/convertors';
import { parseMessageIdSerialized } from '@waha/core/utils/ids';
import { isJidNewsletter, toCusFormat, toJID } from '@waha/core/utils/jids';
import { DistinctAck } from '@waha/core/utils/reactive';
import { flipObject, splitAt } from '@waha/helpers';
import { PairingCodeResponse } from '@waha/structures/auth.dto';
import { CallData } from '@waha/structures/calls.dto';
import {
  Channel,
  ChannelListResult,
  ChannelMessage,
  ChannelRole,
  ChannelSearchByText,
  ChannelSearchByView,
  CreateChannelRequest,
  ListChannelsQuery,
  PreviewChannelMessages,
} from '@waha/structures/channels.dto';
import {
  ChatSummary,
  GetChatMessageQuery,
  GetChatMessagesFilter,
  GetChatMessagesQuery,
  OverviewFilter,
  PinDuration,
  ReadChatMessagesQuery,
  ReadChatMessagesResponse,
} from '@waha/structures/chats.dto';
import { SendButtonsRequest } from '@waha/structures/chatting.buttons.dto';
import {
  ChatRequest,
  CheckNumberStatusQuery,
  EditMessageRequest,
  MessageContactVcardRequest,
  MessageDestination,
  MessageFileRequest,
  MessageForwardRequest,
  MessageImageRequest,
  MessageLinkCustomPreviewRequest,
  MessageLinkPreviewRequest,
  MessageLocationRequest,
  MessagePollRequest,
  MessageReactionRequest,
  MessageReplyRequest,
  MessageStarRequest,
  MessageTextRequest,
  MessageVideoRequest,
  MessageVoiceRequest,
  SendSeenRequest,
  WANumberExistResult,
} from '@waha/structures/chatting.dto';
import { SendListRequest } from '@waha/structures/chatting.list.dto';
import {
  ContactQuery,
  ContactRequest,
  ContactUpdateBody,
} from '@waha/structures/contacts.dto';
import {
  ACK_UNKNOWN,
  SECOND,
  WAHAEngine,
  WAHAEvents,
  WAHAPresenceStatus,
  WAHASessionStatus,
  WAMessageAck,
} from '@waha/structures/enums.dto';
import { BinaryFile, RemoteFile } from '@waha/structures/files.dto';
import {
  CreateGroupRequest,
  GroupParticipant,
  ParticipantsRequest,
  SettingsSecurityChangeInfo,
} from '@waha/structures/groups.dto';
import {
  Label,
  LabelChatAssociation,
  LabelDTO,
  LabelID,
} from '@waha/structures/labels.dto';
import { LidToPhoneNumber } from '@waha/structures/lids.dto';
import { WAMedia } from '@waha/structures/media.dto';
import { ReplyToMessage } from '@waha/structures/message.dto';
import { PaginationParams } from '@waha/structures/pagination.dto';
import {
  WAHAChatPresences,
  WAHAPresenceData,
} from '@waha/structures/presence.dto';
import {
  InteractiveResponse,
  InteractiveResponseType,
  WAMessage,
  WAMessageReaction,
} from '@waha/structures/responses.dto';
import { MeInfo } from '@waha/structures/sessions.dto';
import {
  BROADCAST_ID,
  DeleteStatusRequest,
  StatusRequest,
  TextStatus,
} from '@waha/structures/status.dto';
import {
  EnginePayload,
  PollVote,
  PollVotePayload,
  WAMessageAckBody,
  WAMessageEditedBody,
  WAMessageRevokedBody,
} from '@waha/structures/webhooks.dto';
import { LoggerBuilder } from '@waha/utils/logging';
import { sleep, waitUntil } from '@waha/utils/promiseTimeout';
import { exclude } from '@waha/utils/reactive/ops/exclude';
import { SingleDelayedJobRunner } from '@waha/utils/SingleDelayedJobRunner';
import { SinglePeriodicJobRunner } from '@waha/utils/SinglePeriodicJobRunner';
import { StatusTracker } from '@waha/utils/StatusTracker';
// Optimized lodash imports - only import what's needed to reduce bundle size
import chunk from 'lodash/chunk';
import difference from 'lodash/difference';
import get from 'lodash/get';
import keyBy from 'lodash/keyBy';
import max from 'lodash/max';
import uniq from 'lodash/uniq';
import NodeCache from 'node-cache';
import {
  filter,
  fromEvent,
  identity,
  merge,
  mergeAll,
  mergeMap,
  Observable,
  partition,
  groupBy,
  share,
  tap,
} from 'rxjs';
import { debounceTime, map } from 'rxjs/operators';

import { INowebStore } from './store/INowebStore';
import { NowebPersistentStore } from './store/NowebPersistentStore';
import { NowebStorageFactoryCore } from './store/NowebStorageFactoryCore';
import {
  classifyDisconnect,
  DisconnectAction,
} from '@waha/core/engines/noweb/disconnect-classifier';
import { ensureNumber, extractMediaContent } from './utils';
import { Agents } from '@waha/core/engines/noweb/types';
import {
  IsEditedMessage,
  IsHistorySyncNotification,
} from '@waha/core/utils/pwa';
import { extractWALocation } from '@waha/core/engines/waproto/locaiton';
import { extractVCards } from '@waha/core/engines/waproto/vcards';
import { Activity } from '@waha/core/abc/activity';
import { LocalStore } from '@waha/core/storage/LocalStore';
import {
  WAHA_CLIENT_BROWSER_NAME,
  WAHA_CLIENT_DEVICE_NAME,
  WAHA_WA_VERSION,
} from '@waha/core/env';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const promiseRetry = require('promise-retry');

export const BaileysEvents = {
  CONNECTION_UPDATE: 'connection.update',
  CREDS_UPDATE: 'creds.update',
  MESSAGES_UPDATE: 'messages.update',
  MESSAGES_UPSERT: 'messages.upsert',
  MESSAGE_RECEIPT_UPDATE: 'message-receipt.update',
  GROUPS_UPSERT: 'groups.upsert',
  PRESENCE_UPDATE: 'presence.update',
};

const PresenceStatuses = {
  unavailable: WAHAPresenceStatus.OFFLINE,
  available: WAHAPresenceStatus.ONLINE,
  composing: WAHAPresenceStatus.TYPING,
  recording: WAHAPresenceStatus.RECORDING,
  paused: WAHAPresenceStatus.PAUSED,
};
const ToEnginePresenceStatus = flipObject(PresenceStatuses);

export class WhatsappSessionNoWebCore extends WhatsappSession {
  private START_ATTEMPT_DELAY_SECONDS = 2;
  private AUTO_RESTART_AFTER_SECONDS = 28 * 60;

  engine = WAHAEngine.NOWEB;
  authFactory = new NowebAuthFactoryCore();
  storageFactory = new NowebStorageFactoryCore();
  private startDelayedJob: SingleDelayedJobRunner;
  private shouldRestart: boolean;
  private permanentRestartAttempted: boolean = false;

  private autoRestartJob: SinglePeriodicJobRunner;
  private presenceKeepAliveJob: SinglePeriodicJobRunner;
  private PRESENCE_KEEP_ALIVE_INTERVAL_SECONDS = 5 * 60;
  private logoutRetryCount: number = 0;
  private msgRetryCounterCache: NodeCache;
  private placeholderResendCache: NodeCache;
  protected engineLogger: ILogger;

  private authNOWEBStore: any;

  sock: ReturnType<typeof makeWASocket>;
  store: INowebStore;
  private qr: QR;

  private statusTracker = new StatusTracker();

  /**
   * Observable for message status updates (ACK changes).
   * Used by iOS fallback mechanism to detect undelivered list messages.
   */
  private messageUpdates$: Observable<WAMessageUpdate>;

  public constructor(config) {
    super(config);
    this.shouldRestart = true;

    this.qr = new QR();
    // external map to store retry counts of messages when decryption/encryption fails
    // keep this out of the socket itself, to prevent a message decryption/encryption loop across socket restarts
    this.msgRetryCounterCache = new NodeCache({
      stdTTL: 60 * 60, // 1 hour
      useClones: false,
    });
    this.placeholderResendCache = new NodeCache({
      stdTTL: 60 * 60, // 1 hour
      useClones: false,
    });

    this.engineLogger = this.loggerBuilder.child({
      name: 'NOWEBEngine',
    }) as unknown as ILogger;

    // Restart job if session failed
    this.startDelayedJob = new SingleDelayedJobRunner(
      'start-engine',
      this.START_ATTEMPT_DELAY_SECONDS * SECOND,
      this.logger,
    );

    // Enable auto-restart
    const shiftSeconds = Math.floor(Math.random() * 30);
    const delay = this.AUTO_RESTART_AFTER_SECONDS + shiftSeconds;
    this.autoRestartJob = new SinglePeriodicJobRunner(
      'auto-restart',
      delay * SECOND,
      this.logger,
    );
    this.presenceKeepAliveJob = new SinglePeriodicJobRunner(
      'presence-keep-alive',
      this.PRESENCE_KEEP_ALIVE_INTERVAL_SECONDS * SECOND,
      this.logger,
      false,
      false,
    );
    this.authNOWEBStore = null;
  }

  protected set status(value: WAHASessionStatus) {
    this.statusTracker.track(value);
    super.status = value;
  }

  public get status() {
    return super.status;
  }

  async start() {
    this.status = WAHASessionStatus.STARTING;
    this.buildClient().catch((err) => {
      this.logger.error('Failed to start the client');
      this.logger.error(err, err.stack);
      this.status = WAHASessionStatus.FAILED;
      this.restartClient();
    });
  }

  async unpair() {
    this.unpairing = true;
    this.shouldRestart = false;
    await this.sock?.logout();
  }

  getSocketConfig(agents: Agents | undefined, state): Partial<SocketConfig> {
    // Detect browser — default matches Platform.MACOS used in Baileys registration
    let browser = Browsers.macOS('Chrome');
    let deviceName =
      this.sessionConfig?.client?.deviceName ?? WAHA_CLIENT_DEVICE_NAME;
    let browserName =
      this.sessionConfig?.client?.browserName ?? WAHA_CLIENT_BROWSER_NAME;
    if (browserName && !deviceName) {
      browser = Browsers.appropriate(browserName);
    } else if (!browserName && deviceName) {
      browser = [deviceName, 'Chrome', '14.4.1'];
    } else if (browserName && deviceName) {
      switch (deviceName) {
        case 'Mac OS':
        case 'MacOS':
        case 'macos':
          browser = Browsers.macOS(browserName);
          break;
        case 'ubuntu':
        case 'Ubuntu':
          browser = Browsers.ubuntu(browserName);
          break;
        case 'windows':
        case 'Windows':
          browser = Browsers.windows(browserName);
          break;
        default:
          browser = [deviceName, browserName, '14.4.1'];
      }
    }

    const fullSyncEnabled = this.sessionConfig?.noweb?.store?.fullSync || false;
    let markOnlineOnConnect = this.sessionConfig?.noweb?.markOnline;
    if (markOnlineOnConnect == undefined) {
      markOnlineOnConnect = true;
    }
    return {
      agent: agents?.socket,
      // Baileys types still expect a Node https.Agent here,
      // but 'undici' fetch requires a Dispatcher.
      // Cast keeps the compiler satisfied while we pass the ProxyAgent at runtime.
      fetchAgent: agents?.fetch as unknown as Agent,
      auth: state,
      printQRInTerminal: false,
      browser: browser,
      logger: this.engineLogger,
      mobile: false,
      defaultQueryTimeoutMs: 120_000,
      keepAliveIntervalMs: 30_000,
      getMessage: (key) => this.getMessage(key),
      syncFullHistory: fullSyncEnabled,
      msgRetryCounterCache: this.msgRetryCounterCache,
      placeholderResendCache: this.placeholderResendCache,
      markOnlineOnConnect: markOnlineOnConnect,
    };
  }

  /**
   * Resolve the WhatsApp Web version to use for the socket connection.
   * Priority: WAHA_WA_VERSION env > dynamic fetch > Baileys default (patched).
   */
  async resolveWAVersion(): Promise<WAVersion | undefined> {
    if (WAHA_WA_VERSION) {
      const parts = WAHA_WA_VERSION.split(',').map(Number);
      if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
        this.logger.info(`Using WA version from env: ${parts}`);
        return parts as unknown as WAVersion;
      }
      this.logger.warn(
        `Invalid WAHA_WA_VERSION format: "${WAHA_WA_VERSION}", falling back to fetch`,
      );
    }

    try {
      const { version } = await fetchLatestBaileysVersion({
        signal: AbortSignal.timeout(10_000),
      });
      this.logger.info(`Fetched latest WA version: ${version}`);
      return version;
    } catch (err) {
      this.logger.warn(
        `Failed to fetch WA version, using Baileys default: ${err}`,
      );
      return undefined;
    }
  }

  async makeSocket(): Promise<any> {
    if (!this.authNOWEBStore) {
      const store = await this.authFactory.buildAuth(
        this.sessionStore,
        this.name,
      );
      /** caching makes the store faster to send/recv messages */
      store.state.keys = makeCacheableSignalKeyStore(
        store.state.keys,
        this.engineLogger,
      );
      this.authNOWEBStore = store;
    }
    const { state, saveCreds } = this.authNOWEBStore;
    const agents = this.makeProxyAgents();
    const socketConfig: SocketConfig = this.getSocketConfig(
      agents,
      state,
    ) as SocketConfig;

    const version = await this.resolveWAVersion();
    if (version) {
      socketConfig.version = version;
    }

    const sock = makeWASocket(socketConfig);
    sock.ev.on('creds.update', saveCreds);
    return sock;
  }

  protected makeProxyAgents(): Agents | undefined {
    if (!this.proxyConfig) {
      return undefined;
    }
    return createAgentProxy(this.proxyConfig);
  }

  private async ensureStore() {
    if (this.store) {
      return;
    }

    this.logger.debug(`Making a new store...`);
    const storeEnabled = this.sessionConfig?.noweb?.store?.enabled || false;
    if (!storeEnabled) {
      this.logger.debug('Using NowebInMemoryStore');
      this.store = new NowebInMemoryStore();
      return;
    }

    this.logger.debug('Using NowebPersistentStore');
    const storage = this.storageFactory.createStorage(
      this.sessionStore,
      this.name,
    );
    this.store = new NowebPersistentStore(
      this.loggerBuilder.child({ name: NowebPersistentStore.name }),
      storage,
      this.jids,
    );
    await this.store.init();
  }

  connectStore() {
    this.logger.debug(`Connecting store...`);
    this.logger.debug(`Binding store to socket...`);
    this.store.bind(this.sock.ev, this.sock);
  }

  resubscribeToKnownPresences() {
    for (const jid in this.store.presences) {
      this.subscribePresence(jid);
    }
  }

  async buildClient() {
    this.shouldRestart = true;
    // @ts-ignore
    this.sock?.ev?.removeAllListeners();

    await this.ensureStore();
    this.sock = await this.makeSocket();

    this.fixMessages();
    this.issueMessageUpdateOnEdits();
    this.issueMessageUpdateOnPoll();
    this.issuePresenceUpdateOnMessageUpsert();
    if (this.isDebugEnabled()) {
      this.listenEngineEventsInDebugMode();
    }
    this.connectStore();
    this.listenConnectionEvents();
    this.subscribeEngineEvents2();
    this.listenContactsUpdatePictureProfile();
    this.enableAutoRestart();
    this.enablePresenceKeepAlive();
  }

  private enableAutoRestart() {
    this.autoRestartJob.start(async () => {
      this.logger.info('Auto-restarting the client connection...');
      if (this.sock?.ws?.isConnecting) {
        this.logger.warn('Auto-restart skipped, the client is connecting...');
        return;
      }
      this.sock?.end(undefined);
    });
  }

  private enablePresenceKeepAlive() {
    this.presenceKeepAliveJob.start(async () => {
      if (this.status !== WAHASessionStatus.WORKING || !this.sock) {
        return;
      }
      try {
        await this.sock.sendPresenceUpdate('available');
        this.logger.debug('Presence keep-alive sent: available');
      } catch (err) {
        this.logger.warn(
          `Presence keep-alive failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  protected async getMessage(
    key: WAMessageKey,
  ): Promise<WAMessageContent | undefined> {
    if (!this.store) {
      return proto.Message.create({});
    }
    const msg = await this.store.loadMessage(key.remoteJid, key.id);
    return msg?.message || undefined;
  }

  protected listenEngineEventsInDebugMode() {
    this.sock.ev.process((events) => {
      this.logger.debug({ events: events }, `NOWEB events`);
    });
  }

  private restartClient() {
    if (!this.shouldRestart) {
      this.logger.debug(
        'Should not restart the client, ignoring restart request',
      );
      return;
    }

    this.startDelayedJob.schedule(async () => {
      if (!this.shouldRestart) {
        this.logger.warn(
          'Should not restart the client, ignoring restart request',
        );
        return;
      }
      await this.end();
      await this.start();
    });
  }

  protected listenConnectionEvents() {
    this.logger.debug(`Start listening ${BaileysEvents.CONNECTION_UPDATE}...`);
    this.sock.ev.on('connection.update', async (update) => {
      try {
        const { connection, lastDisconnect, qr, isNewLogin } = update;
        if (isNewLogin) {
          this.restartClient();
        } else if (connection === 'open') {
          this.qr.save('');
          this.permanentRestartAttempted = false;
          this.logoutRetryCount = 0;
          this.status = WAHASessionStatus.WORKING;
          return;
        } else if (connection === 'close') {
          this.qr.save('');
          await this.handleConnectionClose(lastDisconnect);
        }

        // Save QR
        if (qr) {
          this.qr.save(qr);
          this.printQR(this.qr);
          this.status = WAHASessionStatus.SCAN_QR_CODE;
        }
      } catch (err) {
        this.logger.error(
          { err: err.message, stack: err.stack },
          'Unhandled error in connection.update handler',
        );
        this.status = WAHASessionStatus.FAILED;
      }
    });
  }

  private async handleConnectionClose(lastDisconnect: any) {
    if (lastDisconnect == null) {
      this.logger.warn(
        'Connection closed without disconnect info — treating as transient',
      );
    }

    const error = lastDisconnect?.error as any;
    const statusCode: number | undefined = error?.output?.statusCode;
    let action = classifyDisconnect(statusCode);

    // Safety net: if the same code keeps repeating (regardless of classifier
    // category), upgrade to PERMANENT. This catches unknown codes that the
    // classifier doesn't yet recognize as permanent.
    const isRepeatedCode =
      this.statusTracker.trackDisconnectCode(statusCode);
    if (action === DisconnectAction.TRANSIENT && isRepeatedCode) {
      this.logger.warn(
        { statusCode },
        'Disconnect code repeated — upgrading to PERMANENT',
      );
      action = DisconnectAction.PERMANENT;
    }

    // Log at severity appropriate to the action
    const logData = {
      statusCode,
      action,
      error: lastDisconnect?.error?.message,
    };
    if (action === DisconnectAction.PERMANENT) {
      this.logger.error(logData, `Connection closed, action: ${action}`);
    } else if (action === DisconnectAction.TRANSIENT) {
      this.logger.warn(logData, `Connection closed, action: ${action}`);
    } else {
      this.logger.info(logData, `Connection closed, action: ${action}`);
    }

    // Stuck in STARTING status — break the loop regardless of action
    if (this.statusTracker.isStuckInStarting()) {
      this.logger.error(
        'Session stuck in STARTING status, force stopping the session.',
      );
      await this.failed();
      return;
    }

    switch (action) {
      case DisconnectAction.PERMANENT:
        await this.handlePermanentDisconnect(statusCode, lastDisconnect);
        return;

      case DisconnectAction.RESTART:
        this.restartClient();
        return;

      case DisconnectAction.TRANSIENT:
        if (this.status === WAHASessionStatus.SCAN_QR_CODE) {
          this.logger.warn(
            'QR code has not been scanned yet, force stopping the session.',
          );
          await this.failed();
          return;
        }
        if (lastDisconnect?.error) {
          this.logger.info(
            `Connection closed due to '${lastDisconnect.error?.message}', reconnecting...`,
          );
        }
        this.restartClient();
        return;
    }
  }

  /**
   * Handle permanent disconnects (auth is dead).
   * Cleans credentials, then either auto-restarts to generate a fresh QR
   * or falls back to FAILED if cleanup failed or already attempted.
   */
  private async handlePermanentDisconnect(
    statusCode: number | undefined,
    lastDisconnect: any,
  ) {
    // If the session has never paired (no creds.me), this is a registration/
    // pairing rejection (e.g. 405 during initial handshake), not stale auth.
    // Retry without setting the guard flag — the statusTracker.isStuckInStarting()
    // safety net (60 cycles) prevents infinite loops.
    const hasEstablishedAuth = !!this.authNOWEBStore?.state?.creds?.me;
    if (!hasEstablishedAuth) {
      this.logger.warn(
        { statusCode },
        `Permanent code ${statusCode} during registration (no paired auth) — retrying with fresh keys`,
      );
      // Close and discard the current auth store so makeSocket() generates
      // fresh signal/registration keys on the next attempt. Without this,
      // the same rejected keys are reused on every retry.
      await this.authNOWEBStore?.close?.();
      this.authNOWEBStore = null;
      this.restartClient();
      return;
    }

    // For 401 (loggedOut), retry once with existing credentials before wiping.
    // The 428→401 cascade is a well-known Baileys false-positive; a single retry
    // with the same creds often recovers the session.
    if (statusCode === 401) {
      if (this.logoutRetryCount === 0 && this.shouldRestart) {
        this.logoutRetryCount = 1;
        this.logger.warn(
          { statusCode },
          'Received 401 (loggedOut), retrying once with existing credentials before wiping auth state...',
        );
        this.restartClient();
        return;
      }

      this.logger.error(
        { statusCode },
        'Received 401 (loggedOut) after retry. Genuine logout, wiping auth state.',
      );
      this.logoutRetryCount = 0;
    }

    this.logger.error(
      { statusCode, error: lastDisconnect?.error?.message },
      `Permanent disconnect (status ${statusCode}): '${lastDisconnect?.error?.message}'. ` +
        'Cleaning auth state, session will require QR scan.',
    );

    const authCleaned = await this.cleanupAuthOnLogout();

    if (authCleaned && !this.permanentRestartAttempted) {
      // Auto-restart with clean credentials so Baileys generates a fresh QR.
      // restartClient() schedules end() + start() via startDelayedJob.
      this.permanentRestartAttempted = true;
      this.logger.info(
        'Restarting session with clean credentials to generate QR code...',
      );
      this.restartClient();
      return;
    }

    // Auth cleanup failed or already attempted a restart — give up.
    if (!authCleaned) {
      this.logger.error(
        'Auth cleanup failed, stale credentials remain. Setting session to FAILED.',
      );
    } else {
      this.logger.error(
        'Permanent disconnect recurred after restart. Setting session to FAILED.',
      );
    }

    this.shouldRestart = false;
    this.startDelayedJob.cancel();
    this.autoRestartJob.stop();
    this.presenceKeepAliveJob.stop();
    this.status = WAHASessionStatus.FAILED;

    try {
      await this.end();
    } catch (err) {
      this.logger.error(
        { err: err.message, stack: err.stack },
        'Failed to end socket during permanent disconnect cleanup',
      );
    }

    try {
      await this.store?.close();
    } catch (err) {
      this.logger.error(
        { err: err.message, stack: err.stack },
        'Failed to close store during permanent disconnect cleanup',
      );
    }
  }

  async stop() {
    this.shouldRestart = false;
    this.startDelayedJob.cancel();
    this.autoRestartJob.stop();
    this.presenceKeepAliveJob.stop();

    const hasCreds = this.authNOWEBStore?.state?.creds;
    if (hasCreds && this.status == WAHASessionStatus.WORKING) {
      this.logger.info('Saving creds before stopping...');
      await this.authNOWEBStore.saveCreds().catch((e) => {
        this.logger.error('Failed to save creds');
        this.logger.error(e, e.stack);
      });
      this.logger.info('Creds saved');
    }
    this.status = WAHASessionStatus.STOPPED;
    this.stopEvents();

    this.mediaManager.close();
    await this.end();
    await this.store?.close();
    this.authNOWEBStore?.close().catch((err) => {
      this.logger.error('Failed to close NOWEB auth store');
      this.logger.error(err, err.stack);
    });
  }

  protected async failed() {
    this.shouldRestart = false;
    this.startDelayedJob.cancel();
    this.autoRestartJob.stop();
    this.presenceKeepAliveJob.stop();

    // We'll restart the client if it's in the process of unpairing
    this.status = WAHASessionStatus.FAILED;

    if (this.unpairing) {
      // Wait for unpairing to complete before ending the socket
      await sleep(1_000);
    }

    await this.end();
    await this.store?.close();
  }

  /**
   * Clean persisted auth state after a permanent disconnect (401/403/405).
   * Removes credential files so the next session start generates a fresh QR code.
   * Returns true if cleanup succeeded, false if it failed.
   */
  private async cleanupAuthOnLogout(): Promise<boolean> {
    try {
      // Close the in-memory auth store
      await this.authNOWEBStore?.close?.();
      this.authNOWEBStore = null;

      // Remove persisted auth files from the session directory
      if (this.sessionStore instanceof LocalStore) {
        const fs = require('fs-extra');
        const KEEP_FILES = /^\.waha\.session\..*$/;
        const sessionDir = this.sessionStore.getSessionDirectory(this.name);
        if (await fs.pathExists(sessionDir)) {
          const files = await fs.readdir(sessionDir);
          for (const file of files) {
            if (!file.match(KEEP_FILES)) {
              await fs.remove(`${sessionDir}/${file}`);
            }
          }
        }
      }
      this.logger.info(
        'Auth state cleaned, next start will require QR scan.',
      );
      return true;
    } catch (err) {
      this.logger.error('Failed to clean auth state after disconnect');
      this.logger.error(err, err.stack);
      return false;
    }
  }

  private fixMessages() {
    this.sock.ev.on('messages.upsert', ({ messages }) => {
      for (const message of messages) {
        // If no status - set it to WAMessageAck.DEVICE
        message.status = message.status ?? AckToStatus(WAMessageAck.DEVICE);

        // Fix fromMe in @lid addressed groups
        // https://github.com/devlikeapro/waha/issues/1350
        if (message.key.participant === this.getSessionMeInfo()?.lid) {
          message.key.fromMe = true;
        }
      }
    });
  }

  private issueMessageUpdateOnEdits() {
    // Remove it after it's been merged
    // https://github.com/WhiskeySockets/Baileys/pull/855/
    this.sock.ev.on('messages.upsert', ({ messages }) => {
      for (const message of messages) {
        if (IsEditedMessage(message.message)) {
          const content = normalizeMessageContent(message.message);
          const protocolMsg = content?.protocolMessage;
          this.sock?.ev.emit('messages.update', [
            {
              key: {
                ...message.key,
                id: protocolMsg.key.id,
              },
              update: { message: protocolMsg.editedMessage },
            },
          ]);
        }
      }
    });
  }

  private issueMessageUpdateOnPoll() {
    // Fix for https://github.com/devlikeapro/waha/issues/960
    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      const me = this.getSessionMeInfo();
      if (!me) {
        this.logger.warn(
          'Cannot issue poll updates, session "me" info not found',
        );
        return;
      }

      for (const message of messages) {
        const content = normalizeMessageContent(message.message);
        if (!content?.pollUpdateMessage) {
          continue;
        }
        const creationMsgKey = content.pollUpdateMessage.pollCreationMessageKey;
        // we need to fetch the poll creation message to get the poll enc key
        const pkey = { ...creationMsgKey };
        pkey.remoteJid = null; // try to find message creation by id only
        const pollMsg = await this.getMessage(pkey);
        if (!pollMsg) {
          this.logger.warn(
            { creationMsgKey },
            'poll creation message not found, cannot decrypt update',
          );
          continue;
        }

        // Because of new @lid system it's hard to detect exactly how
        // the vote has been encrypted, so we'll iterator over all possible
        // not null combinations
        const key = message.key;
        const myIds = [jidNormalizedUser(me.id), jidNormalizedUser(me.lid)];
        const participantIds = [
          jidNormalizedUser(key?.participantAlt),
          jidNormalizedUser(key?.remoteJidAlt),
          jidNormalizedUser(key?.participant),
          jidNormalizedUser(key?.remoteJid),
        ];
        let creators: string[] = creationMsgKey.fromMe
          ? [...myIds, ...participantIds]
          : [...participantIds, ...myIds];
        let votes: string[] = key.fromMe
          ? [...myIds, ...participantIds]
          : [...participantIds, ...myIds];
        creators = uniq(creators.filter(Boolean));
        votes = uniq(votes.filter(Boolean));
        let found = false;
        for (const [pollCreatorJid, voterJid] of pairs(creators, votes)) {
          try {
            const pollEncKey = pollMsg.messageContextInfo?.messageSecret;
            const voteMsg = decryptPollVote(content.pollUpdateMessage.vote, {
              pollCreatorJid: pollCreatorJid,
              pollMsgId: creationMsgKey.id,
              pollEncKey: pollEncKey,
              voterJid: voterJid,
            });
            this.sock.ev.emit('messages.update', [
              {
                key: creationMsgKey,
                update: {
                  pollUpdates: [
                    {
                      pollUpdateMessageKey: message.key,
                      vote: voteMsg,
                      senderTimestampMs: (
                        content.pollUpdateMessage.senderTimestampMs as Long
                      ).toNumber(),
                    },
                  ],
                },
              },
            ]);
            found = true;
            break;
          } catch (err) {
            this.logger.trace(
              {
                err: err.message,
                key: key,
                creationsMsgKey: creationMsgKey,
                pollCreatorJid: pollCreatorJid,
                voterJid: voterJid,
              },
              'failed to decrypt poll vote using creator and voter',
            );
          }
        }
        if (!found) {
          this.logger.warn(
            {
              key: key,
              creationsMsgKey: creationMsgKey,
              creators: creators,
              voters: votes,
            },
            'failed to decrypt poll vote with any combination of creator/voter',
          );
        }
      }
    });
  }

  private issuePresenceUpdateOnMessageUpsert() {
    //
    // Fix for "typing" after sending a message
    // https://github.com/devlikeapro/waha/issues/379
    //
    this.sock.ev.on('messages.upsert', ({ messages }) => {
      const meId = this.sock?.authState?.creds?.me?.id;
      for (const message of messages) {
        if (!isRealMessage(message)) {
          continue;
        }
        if (message.key.fromMe) {
          continue;
        }
        const jid = message.key.remoteJid;
        const participant = message.key.participant || jid;
        const jidPresences = this.store?.presences?.[jid];
        const participantPresence = jidPresences?.[participant];
        if (participantPresence?.lastKnownPresence === 'composing') {
          this.logger.debug(
            `Fixing presence for '${participant}' in '${jid} since it's typing`,
          );
          const presence: PresenceData = { lastKnownPresence: 'available' };
          this.sock?.ev?.emit('presence.update', {
            id: jid,
            presences: { [participant]: presence },
          });
        }
      }
    });
  }

  private async end() {
    this.cleanupPresenceTimeout();
    this.presence = null;
    this.autoRestartJob.stop();
    this.presenceKeepAliveJob.stop();
    // @ts-ignore
    this.sock?.ev?.removeAllListeners();
    this.sock?.ws?.removeAllListeners();
    // wait until connection is not connecting to avoid error:
    // "WebSocket was closed before the connection was established"
    await waitUntil(async () => !this.sock?.ws?.isConnecting, 1_000, 10_000);
    this.sock?.end(undefined);
  }

  getSessionMeInfo(): MeInfo | null {
    const me = this.sock?.authState?.creds?.me;
    if (!me) {
      return null;
    }
    const meId = jidNormalizedUser(me.id);
    return {
      id: toCusFormat(meId),
      pushName: me.name,
      lid: jidNormalizedUser(me.lid),
    };
  }

  /**
   * START - Methods for API
   */

  /**
   * Auth methods
   */
  public getQR(): QR {
    return this.qr;
  }

  public async requestCode(
    phoneNumber: string,
    method: string,
    params?: any,
  ): Promise<PairingCodeResponse> {
    if (method) {
      const err = `NOWEB engine doesn't support any 'method', remove it and try again`;
      throw new UnprocessableEntityException(err);
    }

    if (this.status == WAHASessionStatus.STARTING) {
      this.logger.debug('Waiting for connection update...');
      await this.sock.waitForConnectionUpdate(async (update) => !!update.qr);
    }

    if (this.status != WAHASessionStatus.SCAN_QR_CODE) {
      const err = `Can request code only in SCAN_QR_CODE status. The current status is ${this.status}`;
      throw new UnprocessableEntityException(err);
    }

    this.logger.info(`Requesting pairing code for '${phoneNumber}'...`);
    const code: string = await this.sock.requestPairingCode(phoneNumber);
    // show it as ABCD-ABCD
    const parts = splitAt(code, 4);
    const codeRepr = parts.join('-');
    this.logger.info(`Your code: ${codeRepr}`);
    return { code: codeRepr };
  }

  async getScreenshot(): Promise<Buffer> {
    if (this.status === WAHASessionStatus.STARTING) {
      throw new UnprocessableEntityException(
        `The session is starting, please try again after few seconds`,
      );
    } else if (this.status === WAHASessionStatus.SCAN_QR_CODE) {
      return this.qr.get();
    } else if (this.status === WAHASessionStatus.WORKING) {
      throw new UnprocessableEntityException(
        `Can not get screenshot for non chrome based engine.`,
      );
    } else if (this.status === WAHASessionStatus.FAILED) {
      throw new UnprocessableEntityException(
        `The session has failed. Please restart the session and try again.`,
      );
    } else if (this.status === WAHASessionStatus.STOPPED) {
      throw new UnprocessableEntityException(
        `The session is stopped. Please start the session first.`,
      );
    } else {
      throw new UnprocessableEntityException(`Unknown status - ${this.status}`);
    }
  }

  /**
   * Profile methods
   */
  @Activity()
  public async setProfileName(name: string): Promise<boolean> {
    await this.sock.updateProfileName(name);
    return true;
  }

  @Activity()
  public async setProfileStatus(status: string): Promise<boolean> {
    await this.sock.updateProfileStatus(status);
    return true;
  }

  protected setProfilePicture(file: BinaryFile | RemoteFile): Promise<boolean> {
    throw new AvailableInPlusVersion();
  }

  protected deleteProfilePicture(): Promise<boolean> {
    throw new AvailableInPlusVersion();
  }

  /**
   * Other methods
   */
  async checkNumberStatus(
    request: CheckNumberStatusQuery,
  ): Promise<WANumberExistResult> {
    let phone = request.phone.split('@')[0];
    phone = phone.replace(/\+/g, '');

    const retryOptions = {
      retries: 3,
      minTimeout: 500,
      maxTimeout: 2000,
    };

    try {
      const results = await promiseRetry(
        (retry) => this.sock.onWhatsApp(phone).catch(retry),
        retryOptions,
      );
      const result = results?.[0];
      if (!result?.exists) {
        return { numberExists: false };
      }
      return {
        numberExists: true,
        chatId: toCusFormat(result.jid),
      };
    } catch (err) {
      this.logger.error(
        `Failed to check number status for '${phone}' after retries`,
      );
      this.logger.error(err, err.stack);
      return { numberExists: false };
    }
  }

  async generateNewMessageId(): Promise<string> {
    return this.generateMessageID();
  }

  async rejectCall(from: string, id: string): Promise<void> {
    const jid = toJID(this.ensureSuffix(from));
    await this.sock.rejectCall(id, jid);
  }

  @Activity()
  async sendText(request: MessageTextRequest) {
    const chatId = toJID(this.ensureSuffix(request.chatId));
    const message = {
      text: request.text,
      mentions: request.mentions?.map(toJID),
      linkPreview: this.getLinkPreview(request),
    };
    const options: any = await this.getMessageOptions(request);
    options.linkPreviewHighQuality = request.linkPreviewHighQuality;
    return this.sock.sendMessage(chatId, message, options);
  }

  @Activity()
  public deleteMessage(chatId: string, messageId: string) {
    const jid = toJID(this.ensureSuffix(chatId));
    const key = parseMessageIdSerialized(messageId);
    const options = {
      messageId: this.generateMessageID(),
    };
    return this.sock.sendMessage(jid, { delete: key }, options);
  }

  @Activity()
  public editMessage(
    chatId: string,
    messageId: string,
    request: EditMessageRequest,
  ) {
    const jid = toJID(this.ensureSuffix(chatId));
    const key = parseMessageIdSerialized(messageId);
    const message = {
      text: request.text,
      mentions: request.mentions?.map(toJID),
      edit: key,
      linkPreview: this.getLinkPreview(request),
      linkPreviewHighQuality: request.linkPreviewHighQuality,
    };
    const options = {
      messageId: this.generateMessageID(),
    };
    return this.sock.sendMessage(jid, message, options);
  }

  @Activity()
  async sendContactVCard(request: MessageContactVcardRequest) {
    const chatId = toJID(this.ensureSuffix(request.chatId));
    const contacts = request.contacts.map((el) => ({ vcard: toVcardV3(el) }));
    const options = await this.getMessageOptions(request);
    const msg = { contacts: { contacts: contacts } };
    return await this.sock.sendMessage(chatId, msg, options);
  }

  @Activity()
  async sendPoll(request: MessagePollRequest) {
    const requestPoll = request.poll;
    const poll = {
      name: requestPoll.name,
      values: requestPoll.options,
      selectableCount: requestPoll.multipleAnswers
        ? requestPoll.options.length
        : 1,
    };
    const message = { poll: poll };
    const remoteJid = toJID(request.chatId);
    const options = await this.getMessageOptions(request);
    const result = await this.sock.sendMessage(remoteJid, message, options);
    return this.toWAMessage(result);
  }

  @Activity()
  async reply(request: MessageReplyRequest) {
    const options = await this.getMessageOptions(request);
    const message = {
      text: request.text,
      mentions: request.mentions?.map(toJID),
    };
    return await this.sock.sendMessage(request.chatId, message, options);
  }

  private async getFileBuffer(file: any): Promise<Buffer> {
    if (!file) {
      throw new UnprocessableEntityException(
        'File is required. Provide either "file.url" or "file.data".',
      );
    }
    if ('url' in file && file.url) {
      return await this.fetch(file.url);
    }
    if ('data' in file && file.data) {
      return Buffer.from(file.data, 'base64');
    }
    throw new UnprocessableEntityException(
      'Either "file.url" or "file.data" must be specified.',
    );
  }

  @Activity()
  async sendImage(request: MessageImageRequest) {
    const chatId = toJID(this.ensureSuffix(request.chatId));
    const buffer = await this.getFileBuffer(request.file as any);
    const options = await this.getMessageOptions(request);
    const message: any = {
      image: buffer,
      mimetype: (request.file as any)?.mimetype,
      caption: request.caption || undefined,
      mentions: request.mentions?.map(toJID),
    };
    return await this.sock.sendMessage(chatId, message, options);
  }

  @Activity()
  async sendFile(request: MessageFileRequest) {
    const chatId = toJID(this.ensureSuffix(request.chatId));
    const buffer = await this.getFileBuffer(request.file as any);
    const options = await this.getMessageOptions(request);
    const filename =
      (request.file as any)?.filename || (request.file as any)?.fileName;
    const message: any = {
      document: buffer,
      mimetype: (request.file as any)?.mimetype,
      fileName: filename || 'file',
      caption: request.caption || undefined,
      mentions: request.mentions?.map(toJID),
    };
    return await this.sock.sendMessage(chatId, message, options);
  }

  @Activity()
  async sendVideo(request: MessageVideoRequest) {
    const chatId = toJID(this.ensureSuffix(request.chatId));
    const buffer = await this.getFileBuffer(request.file as any);
    const options = await this.getMessageOptions(request);
    const message: any = {
      video: buffer,
      mimetype: (request.file as any)?.mimetype,
      caption: (request as any)?.caption || undefined,
      mentions: (request as any)?.mentions?.map(toJID),
    };
    return await this.sock.sendMessage(chatId, message, options);
  }

  @Activity()
  async sendVoice(request: MessageVoiceRequest) {
    if (request.convert) {
      throw new UnprocessableEntityException(
        'Voice conversion is not available in this build. Send an OGG/Opus voice note (audio/ogg; codecs=opus) or pre-convert your audio and set "convert": false.',
      );
    }
    const chatId = toJID(this.ensureSuffix(request.chatId));
    const buffer = await this.getFileBuffer(request.file as any);
    const options = await this.getMessageOptions(request);
    const mimetype = (request.file as any)?.mimetype;
    const isOpus =
      typeof mimetype === 'string' &&
      (mimetype.includes('opus') || mimetype === 'audio/ogg');
    // If no mimetype provided, assume it's a PTT voice note (default opus format)
    const message: any = {
      audio: buffer,
      mimetype: mimetype || 'audio/ogg; codecs=opus',
      ptt: isOpus || !mimetype,
    };
    return await this.sock.sendMessage(chatId, message, options);
  }

  sendLinkCustomPreview(
    request: MessageLinkCustomPreviewRequest,
  ): Promise<any> {
    throw new AvailableInPlusVersion();
  }

  protected async uploadMedia(
    file: RemoteFile | BinaryFile,
    type,
  ): Promise<any> {
    if (!file) {
      return undefined;
    }
    if (type !== 'image') {
      throw new UnprocessableEntityException(
        `Unsupported media type '${type}' for interactive header media`,
      );
    }
    const buffer = await this.getFileBuffer(file as any);
    const prepared = await prepareWAMessageMedia(
      { image: buffer },
      { upload: this.sock.waUploadToServer },
    );
    // Baileys returns { imageMessage } inside the prepared object.
    return (prepared as any)?.imageMessage;
  }

  @Activity()
  async sendButtons(request: SendButtonsRequest) {
    const chatId = toJID(this.ensureSuffix(request.chatId));
    const headerImage = await this.uploadMedia(request.headerImage, 'image');
    return await sendButtonMessage(
      this.sock,
      chatId,
      request.buttons,
      request.header,
      headerImage,
      request.body,
      request.footer,
      request.wrapper,
      request.nodeApproach,
    );
  }

  @Activity()
  async sendList(request: SendListRequest): Promise<any> {
    const chatId = toJID(this.ensureSuffix(request.chatId));
    return await sendListMessage(
      this.sock,
      chatId,
      request.message.title,
      request.message.description,
      request.message.button,
      request.message.footer,
      request.message.sections,
      request.nodeApproach,
      request.iosFallback, // iOS fallback configuration
      this.messageUpdates$, // Observable for ACK monitoring
      this.logger, // Logger for debugging
    );
  }

  @Activity()
  async sendLocation(request: MessageLocationRequest) {
    const chatId = toJID(this.ensureSuffix(request.chatId));
    const msg = {
      location: {
        name: request.title || null,
        degreesLatitude: request.latitude,
        degreesLongitude: request.longitude,
      },
    };
    const options = await this.getMessageOptions(request);
    return await this.sock.sendMessage(chatId, msg, options);
  }

  @Activity()
  async forwardMessage(request: MessageForwardRequest): Promise<WAMessage> {
    const key = parseMessageIdSerialized(request.messageId);
    const forwardMessage = await this.store.loadMessage(key.remoteJid, key.id);
    if (!forwardMessage) {
      throw new UnprocessableEntityException(
        `Message with id '${request.messageId}' not found`,
      );
    }
    const chatId = toJID(this.ensureSuffix(request.chatId));
    const message = {
      forward: forwardMessage,
      force: true,
    };
    const options = await this.getMessageOptions(request);
    const result = await this.sock.sendMessage(chatId, message as any, options);
    return this.toWAMessage(result);
  }

  @Activity()
  async sendLinkPreview(request: MessageLinkPreviewRequest) {
    const text = `${request.title}\n${request.url}`;
    const chatId = toJID(this.ensureSuffix(request.chatId));
    const msg = { text: text };
    const options = await this.getMessageOptions(request);
    return this.sock.sendMessage(chatId, msg, options);
  }

  @Activity()
  async sendSeen(request: SendSeenRequest) {
    const keys = ExtractMessageKeysForRead(request);
    if (keys.length === 0) {
      return;
    }

    // Send read
    await this.sock.readMessages(keys);

    // Emit events for our reads
    const updates = keys.map((key) => ({
      key: key,
      update: { status: AckToStatus(WAMessageAck.READ) },
    }));
    this.sock?.ev.emit('messages.update', updates);
  }

  @Activity()
  async startTyping(request: ChatRequest): Promise<void> {
    const chatId = toJID(this.ensureSuffix(request.chatId));
    await this.sock.sendPresenceUpdate('composing', chatId);
  }

  @Activity()
  async stopTyping(request: ChatRequest) {
    const chatId = toJID(this.ensureSuffix(request.chatId));
    return this.sock.sendPresenceUpdate('paused', chatId);
  }

  public async getChatMessages(
    chatId: string,
    query: GetChatMessagesQuery,
    filter: GetChatMessagesFilter,
  ) {
    const downloadMedia = query.downloadMedia;
    const pagination = query as PaginationParams;
    const messages = await this.store.getMessagesByJid(
      toJID(chatId),
      filter,
      pagination,
    );

    const promises = [];
    for (const msg of messages) {
      promises.push(this.processIncomingMessage(msg, downloadMedia));
    }
    let result = await Promise.all(promises);
    result = result.filter(Boolean);
    return result;
  }

  @Activity()
  public readChatMessages(
    chatId: string,
    request: ReadChatMessagesQuery,
  ): Promise<ReadChatMessagesResponse> {
    return this.readChatMessagesWSImpl(chatId, request);
  }

  public async getChatMessage(
    chatId: string,
    messageId: string,
    query: GetChatMessageQuery,
  ): Promise<null | WAMessage> {
    const key = parseMessageIdSerialized(messageId, true);
    const message = await this.store.getMessageById(toJID(chatId), key.id);
    if (!message) return null;
    return await this.processIncomingMessage(message, query.downloadMedia);
  }

  @Activity()
  public async pinMessage(
    chatId: string,
    messageId: string,
    duration: PinDuration,
  ): Promise<boolean> {
    const jid = toJID(chatId);
    const key = parseMessageIdSerialized(messageId);
    await this.sock.sendMessage(jid, {
      pin: key,
      type: proto.PinInChat.Type.PIN_FOR_ALL,
      time: duration,
    });
    return true;
  }

  @Activity()
  public async unpinMessage(
    chatId: string,
    messageId: string,
  ): Promise<boolean> {
    const jid = toJID(chatId);
    const key = parseMessageIdSerialized(messageId);
    await this.sock.sendMessage(jid, {
      pin: key,
      type: proto.PinInChat.Type.UNPIN_FOR_ALL,
    });
    return true;
  }

  @Activity()
  async setReaction(request: MessageReactionRequest) {
    const key = parseMessageIdSerialized(request.messageId);
    if (isJidNewsletter(key.remoteJid)) {
      let serverId = Number(key.id);
      if (!serverId) {
        const msg = await this.store.getMessageById(key.remoteJid, key.id);
        if (msg) {
          // @ts-ignore
          serverId = Number(msg.key.server_id);
        }
      }
      if (!serverId) {
        throw new UnprocessableEntityException(
          `Unable to get server id for channel message '${key.id}'`,
        );
      }
      return this.sock.newsletterReactMessage(
        key.remoteJid,
        serverId.toString(),
        request.reaction,
      );
    } else {
      const reactionMessage = {
        react: {
          text: request.reaction,
          key: key,
        },
      };
      return this.sock.sendMessage(key.remoteJid, reactionMessage);
    }
  }

  @Activity()
  async setStar(request: MessageStarRequest) {
    const key = parseMessageIdSerialized(request.messageId);
    await this.sock.chatModify(
      {
        star: {
          messages: [{ id: key.id, fromMe: key.fromMe }],
          star: request.star,
        },
      },
      toJID(request.chatId),
    );
  }

  /**
   * Chats methods
   */

  async getChats(pagination: PaginationParams) {
    const chats = await this.store.getChats(pagination, true);
    // Remove unreadCount, it's not ready yet
    chats.forEach((chat) => delete chat.unreadCount);
    return chats;
  }

  public async getChatsOverview(
    pagination: PaginationParams,
    filter?: OverviewFilter,
  ): Promise<ChatSummary[]> {
    // Convert customer format IDs to JID format if filter is provided
    let jidFilter;
    if (filter?.ids && filter.ids.length > 0) {
      jidFilter = {
        ids: filter.ids.map((id) => toJID(id)),
      };
    }

    const chats = await this.store.getChats(pagination, false, jidFilter);
    // Remove unreadCount, it's not ready yet
    chats.forEach((chat) => delete chat.unreadCount);

    const promises = [];
    for (const chat of chats) {
      promises.push(this.fetchChatSummary(chat));
    }
    const result = await Promise.all(promises);
    return result;
  }

  protected async fetchChatSummary(chat: Chat): Promise<ChatSummary> {
    const id = toCusFormat(chat.id);
    let name = chat.name;
    if (!name) {
      // Get name by contact
      const jid = toJID(chat.id);
      const contact = await this.store.getContactById(jid);
      name = contact?.name || contact?.notify;
    }
    const picture = await this.getContactProfilePicture(chat.id, false);
    const messages = await this.getChatMessages(
      chat.id,
      { limit: 1, offset: 0, downloadMedia: false },
      {},
    );
    const message = messages.length > 0 ? messages[0] : null;
    return {
      id: id,
      name: name || null,
      picture: picture,
      lastMessage: message,
      _chat: chat,
    };
  }

  @Activity()
  protected async chatsPutArchive(
    chatId: string,
    archive: boolean,
  ): Promise<any> {
    const jid = toJID(chatId);
    const messages = await this.store.getMessagesByJid(jid, {}, { limit: 1 });
    return await this.sock.chatModify(
      { archive: archive, lastMessages: messages },
      jid,
    );
  }

  @Activity()
  public chatsArchiveChat(chatId: string): Promise<any> {
    return this.chatsPutArchive(chatId, true);
  }

  @Activity()
  public chatsUnarchiveChat(chatId: string): Promise<any> {
    return this.chatsPutArchive(chatId, false);
  }

  @Activity()
  public async chatsUnreadChat(chatId: string): Promise<any> {
    const jid = toJID(chatId);
    const messages = await this.store.getMessagesByJid(jid, {}, { limit: 1 });
    return await this.sock.chatModify(
      { markRead: false, lastMessages: messages },
      jid,
    );
  }

  /**
   * Labels methods
   */

  public async getLabels(): Promise<Label[]> {
    const labels = await this.store.getLabels();
    return labels.map(this.toLabel);
  }

  @Activity()
  public async createLabel(label: LabelDTO): Promise<Label> {
    const labels = await this.store.getLabels();
    const highestLabelId = max(
      labels.map((label) => parseInt(label.id)),
    );
    const labelId = highestLabelId ? highestLabelId + 1 : 1;
    const labelAction: LabelActionBody = {
      id: labelId.toString(),
      name: label.name,
      color: label.color,
      deleted: false,
      predefinedId: undefined,
    };
    await this.sock.addLabel(undefined, labelAction);

    return {
      id: labelId.toString(),
      name: label.name,
      color: label.color,
      colorHex: Label.toHex(label.color),
    };
  }

  @Activity()
  public async updateLabel(label: Label): Promise<Label> {
    const labelAction: LabelActionBody = {
      id: label.id,
      name: label.name,
      color: label.color,
      deleted: false,
      predefinedId: undefined,
    };
    await this.sock.addLabel(undefined, labelAction);
    return label;
  }

  @Activity()
  public async deleteLabel(label: Label): Promise<void> {
    const labelAction: LabelActionBody = {
      id: label.id,
      name: label.name,
      color: label.color,
      deleted: true,
      predefinedId: undefined,
    };
    await this.sock.addLabel(undefined, labelAction);
  }

  public async getChatsByLabelId(labelId: string) {
    const chats = await this.store.getChatsByLabelId(labelId);
    // Remove unreadCount, it's not ready yet
    chats.forEach((chat) => delete chat.unreadCount);
    return chats;
  }

  public async getChatLabels(chatId: string): Promise<Label[]> {
    const jid = toJID(chatId);
    const labels = await this.store.getChatLabels(jid);
    return labels.map(this.toLabel);
  }

  @Activity()
  public async putLabelsToChat(chatId: string, labels: LabelID[]) {
    const jid = toJID(chatId);
    const labelsIds = labels.map((label) => label.id);
    const currentLabels = await this.store.getChatLabels(jid);
    const currentLabelsIds = currentLabels.map((label) => label.id);
    const addLabelsIds = difference(labelsIds, currentLabelsIds);
    const removeLabelsIds = difference(currentLabelsIds, labelsIds);
    for (const labelId of addLabelsIds) {
      await this.sock.addChatLabel(jid, labelId);
    }
    for (const labelId of removeLabelsIds) {
      await this.sock.removeChatLabel(jid, labelId);
    }
  }

  protected toLabel(label: NOWEBLabel): Label {
    const color = label.color;
    return {
      id: label.id,
      name: label.name,
      color: color,
      colorHex: Label.toHex(color),
    };
  }

  private async toLabelChatAssociation(
    association: ChatLabelAssociation,
  ): Promise<LabelChatAssociation> {
    const labelData = await this.store.getLabelById(association.labelId);
    const label = labelData ? this.toLabel(labelData) : null;
    return {
      labelId: association.labelId,
      chatId: toCusFormat(association.chatId),
      label: label,
    };
  }

  /**
   * Contacts methods
   */

  @Activity()
  public async upsertContact(chatId: string, body: ContactUpdateBody) {
    const jid = toJID(chatId);
    let fullName = body.firstName;
    if (body.lastName) {
      fullName = `${body.firstName} ${body.lastName}`;
    }
    const action = {
      fullName: fullName,
      firstName: body.firstName,
      saveOnPrimaryAddressbook: true,
    };
    await this.sock.addOrEditContact(jid, action);
    const updates: Partial<Contact>[] = [
      {
        id: jid,
        name: fullName,
      },
    ];
    this.sock.ev.emit('contacts.update', updates);
  }

  async getContact(query: ContactQuery) {
    const jid = toJID(query.contactId);
    const contact = await this.store.getContactById(jid);
    if (!contact) {
      return null;
    }
    return this.toWAContact(contact);
  }

  async getContacts(pagination: PaginationParams) {
    const contacts = await this.store.getContacts(pagination);
    return contacts.map(this.toWAContact);
  }

  @Activity()
  public async fetchContactProfilePicture(id: string) {
    const contact = this.ensureSuffix(id);
    try {
      const url = await this.sock.profilePictureUrl(contact, 'image');
      return url;
    } catch (err) {
      if (err.message == 'item-not-found') {
        return null;
      }
      if (err.message == 'not-authorized') {
        return null;
      }
      throw err;
    }
  }

  public async blockContact(request: ContactRequest) {
    throw new NotImplementedByEngineError();
  }

  public async unblockContact(request: ContactRequest) {
    throw new NotImplementedByEngineError();
  }

  /**
   * Lid to Phone Number methods
   */
  public async getAllLids(
    pagination: PaginationParams,
  ): Promise<Array<LidToPhoneNumber>> {
    const lids = await this.store.getAllLids(pagination);
    return lids.map((value) => {
      return {
        lid: value.lid,
        pn: toCusFormat(value.pn),
      };
    });
  }

  public async getLidsCount(): Promise<number> {
    return this.store.getLidsCount();
  }

  public async findPNByLid(lid: string): Promise<LidToPhoneNumber> {
    const pn = await this.store.findPNByLid(lid);
    return {
      lid: lid,
      pn: pn ? toCusFormat(pn) : null,
    };
  }

  public async findLIDByPhoneNumber(
    phoneNumber: string,
  ): Promise<LidToPhoneNumber> {
    const pn = toJID(phoneNumber);
    const lid = await this.store.findLidByPN(pn);
    return {
      lid: lid || null,
      pn: toCusFormat(pn),
    };
  }

  /**
   * Group methods
   */
  @Activity()
  public createGroup(request: CreateGroupRequest) {
    const participants = request.participants.map(getId);
    return this.sock.groupCreate(request.name, participants);
  }

  @Activity()
  public joinGroup(code: string) {
    return this.sock.groupAcceptInvite(code);
  }

  @Activity()
  public joinInfoGroup(code: string) {
    return this.sock.groupGetInviteInfo(code);
  }

  public async getGroups(pagination: PaginationParams) {
    const groups = await this.store.getGroups(pagination);
    // return {id: group} mapping for backward compatability
    return keyBy(groups, 'id');
  }

  protected removeGroupsFieldParticipant(group: any) {
    delete group.participants;
  }

  @Activity()
  public async refreshGroups(): Promise<boolean> {
    this.store.resetGroupsCache();
    await this.store.getGroups({});
    return true;
  }

  public async getGroup(id) {
    const groups = await this.getGroups({});
    const group = groups[id];
    if (!group) {
      throw new Error(`Group with id '${id}' not found`);
    }
    return group;
  }

  public async getGroupParticipants(id: string): Promise<GroupParticipant[]> {
    const group = (await this.getGroup(id)) as GroupMetadata;
    if (!group?.participants?.length) {
      return [];
    }
    return group.participants.map(ToGroupParticipant);
  }

  public async deleteGroup(id) {
    throw new NotImplementedByEngineError();
  }

  public async getInfoAdminsOnly(id): Promise<SettingsSecurityChangeInfo> {
    const group = await this.getGroup(id);
    return { adminsOnly: group.restrict };
  }

  @Activity()
  public async setInfoAdminsOnly(id, value) {
    const setting = value ? 'locked' : 'unlocked';
    return await this.sock.groupSettingUpdate(id, setting);
  }

  public async getMessagesAdminsOnly(id): Promise<SettingsSecurityChangeInfo> {
    const group = await this.getGroup(id);
    return { adminsOnly: group.announce };
  }

  @Activity()
  public async setMessagesAdminsOnly(id, value) {
    const setting = value ? 'announcement' : 'not_announcement';
    return await this.sock.groupSettingUpdate(id, setting);
  }

  @Activity()
  public async leaveGroup(id) {
    return this.sock.groupLeave(id);
  }

  @Activity()
  public async setDescription(id, description) {
    return this.sock.groupUpdateDescription(id, description);
  }

  @Activity()
  public async setSubject(id, subject) {
    return this.sock.groupUpdateSubject(id, subject);
  }

  @Activity()
  public async getInviteCode(id): Promise<string> {
    return this.sock.groupInviteCode(id);
  }

  @Activity()
  public async revokeInviteCode(id): Promise<string> {
    await this.sock.groupRevokeInvite(id);
    return this.sock.groupInviteCode(id);
  }

  public async getParticipants(id) {
    const groups = await this.sock.groupFetchAllParticipating();
    return groups[id].participants;
  }

  @Activity()
  public async addParticipants(id, request: ParticipantsRequest) {
    const participants = request.participants.map(getId);
    return this.sock.groupParticipantsUpdate(id, participants, 'add');
  }

  @Activity()
  public async removeParticipants(id, request: ParticipantsRequest) {
    const participants = request.participants.map(getId);
    return this.sock.groupParticipantsUpdate(id, participants, 'remove');
  }

  @Activity()
  public async promoteParticipantsToAdmin(id, request: ParticipantsRequest) {
    const participants = request.participants.map(getId);
    return this.sock.groupParticipantsUpdate(id, participants, 'promote');
  }

  @Activity()
  public async demoteParticipantsToUser(id, request: ParticipantsRequest) {
    const participants = request.participants.map(getId);
    return this.sock.groupParticipantsUpdate(id, participants, 'demote');
  }

  public async setPresence(presence: WAHAPresenceStatus, chatId?: string) {
    switch (presence) {
      case WAHAPresenceStatus.TYPING:
      case WAHAPresenceStatus.RECORDING:
      case WAHAPresenceStatus.PAUSED:
        await this.maintainPresenceOnline();
    }
    const enginePresence = ToEnginePresenceStatus[presence];
    if (!enginePresence) {
      throw new NotImplementedByEngineError(
        `NOWEB engine doesn't support '${presence}' presence.`,
      );
    }
    if (chatId) {
      chatId = toJID(this.ensureSuffix(chatId));
    }
    await this.sock.sendPresenceUpdate(enginePresence, chatId);
    this.presence = presence;
  }

  public async getPresences(): Promise<WAHAChatPresences[]> {
    const result: WAHAChatPresences[] = [];
    for (const remoteJid in this.store.presences) {
      const storedPresences = this.store.presences[remoteJid];
      result.push(this.toWahaPresences(remoteJid, storedPresences));
    }
    return result;
  }

  public async getPresence(chatId: string): Promise<WAHAChatPresences> {
    const jid = toJID(chatId);
    await this.subscribePresence(jid);
    if (!(jid in this.store.presences)) {
      this.store.presences[jid] = {};
      await sleep(1000);
    }
    const result = this.store.presences[jid];
    return this.toWahaPresences(jid, result);
  }

  @Activity()
  public subscribePresence(id: string): Promise<void> {
    const jid = toJID(id);
    return this.sock.presenceSubscribe(jid);
  }

  /**
   * Status methods
   */
  @Activity()
  public async sendStatusMessage(
    message: any,
    options: any,
    jids: string[],
    batchSize?: number,
  ) {
    if (!batchSize || batchSize == 0) {
      batchSize = 5_000;
    }
    const chunks = chunk(jids, batchSize);
    if (chunks.length == 0) {
      throw new UnprocessableEntityException('No participants to send status');
    }

    const logger = this.logger.child({
      'message.id': options.messageId,
      chunks: chunks.length,
      size: batchSize,
    });
    logger.info(`Sending status message to ${jids.length} participants`);
    let result = null;
    for (const [index, participants] of chunks.entries()) {
      const batchOptions = { ...options };
      batchOptions.statusJidList = participants;
      const r = await this.sendStatusMessageOneChunk(
        message,
        batchOptions,
        logger,
        index,
      );
      result = result || r;
    }
    logger.info(
      `Sending status message to ${jids.length} participants - success`,
    );
    return result;
  }

  private async sendStatusMessageOneChunk(
    message: any,
    options: any,
    logger: any,
    index: number,
  ) {
    // https://github.com/IndigoUnited/node-promise-retry
    const retryOptions = {
      retries: 5,
      minTimeout: 1000,
      maxTimeout: 6000,
    };
    try {
      const resp = await promiseRetry((retry, number) => {
        return this.sock
          .sendMessage(BROADCAST_ID, message, options)
          .catch(retry);
      }, retryOptions);
      logger.info(`Sending status message (${index + 1} chunk) - success`);
      return resp;
    } catch (err) {
      logger.error(`Sending status message (${index + 1} chunk - failed`);
      logger.error(err, err.stack);
      throw err;
    }
  }

  @Activity()
  public async sendTextStatus(status: TextStatus) {
    const message = {
      text: status.text,
      linkPreview: this.getLinkPreview(status),
    };
    const jids = await this.prepareJidsForStatus(status.contacts);
    if (!status.id) {
      this.upsertMeInJIDs(jids);
    }
    const messageId = this.prepareMessageIdForStatus(status);
    const options: MiscMessageGenerationOptions = {
      backgroundColor: status.backgroundColor,
      font: status.font,
      linkPreviewHighQuality: status.linkPreviewHighQuality,
      messageId: messageId,
    };
    return await this.sendStatusMessage(
      message,
      options,
      jids,
      status.contacts?.length,
    );
  }

  protected prepareMessageIdForStatus(status: StatusRequest) {
    if (status.id) {
      this.saveSentMessageId(status.id);
      return status.id;
    }
    return this.generateMessageID();
  }

  protected async prepareJidsForStatus(contacts: string[]) {
    let jids: string[];
    if (contacts?.length > 0) {
      jids = contacts.map(toJID);
    } else {
      jids = await this.fetchMyContactsJids();
    }
    return jids;
  }

  protected async fetchMyContactsJids() {
    const contacts = await this.store.getContacts({});
    const jids = contacts.map((contact) => contact.id);
    return jids.filter((jid) => jid.endsWith('@s.whatsapp.net'));
  }

  @Activity()
  public async deleteStatus(request: DeleteStatusRequest) {
    const messageId = request.id;
    const key = parseMessageIdSerialized(messageId, true);
    key.fromMe = true;
    key.remoteJid = BROADCAST_ID;
    const jids = await this.prepareJidsForStatus(request.contacts);
    this.upsertMeInJIDs(jids);
    const newMessageId = this.generateMessageID();
    const options = {
      statusJidList: jids,
      messageId: newMessageId,
    };
    return await this.sendStatusMessage(
      { delete: key },
      options,
      jids,
      request.contacts?.length,
    );
  }

  protected upsertMeInJIDs(jids: string[]) {
    if (!this.sock?.authState?.creds?.me) {
      return;
    }
    const myJID = jidNormalizedUser(this.sock.authState.creds.me.id);
    if (!jids.includes(myJID)) {
      // insert my jid first
      jids.unshift(myJID);
    }
  }

  /**
   * Channels methods
   */
  public searchChannelsByView(
    query: ChannelSearchByView,
  ): Promise<ChannelListResult> {
    throw new AvailableInPlusVersion();
  }

  public searchChannelsByText(
    query: ChannelSearchByText,
  ): Promise<ChannelListResult> {
    throw new AvailableInPlusVersion();
  }

  public async previewChannelMessages(
    inviteCode: string,
    query: PreviewChannelMessages,
  ): Promise<ChannelMessage[]> {
    throw new AvailableInPlusVersion();
  }

  protected toChannel(newsletter: NOWEBNewsletterMetadata): Channel {
    const role =
      newsletter.viewer_metadata?.role ||
      (newsletter.viewer_metadata?.view_role as ChannelRole) ||
      ChannelRole.GUEST;
    const preview = newsletter.preview
      ? getPublicUrlFromDirectPath(newsletter.preview)
      : null;
    const picture = newsletter.picture
      ? getPublicUrlFromDirectPath(newsletter.picture)
      : null;
    return {
      id: newsletter.id,
      name: newsletter.name,
      description: newsletter.description,
      invite: getChannelInviteLink(newsletter.invite),
      preview: preview || picture,
      picture: picture || preview,
      verified: newsletter.verification === 'VERIFIED',
      role: role,
      subscribersCount: newsletter.subscribers,
    };
  }

  public async channelsList(query: ListChannelsQuery): Promise<Channel[]> {
    const newsletters = await this.sock.newsletterSubscribed();
    let channels = newsletters
      .map(toNewsletterMetadata)
      .filter(Boolean)
      .map(this.toChannel);
    if (query.role) {
      // @ts-ignore
      channels = channels.filter((channel) => channel.role === query.role);
    }
    return channels;
  }

  @Activity()
  public async channelsCreateChannel(request: CreateChannelRequest) {
    const newsletter = await this.sock.newsletterCreate(
      request.name,
      request.description,
    );
    return this.toChannel(toNewsletterMetadata(newsletter));
  }

  public async channelsGetChannel(id: string) {
    const newsletter = await this.sock.newsletterMetadata('jid', id);
    return this.toChannel(toNewsletterMetadata(newsletter));
  }

  @Activity()
  public async channelsGetChannelByInviteCode(inviteCode: string) {
    const newsletter = await this.sock.newsletterMetadata('invite', inviteCode);
    return this.toChannel(toNewsletterMetadata(newsletter));
  }

  @Activity()
  public async channelsDeleteChannel(id: string) {
    return await this.sock.newsletterDelete(id);
  }

  @Activity()
  public async channelsFollowChannel(id: string): Promise<any> {
    return await this.sock.newsletterFollow(id);
  }

  @Activity()
  public async channelsUnfollowChannel(id: string): Promise<any> {
    return await this.sock.newsletterUnfollow(id);
  }

  @Activity()
  public async channelsMuteChannel(id: string): Promise<any> {
    return await this.sock.newsletterMute(id);
  }

  @Activity()
  public async channelsUnmuteChannel(id: string): Promise<any> {
    return await this.sock.newsletterUnmute(id);
  }

  subscribeEngineEvents2() {
    //
    // All
    //
    const all$ = new Observable<EnginePayload>((subscriber) => {
      return this.sock.ev.process((events) => {
        // iterate over keys
        for (const event in events) {
          const data = events[event];
          subscriber.next({ event: event, data: data });
        }
      });
    });
    this.events2.get(WAHAEvents.ENGINE_EVENT).switch(all$);

    //
    // Messages
    //
    const messagesUpsert$ = fromEvent(this.sock.ev, 'messages.upsert').pipe(
      map((event: BaileysEventMap['messages.upsert']) => event.messages),
      mergeAll(),
      filter((msg) => this.jids.include(msg.key.remoteJid)),
      share(),
    );
    let [messagesFromMe$, messagesFromOthers$] = partition(
      messagesUpsert$,
      isMine,
    );
    messagesFromMe$ = messagesFromMe$.pipe(
      mergeMap((msg) => this.processIncomingMessage(msg, true)),
      share(), // share it so we don't process twice in message.any
    );
    messagesFromOthers$ = messagesFromOthers$.pipe(
      mergeMap((msg) => this.processIncomingMessage(msg, true)),
      share(), // share it so we don't process twice in message.any
    );
    const messagesFromAll$ = merge(messagesFromMe$, messagesFromOthers$);
    this.events2.get(WAHAEvents.MESSAGE).switch(messagesFromOthers$);
    this.events2.get(WAHAEvents.MESSAGE_ANY).switch(messagesFromAll$);

    const messagesRevoked$ = messagesUpsert$.pipe(
      // @ts-ignore
      filter(
        (message) =>
          message.message?.protocolMessage?.type ===
          proto.Message.ProtocolMessage.Type.REVOKE,
      ),
      mergeMap(async (message): Promise<WAMessageRevokedBody> => {
        const afterMessage = this.toWAMessage(message);
        // Extract the revoked message ID from protocolMessage.key
        const revokedMessageId = message.message.protocolMessage.key?.id;
        return {
          after: afterMessage,
          before: null,
          revokedMessageId: revokedMessageId,
          _data: message,
        };
      }),
    );
    this.events2.get(WAHAEvents.MESSAGE_REVOKED).switch(messagesRevoked$);

    // Handle edited messages
    const messagesEdited$ = messagesUpsert$.pipe(
      filter((message) => IsEditedMessage(message.message)),
      mergeMap(async (message): Promise<WAMessageEditedBody> => {
        const waMessage = this.toWAMessage(message);
        // Extract the body from editedMessage using extractBody function
        const content = normalizeMessageContent(message.message);
        const body = extractBody(content.protocolMessage.editedMessage) || '';
        // Extract the original message ID from protocolMessage.key
        const editedMessageId = content.protocolMessage.key?.id;
        return {
          ...waMessage,
          body: body,
          editedMessageId: editedMessageId,
          _data: message,
        };
      }),
    );
    this.events2.get(WAHAEvents.MESSAGE_EDITED).switch(messagesEdited$);

    //
    // Message Reactions
    //
    const messageReactions$ = messagesUpsert$.pipe(
      map(this.processMessageReaction.bind(this)),
      filter(Boolean),
    );
    this.events2.get(WAHAEvents.MESSAGE_REACTION).switch(messageReactions$);

    //
    // Message Ack
    //
    // Store the observable for use by iOS fallback mechanism
    this.messageUpdates$ = fromEvent(
      this.sock.ev,
      'messages.update',
    ).pipe(
      // @ts-ignore
      mergeAll(),
      filter((update) => this.jids.include(update.key.remoteJid)),
      share(),
    );
    const messageUpdates$ = this.messageUpdates$;
    const messageAckDirect$ = messageUpdates$.pipe(
      filter(isMine), // ack comes only for MY messages
      filter(isAckUpdateMessageEvent),
      map(this.convertMessageUpdateToMessageAck.bind(this)),
    );
    const messageReceiptUpdate$: Observable<MessageUserReceiptUpdate> =
      fromEvent(this.sock.ev, 'message-receipt.update').pipe(
        // @ts-ignore
        mergeAll(),
        filter((update) => this.jids.include(update.key.remoteJid)),
        share(),
      );

    const messageAckGroups$ = messageReceiptUpdate$.pipe(
      filter(isMine), // ack comes only for MY messages
      map(this.convertMessageReceiptUpdateToMessageAck.bind(this)),
    );
    const messageAckDirectFinal$ = messageAckDirect$.pipe(DistinctAck());
    const messageAckGroupsFinal$ = messageAckGroups$.pipe(DistinctAck());

    this.events2.get(WAHAEvents.MESSAGE_ACK).switch(messageAckDirectFinal$);
    this.events2
      .get(WAHAEvents.MESSAGE_ACK_GROUP)
      .switch(messageAckGroupsFinal$);

    //
    // Other
    //
    this.events2
      .get(WAHAEvents.STATE_CHANGE)
      .switch(fromEvent(this.sock.ev, 'connection.update').pipe(share()));

    const groupsUpsert$: Observable<GroupMetadata> = fromEvent(
      this.sock.ev,
      'groups.upsert',
    ).pipe(
      // @ts-ignore
      mergeAll(),
      share(),
    );
    const groupsUpdate$: Observable<Partial<GroupMetadata>> = fromEvent(
      this.sock.ev,
      'groups.update',
    ).pipe(
      // @ts-ignore
      mergeAll(),
      share(),
    );
    const groupsParticipantsUpdate$: Observable<any> = fromEvent(
      this.sock.ev,
      'group-participants.update',
    ).pipe(share());

    this.events2.get(WAHAEvents.GROUP_JOIN).switch(groupsUpsert$);

    const groupV2Join$ = groupsUpsert$.pipe(
      map((group) => ToGroupV2JoinEvent(group)),
    );
    this.events2.get(WAHAEvents.GROUP_V2_JOIN).switch(groupV2Join$);

    const groupV2Update$ = merge(groupsUpdate$).pipe(map(ToGroupV2UpdateEvent));
    this.events2.get(WAHAEvents.GROUP_V2_UPDATE).switch(groupV2Update$);

    const groupV2Participants$ = groupsParticipantsUpdate$.pipe(
      map(ToGroupV2Participants),
    );
    this.events2
      .get(WAHAEvents.GROUP_V2_PARTICIPANTS)
      .switch(groupV2Participants$);

    const groupV2Leave$ = groupsParticipantsUpdate$.pipe(
      map((group) =>
        ToGroupV2LeaveEvent(this.sock?.authState?.creds?.me, group),
      ),
      filter(Boolean),
    );
    this.events2.get(WAHAEvents.GROUP_V2_LEAVE).switch(groupV2Leave$);

    this.events2.get(WAHAEvents.PRESENCE_UPDATE).switch(
      fromEvent(this.sock.ev, 'presence.update').pipe(
        filter((presence: any) => this.jids.include(presence.id)),
        map((data: any) => this.toWahaPresences(data.id, data.presences)),
        share(),
      ),
    );

    //
    // Poll votes
    //
    this.events2
      .get(WAHAEvents.POLL_VOTE)
      .switch(
        messageUpdates$.pipe(
          mergeMap(this.handleMessagesUpdatePollVote.bind(this)),
          filter(Boolean),
        ),
      );
    this.events2
      .get(WAHAEvents.POLL_VOTE_FAILED)
      .switch(
        messagesUpsert$.pipe(
          mergeMap(this.handleMessageUpsertPollVoteFailed.bind(this)),
          filter(Boolean),
        ),
      );

    //
    // Calls
    //
    // @ts-ignore
    const calls$: Observable<WACallEvent[]> = fromEvent(this.sock.ev, 'call');
    const call$ = calls$.pipe(
      mergeMap(identity),
      filter((call: WACallEvent) =>
        this.jids.include(call.groupJid || call.chatId),
      ),
      share(),
    );

    const acceptedCallIds = new Set<string>();
    this.events2.get(WAHAEvents.CALL_RECEIVED).switch(
      call$.pipe(
        filter((call: WACallEvent) => call.status === 'offer'),
        map(this.toCallData.bind(this)),
      ),
    );
    this.events2.get(WAHAEvents.CALL_ACCEPTED).switch(
      call$.pipe(
        filter((call: WACallEvent) => call.status === 'accept'),
        tap((call: WACallEvent) => acceptedCallIds.add(call.id)),
        map(this.toCallData.bind(this)),
      ),
    );
    this.events2.get(WAHAEvents.CALL_REJECTED).switch(
      call$.pipe(
        filter(
          (call: WACallEvent) =>
            call.status === 'reject' || call.status === 'terminate',
        ),
        // Skip rejections when the call was accepted earlier (local or other device)
        exclude((call: WACallEvent) => {
          const shouldSkip = acceptedCallIds.has(call.id);
          if (call.status === 'terminate') {
            acceptedCallIds.delete(call.id);
          }
          return shouldSkip;
        }),
        // We get two "reject" events, one with null isGroup property, ignore it
        exclude((call: WACallEvent) => call.isGroup == null),
        groupBy((call: WACallEvent) => call.id || 'unknown'),
        mergeMap((group$) =>
          group$.pipe(
            debounceTime(1_000),
            tap((call: WACallEvent) => acceptedCallIds.delete(call.id)),
          ),
        ),
        map(this.toCallData.bind(this)),
      ),
    );

    //
    // Labels
    //
    // @ts-ignore
    const labelsEdit$: Observable<NOWEBLabel> = fromEvent(
      this.sock.ev,
      'labels.edit',
    ).pipe(share());
    this.events2.get(WAHAEvents.LABEL_UPSERT).switch(
      labelsEdit$.pipe(
        exclude((data: NOWEBLabel) => data.deleted),
        map(this.toLabel.bind(this)),
      ),
    );
    this.events2.get(WAHAEvents.LABEL_DELETED).switch(
      labelsEdit$.pipe(
        filter((data: NOWEBLabel) => data.deleted),
        map(this.toLabel.bind(this)),
      ),
    );
    const labelsAssociation$ = fromEvent(
      this.sock.ev,
      'labels.association',
    ).pipe(share());
    const labelsAssociationAdd$: Observable<ChatLabelAssociation> =
      labelsAssociation$.pipe(
        filter(({ type }: any) => type === 'add'),
        map((data) => data.association),
        filter(
          (association: any) => association.type === LabelAssociationType.Chat,
        ),
      );

    const labelsAssociationRemove$: Observable<ChatLabelAssociation> =
      labelsAssociation$.pipe(
        filter(({ type }: any) => type === 'remove'),
        map((data) => data.association),
        filter(
          (association: any) => association.type === LabelAssociationType.Chat,
        ),
      );
    this.events2
      .get(WAHAEvents.LABEL_CHAT_ADDED)
      .switch(
        labelsAssociationAdd$.pipe(
          mergeMap(this.toLabelChatAssociation.bind(this)),
        ),
      );
    this.events2
      .get(WAHAEvents.LABEL_CHAT_DELETED)
      .switch(
        labelsAssociationRemove$.pipe(
          mergeMap(this.toLabelChatAssociation.bind(this)),
        ),
      );
  }

  protected listenContactsUpdatePictureProfile() {
    this.sock.ev.on('contacts.update', async (updates) => {
      for (const update of updates) {
        if (update.imgUrl !== 'changed') {
          continue;
        }

        this.logger.debug({ jid: update.id }, 'Profile picture updated');
        const url = await this.refreshProfilePicture(update.id);
        if (isPnUser(update.id) || isLidUser(update.id)) {
          // update 123@c.us and 123 profiles as well
          const cus = toCusFormat(update.id);
          this.profilePictures.set(cus, url);
          const phone = update.id.split('@')[0];
          this.profilePictures.set(phone, url);
        }
      }
    });
  }

  /**
   * END - Methods for API
   */

  private processMessageReaction(message): WAMessageReaction | null {
    if (!message) return null;
    if (!message.message) return null;
    if (!message.message.reactionMessage) return null;

    const id = buildMessageId(message.key);
    const fromToParticipant = getFromToParticipant(message.key);
    const reactionMessage = message.message.reactionMessage;
    const messageId = buildMessageId(reactionMessage.key);
    const source = this.getMessageSource(message.key.id);
    const reaction: WAMessageReaction = {
      id: id,
      timestamp: ensureNumber(message.messageTimestamp),
      from: toCusFormat(fromToParticipant.from),
      fromMe: message.key.fromMe,
      source: source,
      to: toCusFormat(fromToParticipant.to),
      participant: toCusFormat(fromToParticipant.participant),
      reaction: {
        text: reactionMessage.text,
        messageId: messageId,
      },
    };
    return reaction;
  }

  shouldProcessIncomingMessage(message): boolean {
    // if there is no text or media message
    if (!message) return;
    if (!message.message) return;
    // Ignore reactions, we have dedicated handler for that
    if (message.message.reactionMessage) return;
    // Ignore poll votes, we have dedicated handler for that
    if (message.message.pollUpdateMessage) return;
    // Ignore calls, we have dedicated handler for that
    if (message.message.call?.callKey) return;
    // Ignore revoke, we have a dedicated event for that
    if (
      message.message?.protocolMessage?.type ===
      proto.Message.ProtocolMessage.Type.REVOKE
    )
      return;
    // Ignore edit, we have a dedicated event for that
    if (IsEditedMessage(message.message)) return;

    // Ignore history sync notifications
    if (IsHistorySyncNotification(message.message)) return;

    if (
      message.message?.protocolMessage?.type ===
      proto.Message.ProtocolMessage.Type.EPHEMERAL_SYNC_RESPONSE
    )
      return;
    if (
      message.message?.protocolMessage?.type ===
      proto.Message.ProtocolMessage.Type
        .PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE
    )
      return;

    const normalizedContent = normalizeMessageContent(message.message);
    const contentType = getContentType(normalizedContent);
    // Ignore device sent message
    if (contentType == 'deviceSentMessage') {
      return;
    }
    const hasSomeContent = !!contentType;
    if (!hasSomeContent) {
      // Ignore key distribution messages
      if (message?.message?.senderKeyDistributionMessage) return;
    }
    return true;
  }

  protected async processIncomingMessage(
    message,
    downloadMedia: boolean,
  ): Promise<WAMessage | null> {
    // Filter
    if (!this.shouldProcessIncomingMessage(message)) {
      return null;
    }
    // Convert
    const wamessage = this.toWAMessageSafe(message);
    if (!wamessage) {
      return null;
    }
    // Media
    if (downloadMedia) {
      const media = await this.downloadMediaSafe(message);
      wamessage.media = media;
    }
    return wamessage;
  }

  protected toWAMessageSafe(message): WAMessage | null {
    try {
      return this.toWAMessage(message);
    } catch (error) {
      this.logger.error('Failed to process incoming message');
      this.logger.error(error);
      return null;
    }
  }

  protected toWAMessage(message): WAMessage {
    const fromToParticipant = getFromToParticipant(message.key);
    const id = buildMessageId(message.key);
    const body = extractBody(message.message);
    const replyTo = this.extractReplyTo(message.message);
    const interactiveResponse = extractInteractiveResponse(message.message);
    const ack = message.ack || StatusToAck(message.status);
    const mediaContent = extractMediaContent(message.message);
    const source = this.getMessageSource(message.key.id);
    const waproto = message.message;
    return {
      id: id,
      timestamp: ensureNumber(message.messageTimestamp),
      from: toCusFormat(fromToParticipant.from),
      fromMe: message.key.fromMe,
      source: source,
      body: body || null,
      to: toCusFormat(fromToParticipant.to),
      participant: toCusFormat(fromToParticipant.participant),
      // Media
      hasMedia: Boolean(mediaContent),
      media: null,
      mediaUrl: message.media?.url,
      // @ts-ignore
      ack: ack,
      // @ts-ignore
      ackName: WAMessageAck[ack] || ACK_UNKNOWN,
      location: extractWALocation(waproto),
      vCards: extractVCards(waproto),
      replyTo: replyTo,
      interactiveResponse: interactiveResponse,
      _data: message,
    };
  }

  protected extractReplyTo(message): ReplyToMessage | null {
    const msgType = getContentType(message);
    const contextInfo = message[msgType]?.contextInfo;
    if (!contextInfo) {
      return null;
    }
    const quotedMessage = contextInfo.quotedMessage;
    if (!quotedMessage) {
      return null;
    }
    const body = extractBody(quotedMessage);
    return {
      id: contextInfo.stanzaId,
      participant: toCusFormat(contextInfo.participant),
      body: body,
      _data: quotedMessage,
    };
  }

  protected toWAContact(contact: Contact) {
    contact.id = toCusFormat(contact.id);
    // @ts-ignore
    contact.pushname = contact.notify;
    // @ts-ignore
    delete contact.notify;
    return contact;
  }

  protected convertMessageUpdateToMessageAck(event): WAMessageAckBody {
    const message = event;
    const fromToParticipant = getFromToParticipant(message.key);
    const id = buildMessageId(message.key);
    const ack = StatusToAck(message.update.status);
    const body: WAMessageAckBody = {
      id: id,
      from: toCusFormat(fromToParticipant.from),
      to: toCusFormat(fromToParticipant.to),
      participant: toCusFormat(fromToParticipant.participant),
      fromMe: message.key.fromMe,
      ack: ack,
      ackName: WAMessageAck[ack] || ACK_UNKNOWN,
    };
    return body;
  }

  protected convertMessageReceiptUpdateToMessageAck(event): WAMessageAckBody {
    const fromToParticipant = getFromToParticipant(event.key);

    const receipt = event.receipt;
    let ack;
    if (receipt.receiptTimestamp) {
      ack = WAMessageAck.SERVER;
    } else if (receipt.playedTimestamp) {
      ack = WAMessageAck.PLAYED;
    } else if (receipt.readTimestamp) {
      ack = WAMessageAck.READ;
    }

    const key = { ...event.key };
    if (key.fromMe) {
      key.participant = this.getSessionMeInfo()?.id;
    } else {
      key.participant = event.receipt.userJid;
    }
    const id = buildMessageId(key);

    const body: WAMessageAckBody = {
      id: id,
      from: toCusFormat(fromToParticipant.from),
      to: toCusFormat(fromToParticipant.to),
      participant: toCusFormat(fromToParticipant.participant),
      fromMe: event.key.fromMe,
      ack: ack,
      ackName: WAMessageAck[ack] || ACK_UNKNOWN,
      _data: event,
    };
    return body;
  }

  protected async handleMessagesUpdatePollVote(event) {
    const { key, update } = event;
    const pollUpdates = update?.pollUpdates;
    if (!pollUpdates) {
      return;
    }

    const pollCreationMessageKey = key;
    const pkey = { ...key };
    pkey.remoteJid = null; // try to find message creation by id only
    const pollCreationMessage = await this.getMessage(pkey);
    if (!pollCreationMessage) {
      this.logger.warn(
        { pollCreationMessageKey },
        'poll creation message not found, cannot aggregate votes',
      );
      return;
    }
    // Handle updates one by one, so we can get Vote Message for the specific vote
    for (const pollUpdate of pollUpdates) {
      const votes = getAggregateVotesInPollMessage({
        message: pollCreationMessage,
        pollUpdates: [pollUpdate],
      });

      // Get selected options for the author
      const selectedOptions = [];
      for (const voteAggregation of votes) {
        for (const voter of voteAggregation.voters) {
          if (voter === getKeyAuthor(pollUpdate.pollUpdateMessageKey)) {
            selectedOptions.push(voteAggregation.name);
          }
        }
      }

      // Build payload and call the handler
      const voteDestination = getDestination(pollUpdate.pollUpdateMessageKey);
      const pollVote: PollVote = {
        ...voteDestination,
        selectedOptions: selectedOptions,
        timestamp: ensureNumber(pollUpdate.senderTimestampMs),
      };
      const payload: PollVotePayload = {
        vote: pollVote,
        poll: getDestination(pollCreationMessageKey),
      };
      return payload;
    }
  }

  protected async handleMessageUpsertPollVoteFailed(message) {
    const pollUpdateMessage = message.message?.pollUpdateMessage;
    if (!pollUpdateMessage) {
      return;
    }
    const pollCreationMessageKey = pollUpdateMessage.pollCreationMessageKey;
    const pkey = { ...pollCreationMessageKey };
    pkey.remoteJid = null; // try to find message creation by id only
    const pollCreationMessage = await this.getMessage(pkey);
    if (pollCreationMessage) {
      // We found message, so later the engine will issue a message.update message
      return;
    }

    // We didn't find the creation message, so send failed one
    const pollUpdateMessageKey = message.key;
    const voteDestination = getDestination(pollUpdateMessageKey);
    const pollVote: PollVote = {
      ...voteDestination,
      selectedOptions: [],
      // change to below line when the PR merged, so we have the same timestamps
      // https://github.com/WhiskeySockets/Baileys/pull/348
      // Or without toNumber() - it depends on the PR above
      // timestamp: pollUpdateMessage.senderTimestampMs.toNumber()
      timestamp: ensureNumber(message.messageTimestamp),
    };
    const payload: PollVotePayload = {
      vote: pollVote,
      poll: getDestination(pollCreationMessageKey),
    };
    return payload;
  }

  private toCallData(call: WACallEvent): CallData {
    // call.date can be either string 2024-07-18T09:45:55.000Z or Date
    const date = new Date(call.date);
    // convert to timestamp in seconds
    const timestamp: number = date.getTime() / 1000;
    return {
      id: call.id,
      from: toCusFormat(call.from),
      timestamp: timestamp,
      isVideo: call.isVideo,
      isGroup: call.isGroup,
      _data: call,
    };
  }

  private toWahaPresences(
    remoteJid: string,
    storedPresences: { [participant: string]: PresenceData },
  ): WAHAChatPresences {
    const presences: WAHAPresenceData[] = [];
    for (const participant in storedPresences) {
      const data: PresenceData = storedPresences[participant];
      const lastKnownPresence = get(
        PresenceStatuses,
        data.lastKnownPresence,
        data.lastKnownPresence,
      );
      const presence: WAHAPresenceData = {
        participant: toCusFormat(participant),
        // @ts-ignore
        lastKnownPresence: lastKnownPresence,
        lastSeen: data.lastSeen || null,
      };
      presences.push(presence);
    }
    const chatId = toCusFormat(remoteJid);
    return { id: chatId, presences: presences };
  }

  protected async downloadMediaSafe(message): Promise<WAMedia | null> {
    try {
      return await this.downloadMedia(message);
    } catch (e) {
      this.logger.error('Failed when tried to download media for a message');
      this.logger.error(e, e.stack);
    }
    return null;
  }

  protected async downloadMedia(message): Promise<WAMedia | null> {
    const processor = new NOWEBEngineMediaProcessor(this, this.loggerBuilder);
    return this.mediaManager.processMedia(processor, message, this.name);
  }

  protected async getMessageOptions(request: {
    chatId: string;
    reply_to?: string;
  }) {
    const jid = toJID(request.chatId);

    let quoted;
    if (request.reply_to) {
      const key = parseMessageIdSerialized(request.reply_to, true);
      quoted = await this.store.loadMessage(jid, key.id);
    }
    const chat = await this.store.getChat(jid);
    const messageId = this.generateMessageID();
    return {
      quoted: quoted,
      ephemeralExpiration: chat?.ephemeralExpiration,
      messageId: messageId,
    };
  }

  protected getLinkPreview(request): any {
    // NOWEB works this way
    // If it's undefined - it'll generate it
    // If it's false - it will not generate it
    let linkPreview: boolean | undefined;
    switch (request.linkPreview) {
      case false:
        linkPreview = false;
        break;
      case true:
      default:
        linkPreview = undefined;
    }
    return linkPreview;
  }

  protected generateMessageID() {
    const id = generateMessageIDV2(this.sock.user?.id);
    this.saveSentMessageId(id);
    return id;
  }
}

function hasPath(url: string) {
  if (!url) {
    return false;
  }
  try {
    const urlObj = new URL(url);
    return urlObj.pathname !== '/';
  } catch (error) {
    return false;
  }
}

export class NOWEBEngineMediaProcessor implements IMediaEngineProcessor<any> {
  private readonly logger: ILogger;

  constructor(
    public session: WhatsappSessionNoWebCore,
    loggerBuilder: LoggerBuilder,
  ) {
    this.logger = loggerBuilder.child({
      name: NOWEBEngineMediaProcessor.name,
    }) as unknown as ILogger;
  }

  hasMedia(message: any): boolean {
    return Boolean(extractMediaContent(message.message));
  }

  getMessageId(message: any): string {
    return message.key.id;
  }

  getChatId(message: any): string {
    return toCusFormat(message.key.remoteJid);
  }

  getMimetype(message: any): string {
    const content = extractMediaContent(message.message);
    return content.mimetype;
  }

  async getMediaBuffer(message: any): Promise<Buffer | null> {
    const content = extractMediaContent(message.message);
    const url = content.url;
    // Fix Stickers
    // https://github.com/devlikeapro/waha/issues/504
    // Set it to null so the engine handles it right
    if (!hasPath(url)) {
      content.url = null;
    }
    // Fix Newsletter
    // directPath has the unencrypted path
    if (isJidNewsletter(message.key.remoteJid) && content.directPath) {
      content.url = null;
    }

    return (await downloadMediaMessage(
      message,
      'buffer',
      {},
      {
        logger: this.logger,
        reuploadRequest: this.session.sock.updateMediaMessage,
      },
    ).finally(() => {
      // Set url back in case we removed it
      content.url = url;
    })) as Buffer;
  }

  getFilename(message: any): string | null {
    const content = extractMessageContent(message.message);
    return content?.documentMessage?.fileName || null;
  }
}

export const ALL_JID = 'all@s.whatsapp.net';

/**
 * Build WAHA message id from engine one
 * {id: "AAA", remoteJid: "11111111111@s.whatsapp.net", "fromMe": false}
 * false_11111111111@c.us_AA
 */
export function buildMessageId({
  id,
  remoteJid,
  fromMe,
  participant,
}: WAMessageKey) {
  const chatId = toCusFormat(remoteJid);
  const parts = [fromMe || false, chatId, id];
  if (participant) {
    parts.push(toCusFormat(participant));
  }
  return parts.join('_');
}

function getId(object) {
  return object.id;
}

function isMine(message) {
  return message?.key?.fromMe;
}

function isNotMine(message) {
  return !message?.key?.fromMe;
}

function isAckUpdateMessageEvent(event) {
  return event?.update.status != null;
}

export function getFromToParticipant(key) {
  const isGroupMessage = Boolean(key.participant);
  let participant: string;
  let to: string;
  if (isGroupMessage) {
    participant = key.participant;
    to = key.remoteJid;
  }
  const from = key.remoteJid;
  return {
    from: from,
    to: to,
    participant: participant,
  };
}

function getTo(key, meId = undefined) {
  // For group - always to group JID
  const isGroupMessage = Boolean(key.participant);
  if (isGroupMessage) {
    return key.remoteJid;
  }
  if (key.fromMe) {
    return key.remoteJid;
  }
  return meId || 'me';
}

function getFrom(key, meId) {
  // For group - always from participant
  const isGroupMessage = Boolean(key.participant);
  if (isGroupMessage) {
    return key.participant;
  }
  if (key.fromMe) {
    return meId || 'me';
  }
  return key.remoteJid;
}

export function getDestination(key, meId = undefined): MessageDestination {
  return {
    id: buildMessageId(key),
    to: toCusFormat(getTo(key, meId)),
    from: toCusFormat(getFrom(key, meId)),
    fromMe: key.fromMe,
  };
}

export function extractBody(message): string | null {
  if (!message) {
    return null;
  }
  const content = extractMessageContent(message);
  if (!content) {
    return null;
  }
  let body = content.conversation || null;
  if (!body) {
    // Some of the messages have no conversation, but instead have text in extendedTextMessage
    // https://github.com/devlikeapro/waha/issues/90
    body = content.extendedTextMessage?.text;
  }
  if (!body) {
    // Populate from caption
    const mediaContent = extractMediaContent(content);
    // @ts-ignore - AudioMessage doesn't have caption field
    body = mediaContent?.caption;
  }
  // Interactive responses (buttons and list selections)
  // Uses extractInteractiveResponse() to avoid duplicating extraction logic
  if (!body) {
    const interactiveResponse = extractInteractiveResponse(message);
    if (interactiveResponse) {
      body = formatInteractiveResponseBody(interactiveResponse);
    }
  }

  // List message (outgoing list, not a response)
  if (!body) {
    const type = getContentType(content);
    if (type == 'listMessage') {
      const list = content.listMessage;
      const parts = [list.title, list.description, list.footerText];
      body = parts.filter(Boolean).join('\n');
    }
  }

  return body;
}

/**
 * Format an InteractiveResponse into a body string with concatenated format.
 *
 * Format: "DisplayText [selectedId]" or just "DisplayText" if no ID
 *
 * @param response - The interactive response to format
 * @returns Formatted body string, or null if no content
 */
export function formatInteractiveResponseBody(
  response: InteractiveResponse | null,
): string | null {
  if (!response) {
    return null;
  }

  const displayText = response.selectedText || '';
  const selectedId = response.selectedId || '';

  if (selectedId) {
    // Concatenated format: "DisplayText [selectedId]"
    // Handle edge case where displayText is empty
    return displayText ? `${displayText} [${selectedId}]` : `[${selectedId}]`;
  }

  // No ID, just return display text (or null if empty)
  return displayText || null;
}

/**
 * Extract interactive response data from message content.
 *
 * Handles:
 * - Native flow button responses (interactiveResponseMessage.nativeFlowResponseMessage)
 * - Legacy button responses (buttonsResponseMessage)
 * - Template button responses (templateButtonReplyMessage)
 * - List responses (listResponseMessage)
 *
 * @param message - WhatsApp message proto content
 * @returns InteractiveResponse object or null if not an interactive response
 */
export function extractInteractiveResponse(
  message: any,
): InteractiveResponse | null {
  if (!message) {
    return null;
  }

  const content = extractMessageContent(message);
  if (!content) {
    return null;
  }

  // Handle native flow response (modern button format)
  const nativeFlowResponse =
    content.interactiveResponseMessage?.nativeFlowResponseMessage;
  if (nativeFlowResponse) {
    let params: Record<string, any> = {};
    try {
      params = JSON.parse(nativeFlowResponse.paramsJson || '{}');
    } catch (e) {
      // paramsJson parsing failed - continue with empty params
    }

    return {
      type: InteractiveResponseType.NATIVE_FLOW,
      selectedId: params.id,
      selectedText:
        params.display_text || content.interactiveResponseMessage?.body?.text,
      name: nativeFlowResponse.name,
      params: params,
    };
  }

  // Handle legacy buttons response
  const buttonsResponse = content.buttonsResponseMessage;
  if (buttonsResponse) {
    return {
      type: InteractiveResponseType.BUTTON,
      selectedId: buttonsResponse.selectedButtonId,
      selectedText: buttonsResponse.selectedDisplayText,
      params: {
        id: buttonsResponse.selectedButtonId,
        display_text: buttonsResponse.selectedDisplayText,
      },
    };
  }

  // Handle template button response (older format)
  const templateButtonResponse = content.templateButtonReplyMessage;
  if (templateButtonResponse) {
    return {
      type: InteractiveResponseType.BUTTON,
      selectedId: templateButtonResponse.selectedId,
      selectedText: templateButtonResponse.selectedDisplayText,
      params: {
        id: templateButtonResponse.selectedId,
        display_text: templateButtonResponse.selectedDisplayText,
      },
    };
  }

  // Handle list response
  const listResponse = content.listResponseMessage;
  if (listResponse?.singleSelectReply) {
    return {
      type: InteractiveResponseType.LIST,
      selectedId: listResponse.singleSelectReply.selectedRowId,
      // Note: singleSelectReply only contains selectedRowId, not the row's display text.
      // The original row title would need to be looked up from the sent list message.
      selectedText: undefined,
      name: 'single_select',
      params: {
        id: listResponse.singleSelectReply.selectedRowId,
      },
    };
  }

  return null;
}
