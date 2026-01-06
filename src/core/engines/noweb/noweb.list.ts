/**
 * List Messages Module
 *
 * Implements WhatsApp list (single_select) messages with iOS fallback support.
 *
 * ## Platform Compatibility
 *
 * | Feature | Android | iOS | Notes |
 * |---------|---------|-----|-------|
 * | List messages | ✅ | ❌ | iOS filters single_select messages |
 * | Fallback buttons | ✅ | ✅ | Used when list is undelivered |
 *
 * ## iOS Fallback Mechanism
 *
 * Since iOS filters out list messages, this module provides automatic fallback:
 * 1. Send list message normally
 * 2. Monitor ACK status via RxJS observable
 * 3. If message stays PENDING for timeout period → trigger fallback
 * 4. Convert list rows to reply buttons (max 3)
 * 5. Send button message as fallback
 *
 * ## Usage
 *
 * ```typescript
 * const result = await sendListMessage(
 *   sock,
 *   chatId,
 *   'Menu',
 *   'Choose an option',
 *   'Select',
 *   'Footer',
 *   sections,
 *   4, // nodeApproach
 *   { enabled: true, timeoutMs: 30000, maxButtons: 3 }, // iOS fallback
 *   messageUpdates$, // RxJS observable for ACK monitoring
 * );
 *
 * if (result.iosFallback?.fallbackTriggered) {
 *   console.log('Fallback sent:', result.iosFallback.fallbackMessageId);
 * }
 * ```
 *
 * @warning List messages use unofficial WhatsApp API. Meta may block these.
 * @see https://github.com/WhiskeySockets/Baileys/issues/56
 */
import { Observable } from 'rxjs';

import { Section } from '@waha/structures/chatting.list.dto';
import esm from '@waha/vendor/esm';

import { sendButtonMessage } from './noweb.buttons';
import { randomId, sendInteractiveMessage } from './noweb.interactive';
import {
  convertListToButtons,
  DEFAULT_FALLBACK_CONFIG,
  ListFallbackConfig,
  ListFallbackResult,
  monitorAndFallback,
} from './noweb.list.fallback';

const LIST_DEPRECATION_WARNING = `
[WAHA WARNING] List messages may not work reliably.
Meta/WhatsApp deprecated interactive messages (lists, buttons) for unofficial APIs in May 2023.
For reliable interactive messages, use the official WhatsApp Cloud API.
See: https://github.com/WhiskeySockets/Baileys/issues/56
`;

let listWarningShown = false;

// BinaryNode type for additionalNodes injection
interface BinaryNode {
  tag: string;
  attrs: Record<string, string>;
  content?: BinaryNode[] | string | Uint8Array;
}

function sectionToProto(section: Section) {
  return {
    title: section.title,
    rows: section.rows.map((row) => ({
      title: row.title,
      description: row.description || '',
      id: row.rowId, // WhatsApp uses 'id', WAHA DTO uses 'rowId'
    })),
  };
}

// Convert section to listMessage format
function sectionToListMessage(section: Section) {
  return {
    title: section.title,
    rows: section.rows.map((row) => ({
      title: row.title,
      description: row.description || '',
      rowId: row.rowId,
    })),
  };
}

/**
 * Send list message using the native listMessage protobuf type
 * This is an alternative to using interactiveMessage.nativeFlowMessage
 */
async function sendNativeListMessage(
  sock: any,
  chatId: string,
  title: string,
  description: string | undefined,
  buttonText: string,
  footerText: string | undefined,
  sections: Section[],
) {
  console.log('[LIST] Sending native listMessage');

  const isGroup = chatId.endsWith('@g.us');

  // Build the listMessage protobuf structure
  const listMessage = {
    title: title,
    description: description || '',
    buttonText: buttonText,
    footerText: footerText || '',
    listType: 1, // SINGLE_SELECT
    sections: sections.map(sectionToListMessage),
  };

  const messageContent = {
    listMessage: listMessage,
  };

  const msg = esm.b.proto.Message.create(messageContent);
  const fullMessage = esm.b.generateWAMessageFromContent(chatId, msg, {
    userJid: sock?.user?.id,
  });

  // Build binary nodes for list messages
  const additionalNodes: BinaryNode[] = [
    {
      tag: 'biz',
      attrs: {},
      content: [
        {
          tag: 'list',
          attrs: { v: '2', type: 'product_list' },
          content: undefined,
        }
      ],
    },
  ];
  if (!isGroup) {
    additionalNodes.push({ tag: 'bot', attrs: { biz_bot: '1' }, content: undefined });
  }

  console.log('[LIST] Injecting binary nodes:', additionalNodes.map(n => n.tag).join(', '));

  await sock.relayMessage(chatId, fullMessage.message, {
    messageId: fullMessage.key.id,
    additionalNodes,
  });

  console.log('[LIST] Message sent with ID:', fullMessage.key.id);
  return fullMessage;
}

/**
 * Result type for list messages with fallback support.
 */
