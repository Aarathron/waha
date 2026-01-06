/**
 * EXPERIMENTAL: Multiple wrapper implementations for interactive messages
 *
 * This module provides different wrapper approaches for buttons and lists
 * to test which one works with Meta's current server-side validation.
 *
 * Available wrapper types:
 * - viewOnceMessage (original, field 37)
 * - viewOnceMessageV2 (newer, field 55)
 * - viewOnceMessageV2Extension (newest, field 59)
 * - botInvokeMessage (bot-specific, field 67)
 * - direct (no wrapper, just interactiveMessage)
 *
 * Configure via environment variable: WAHA_INTERACTIVE_WRAPPER
 */

import { WAHA_INTERACTIVE_WRAPPER } from '@waha/core/env';
import esm from '@waha/vendor/esm';

// BinaryNode type for additionalNodes injection
interface BinaryNode {
  tag: string;
  attrs: Record<string, string>;
  content?: BinaryNode[] | string | Uint8Array;
}

export enum InteractiveWrapperType {
  VIEW_ONCE = 'viewOnceMessage',
  VIEW_ONCE_V2 = 'viewOnceMessageV2',
  VIEW_ONCE_V2_EXT = 'viewOnceMessageV2Extension',
  BOT_INVOKE = 'botInvokeMessage',
  DIRECT = 'direct',
}

// Map string values to enum
function parseWrapperType(value: string): InteractiveWrapperType {
  switch (value) {
    case 'viewOnceMessage':
      return InteractiveWrapperType.VIEW_ONCE;
    case 'viewOnceMessageV2':
      return InteractiveWrapperType.VIEW_ONCE_V2;
    case 'viewOnceMessageV2Extension':
      return InteractiveWrapperType.VIEW_ONCE_V2_EXT;
    case 'botInvokeMessage':
      return InteractiveWrapperType.BOT_INVOKE;
    case 'direct':
      return InteractiveWrapperType.DIRECT;
    default:
      console.warn(
        `[EXPERIMENTAL] Unknown wrapper type: ${value}, defaulting to viewOnceMessageV2`,
      );
      return InteractiveWrapperType.VIEW_ONCE_V2;
  }
}

// Initialize from environment variable
let currentWrapper: InteractiveWrapperType = parseWrapperType(WAHA_INTERACTIVE_WRAPPER);
console.log(`[EXPERIMENTAL] Interactive wrapper initialized to: ${currentWrapper}`);

export function setInteractiveWrapper(wrapper: InteractiveWrapperType) {
  console.log(`[EXPERIMENTAL] Switching interactive wrapper to: ${wrapper}`);
  currentWrapper = wrapper;
}

export function getCurrentWrapper(): InteractiveWrapperType {
  return currentWrapper;
}

export function randomId() {
  return Math.random().toString().slice(2, 18);
}

interface InteractiveMessageContent {
  header?: {
    title?: string;
    hasMediaAttachment?: boolean;
    imageMessage?: any;
  };
  body?: {
    text: string;
  };
  footer?: {
    text: string;
  };
  nativeFlowMessage: {
    buttons: Array<{
      name: string;
      buttonParamsJson: string;
    }>;
    messageParamsJson: string;
    messageVersion?: number;
  };
}

function buildMessageContextInfo() {
  return {
    deviceListMetadata: {},
    deviceListMetadataVersion: 2,
  };
}

/**
 * Wrap the interactive message content with the specified wrapper type
 */
function wrapInteractiveMessage(
  interactiveContent: InteractiveMessageContent,
  wrapperType: InteractiveWrapperType,
): any {
  const innerMessage = {
    messageContextInfo: buildMessageContextInfo(),
    interactiveMessage: interactiveContent,
  };

  switch (wrapperType) {
    case InteractiveWrapperType.DIRECT:
      // No wrapper - just the message content with interactiveMessage at top level
      return {
        messageContextInfo: buildMessageContextInfo(),
        interactiveMessage: interactiveContent,
      };

    case InteractiveWrapperType.VIEW_ONCE:
      return {
        viewOnceMessage: {
          message: innerMessage,
        },
      };

    case InteractiveWrapperType.VIEW_ONCE_V2:
      return {
        viewOnceMessageV2: {
          message: innerMessage,
        },
      };

    case InteractiveWrapperType.VIEW_ONCE_V2_EXT:
      return {
        viewOnceMessageV2Extension: {
          message: innerMessage,
        },
      };

    case InteractiveWrapperType.BOT_INVOKE:
      return {
        botInvokeMessage: {
          message: innerMessage,
        },
      };

    default:
      // Default to viewOnceMessageV2
      return {
        viewOnceMessageV2: {
          message: innerMessage,
        },
      };
  }
}

/**
 * Build binary nodes required for interactive messages.
 *
 * WhatsApp expects specific binary node wrappers (biz, bot, native_flow, interactive)
 * for interactive messages. Without these, messages stay PENDING and never render.
 *
 * - Private chats need: 'biz' + 'bot' nodes
 * - Group chats need: 'biz' node only
 *
 * @see https://libraries.io/npm/baileys_helpers - Documents this approach
 */
function buildAdditionalNodes(chatId: string): BinaryNode[] {
  const isGroup = chatId.endsWith('@g.us');

  const nodes: BinaryNode[] = [
    { tag: 'biz', attrs: {}, content: undefined },
  ];

  // Private chats need the bot node for interactive flows
  if (!isGroup) {
    nodes.push({
      tag: 'bot',
      attrs: { biz_bot: '1' },
      content: undefined,
    });
  }

  return nodes;
}

export async function sendInteractiveMessageExperimental(
  sock: any,
  chatId: string,
  interactiveContent: InteractiveMessageContent,
  wrapperType?: InteractiveWrapperType,
) {
  const wrapper = wrapperType || currentWrapper;
  const isGroup = chatId.endsWith('@g.us');
  console.log(`[EXPERIMENTAL] Sending interactive message with wrapper: ${wrapper}, isGroup: ${isGroup}`);

  const data = wrapInteractiveMessage(interactiveContent, wrapper);

  const msg = esm.b.proto.Message.create(data);
  const fullMessage = esm.b.generateWAMessageFromContent(chatId, msg, {
    userJid: sock?.user?.id,
  });

  // Binary node injection - the key to making interactive messages work
  // Without these nodes, WhatsApp servers reject/ignore the interactive content
  const additionalNodes = buildAdditionalNodes(chatId);
  console.log(`[EXPERIMENTAL] Injecting binary nodes: ${additionalNodes.map(n => n.tag).join(', ')}`);

  await sock.relayMessage(chatId, fullMessage.message, {
    messageId: fullMessage.key.id,
    additionalNodes,
  });

  console.log(`[EXPERIMENTAL] Message sent with ID: ${fullMessage.key.id}`);
  return fullMessage;
}

/**
 * Test all wrapper types and return results
 * Useful for finding which wrapper works
 */
export async function testAllWrappers(
  sock: any,
  chatId: string,
  interactiveContent: InteractiveMessageContent,
): Promise<Map<InteractiveWrapperType, { success: boolean; messageId?: string; error?: string }>> {
  const results = new Map<
    InteractiveWrapperType,
    { success: boolean; messageId?: string; error?: string }
  >();

  const wrappers = Object.values(InteractiveWrapperType);

  for (const wrapper of wrappers) {
    try {
      console.log(`[EXPERIMENTAL] Testing wrapper: ${wrapper}`);
      const result = await sendInteractiveMessageExperimental(
        sock,
        chatId,
        interactiveContent,
        wrapper,
      );
      results.set(wrapper, {
        success: true,
        messageId: result.key.id,
      });

      // Small delay between tests
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      results.set(wrapper, {
        success: false,
        error: error.message,
      });
    }
  }

  return results;
}