export interface ListMessageResult {
  /** The original list message */
  key: { id: string; remoteJid: string; fromMe: boolean };
  message: any;
  status: string;
  /** iOS fallback information (if fallback config was enabled) */
  iosFallback?: ListFallbackResult;
}

/**
 * Send a list message with optional iOS fallback.
 *
 * @param sock - Baileys socket instance
 * @param chatId - Recipient JID (xxx@c.us or xxx@g.us)
 * @param title - Header title for the list
 * @param description - Description text (shown as body)
 * @param buttonText - Text on the button that opens the list picker
 * @param footerText - Optional footer text
 * @param sections - Array of list sections containing rows
 * @param nodeApproach - Binary node structure approach (default: 4)
 * @param fallbackConfig - iOS fallback configuration
 * @param messageUpdates$ - RxJS observable for ACK monitoring (required for fallback)
 * @param logger - Optional logger for debugging
 *
 * @returns Message result with optional fallback information
 *
 * @example
 * // Without fallback
 * const result = await sendListMessage(sock, chatId, 'Menu', 'Choose', 'Select', null, sections);
 *
 * @example
 * // With iOS fallback
 * const result = await sendListMessage(
 *   sock, chatId, 'Menu', 'Choose', 'Select', null, sections,
 *   4,
 *   { enabled: true, timeoutMs: 30000, maxButtons: 3 },
 *   messageUpdates$,
 * );
 *
 * @warning Lists do NOT work on iOS. Use fallback for iOS compatibility.
 */
export async function sendListMessage(
  sock: any,
  chatId: string,
  title: string,
  description: string | undefined,
  buttonText: string,
  footerText: string | undefined,
  sections: Section[],
  nodeApproach?: number,
  fallbackConfig?: ListFallbackConfig,
  messageUpdates$?: Observable<any>,
  logger?: any,
): Promise<ListMessageResult> {
  // Show deprecation warning once per process
  if (!listWarningShown) {
    console.warn(LIST_DEPRECATION_WARNING);
    listWarningShown = true;
  }

  let listMessage: any;

  // Approach 12: Use native listMessage protobuf type
  if (nodeApproach === 12) {
    listMessage = await sendNativeListMessage(sock, chatId, title, description, buttonText, footerText, sections);
  } else {
    // Default: Use interactiveMessage.nativeFlowMessage with single_select
    const interactiveContent: any = {
      nativeFlowMessage: {
        buttons: [
          {
            name: 'single_select',
            buttonParamsJson: JSON.stringify({
              title: buttonText,
              sections: sections.map(sectionToProto),
            }),
          },
        ],
        messageParamsJson: JSON.stringify({
          from: 'api',
          templateId: randomId(),
        }),
        messageVersion: 1,
      },
    };

    if (title) {
      interactiveContent.header = {
        title: title,
        hasMediaAttachment: false,
      };
    }
    if (description) {
      interactiveContent.body = {
        text: description,
      };
    }
    if (footerText) {
      interactiveContent.footer = {
        text: footerText,
      };
    }

    // Default to approach 4 (same as buttons - proven to work)
    listMessage = await sendInteractiveMessage(sock, chatId, interactiveContent, undefined, nodeApproach ?? 4);
  }

  // Merge fallback config with defaults
  const config = {
    ...DEFAULT_FALLBACK_CONFIG,
    ...fallbackConfig,
  };

  // If fallback is enabled, check prerequisites
  if (config.enabled) {
    if (!messageUpdates$) {
      // Observable not available - warn and skip fallback
      console.warn('[LIST] iOS fallback enabled but messageUpdates$ observable not available. Fallback will not work.');
      logger?.warn('iOS fallback enabled but messageUpdates$ observable not available');
    } else {
      console.log(`[LIST] iOS fallback enabled, monitoring ACK for ${config.timeoutMs}ms`);

      // Create fallback function that sends buttons
      const sendFallbackButtons = async () => {
        const conversion = convertListToButtons(sections, description, config.maxButtons);

        // Guard: Don't send empty buttons array
        if (conversion.buttons.length === 0) {
          console.warn('[LIST] Cannot send fallback - no buttons generated from list rows');
          logger?.warn('Cannot send fallback - list has no rows to convert to buttons');
          throw new Error('No buttons to send - list has no rows');
        }

        console.log(`[LIST] Sending fallback buttons (${conversion.buttons.length} buttons, truncated: ${conversion.truncated})`);

        return await sendButtonMessage(
          sock,
          chatId,
          conversion.buttons,
          title,
          undefined,
          conversion.body,
          footerText,
        );
      };

      // Monitor and potentially fallback
      const fallbackResult = await monitorAndFallback(
        listMessage.key.id,
        config.timeoutMs,
        sendFallbackButtons,
        messageUpdates$,
        logger,
      );

      return {
        ...listMessage,
        iosFallback: fallbackResult,
      };
    }
  }

  // No fallback configured or prerequisites not met - return original message
  return {
    ...listMessage,
    iosFallback: {
      originalMessageId: listMessage.key.id,
      fallbackTriggered: false,
      reason: 'delivered', // No monitoring was done, assuming delivered
    },
  };
}
