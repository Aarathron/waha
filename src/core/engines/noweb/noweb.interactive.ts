/**
 * Interactive Messages Module
 *
 * Implements WhatsApp interactive messages (buttons, lists) using binary node injection.
 * This is required because Meta deprecated interactive messages for unofficial APIs in May 2023.
 *
 * ## Platform Compatibility
 *
 * | Feature | Android | iOS | Notes |
 * |---------|---------|-----|-------|
 * | Buttons (quick_reply) | ✅ | ✅ | All button types work |
 * | Lists (single_select) | ✅ | ❌ | iOS filters out list messages |
 * | URL/Call/Copy buttons | ✅ | ✅ | Full support on both platforms |
 *
 * ## Binary Node Injection (The Key to Making This Work)
 *
 * WhatsApp's XMPP protocol requires specific binary XML nodes in the message stanza
 * for interactive messages to be accepted. Without these nodes, messages:
 * - Stay in PENDING status forever
 * - Never render on recipient's device
 * - Eventually timeout or fail silently
 *
 * Required nodes:
 * - `<biz>` - Business message container (always required)
 * - `<interactive>` - Interactive type declaration
 * - `<native_flow>` - Button/flow container with version info
 * - `<bot>` - Bot marker (required for 1:1 chats, OMIT for groups)
 *
 * ## Wrapper Types (Protobuf Encoding)
 *
 * The interactive message protobuf must be wrapped to bypass server filters:
 * - `viewOnceMessageV2` - **Recommended**, most reliable currently
 * - `viewOnceMessage` - Legacy view-once wrapper
 * - `viewOnceMessageV2Extension` - Extended view-once
 * - `botInvokeMessage` - Bot invocation wrapper
 * - `direct` - No wrapper (least reliable, often blocked)
 *
 * ## Node Approaches (Binary Node Structures)
 *
 * Multiple binary node structures exist because Meta frequently patches these:
 * - **Approach 4** - Recommended (BaileysHelper nested structure)
 * - Approaches 1-3, 5-11 - Experimental/debugging variants
 *
 * ## Configuration
 *
 * Set via environment variable:
 * - `WAHA_INTERACTIVE_WRAPPER` - Wrapper type (default: viewOnceMessageV2)
 *
 * @warning This uses unofficial WhatsApp API. Meta actively patches these.
 *          Messages may stop working at any time. For production reliability,
 *          consider the official WhatsApp Cloud API.
 *
 * @see https://github.com/terastudio-org/BaileysHelper - Binary node reference
 * @see https://github.com/WhiskeySockets/Baileys/issues/56 - Deprecation discussion
 * @see https://dev.to/purpshell/buttons-and-lists-get-deprecated-by-many-libraries-54h
 */

import { WAHA_INTERACTIVE_WRAPPER } from '@waha/core/env';
import esm from '@waha/vendor/esm';

/**
 * Binary XML node structure for XMPP protocol injection.
 * WhatsApp uses a binary-encoded XML format for message stanzas.
 */
interface BinaryNode {
  /** XML tag name (e.g., 'biz', 'interactive', 'native_flow', 'bot') */
  tag: string;
  /** Tag attributes as key-value pairs */
  attrs: Record<string, string>;
  /** Node content: child nodes, text string, or binary data */
  content?: BinaryNode[] | string | Uint8Array;
}

/**
 * Wrapper types for interactive message protobuf encoding.
 *
 * WhatsApp's server-side filters block raw interactive messages.
 * Wrapping the message in specific protobuf containers bypasses these filters.
 *
 * @remarks The most reliable wrapper changes over time as Meta patches their servers.
 *          Currently `VIEW_ONCE_V2` is recommended.
 */
export enum InteractiveWrapperType {
  /** Legacy view-once wrapper (protobuf field 37) */
  VIEW_ONCE = 'viewOnceMessage',
  /** Newer view-once wrapper (protobuf field 55) - **RECOMMENDED** */
  VIEW_ONCE_V2 = 'viewOnceMessageV2',
  /** Extended view-once wrapper (protobuf field 59) */
  VIEW_ONCE_V2_EXT = 'viewOnceMessageV2Extension',
  /** Bot invocation wrapper (protobuf field 67) */
  BOT_INVOKE = 'botInvokeMessage',
  /** No wrapper - direct interactiveMessage (least reliable) */
  DIRECT = 'direct',
}

/**
 * Parse string value to InteractiveWrapperType enum.
 * Used for environment variable configuration.
 */
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
      // Unknown wrapper type - fall back to recommended wrapper
      return InteractiveWrapperType.VIEW_ONCE_V2;
  }
}

// Initialize wrapper from environment variable
let currentWrapper: InteractiveWrapperType = parseWrapperType(WAHA_INTERACTIVE_WRAPPER);

/**
 * Set the interactive message wrapper type at runtime.
 *
 * @param wrapper - The wrapper type to use for subsequent messages
 *
 * @example
 * setInteractiveWrapper(InteractiveWrapperType.VIEW_ONCE_V2);
 */
export function setInteractiveWrapper(wrapper: InteractiveWrapperType): void {
  currentWrapper = wrapper;
}

/**
 * Get the currently configured wrapper type.
 *
 * @returns The current InteractiveWrapperType
 */
export function getCurrentWrapper(): InteractiveWrapperType {
  return currentWrapper;
}

/**
 * Generate a random ID for interactive message templates.
 * Used as templateId in messageParamsJson.
 *
 * @returns A random 16-digit numeric string
 */
export function randomId(): string {
  return Math.random().toString().slice(2, 18);
}

/**
 * Interactive message content structure.
 *
 * This matches WhatsApp's interactiveMessage protobuf schema.
 * The nativeFlowMessage contains the actual button/list definitions.
 */
interface InteractiveMessageContent {
  /** Optional header with title and/or image */
  header?: {
    title?: string;
    hasMediaAttachment?: boolean;
    imageMessage?: any;
  };
  /** Main message body text */
  body?: {
    text: string;
  };
  /** Optional footer text (displayed smaller) */
  footer?: {
    text: string;
  };
  /** Native flow message containing buttons or list definitions */
  nativeFlowMessage: {
    /** Array of button definitions */
    buttons: Array<{
      /** Button type: 'quick_reply', 'cta_url', 'cta_call', 'cta_copy', 'single_select' */
      name: string;
      /** JSON-encoded button parameters */
      buttonParamsJson: string;
    }>;
    /** JSON-encoded message parameters (includes templateId) */
    messageParamsJson: string;
    /** Message version (typically 1) */
    messageVersion?: number;
  };
}

/**
 * Build message context info required for WhatsApp messages.
 * This metadata is required for proper message delivery.
 */
function buildMessageContextInfo(): Record<string, any> {
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
 * Structure attempts based on baileys_helpers:
 * - Approach 1: biz with nested native_flow + bot node
 * - Approach 2: separate biz, native_flow, bot nodes
 * - Approach 3: biz with interactive child
 * - Approach 4: BaileysHelper style - full nested structure with version attrs
 * - Approach 5: BaileysHelper with content as Uint8Array (empty)
 *
 * @see https://libraries.io/npm/baileys_helpers - Documents this approach
 * @see https://github.com/terastudio-org/BaileysHelper - Reference implementation
 */
function buildAdditionalNodes(chatId: string, approach: number = 1): BinaryNode[] {
  const isGroup = chatId.endsWith('@g.us');

  switch (approach) {
    case 1:
      // Approach 1: biz with nested native_flow content
      const nodes1: BinaryNode[] = [
        {
          tag: 'biz',
          attrs: {},
          content: [
            { tag: 'native_flow', attrs: {}, content: undefined }
          ],
        },
      ];
      if (!isGroup) {
        nodes1.push({ tag: 'bot', attrs: { biz_bot: '1' }, content: undefined });
      }
      return nodes1;

    case 2:
      // Approach 2: separate biz + native_flow + bot
      const nodes2: BinaryNode[] = [
        { tag: 'biz', attrs: {}, content: undefined },
        { tag: 'native_flow', attrs: {}, content: undefined },
      ];
      if (!isGroup) {
        nodes2.push({ tag: 'bot', attrs: { biz_bot: '1' }, content: undefined });
      }
      return nodes2;

    case 3:
      // Approach 3: biz with interactive child
      const nodes3: BinaryNode[] = [
        {
          tag: 'biz',
          attrs: {},
          content: [
            { tag: 'interactive', attrs: { type: 'native_flow' }, content: undefined }
          ],
        },
      ];
      if (!isGroup) {
        nodes3.push({ tag: 'bot', attrs: { biz_bot: '1' }, content: undefined });
      }
      return nodes3;

    case 4:
      // Approach 4: BaileysHelper style - full nested structure with version attributes
      // This matches the structure from https://github.com/terastudio-org/BaileysHelper
      const nodes4: BinaryNode[] = [
        {
          tag: 'biz',
          attrs: {},
          content: [
            {
              tag: 'interactive',
              attrs: { type: 'native_flow', v: '1' },
              content: [
                {
                  tag: 'native_flow',
                  attrs: { v: '9', name: 'mixed' },
                  content: undefined,
                }
              ],
            }
          ],
        },
      ];
      if (!isGroup) {
        nodes4.push({ tag: 'bot', attrs: { biz_bot: '1' }, content: undefined });
      }
      return nodes4;

    case 5:
      // Approach 5: BaileysHelper with empty Uint8Array content (some implementations use this)
      const nodes5: BinaryNode[] = [
        {
          tag: 'biz',
          attrs: {},
          content: [
            {
              tag: 'interactive',
              attrs: { type: 'native_flow', v: '1' },
              content: [
                {
                  tag: 'native_flow',
                  attrs: { v: '9', name: 'mixed' },
                  content: new Uint8Array(0),
                }
              ],
            }
          ],
        },
      ];
      if (!isGroup) {
        nodes5.push({ tag: 'bot', attrs: { biz_bot: '1' }, content: undefined });
      }
      return nodes5;

    case 6:
      // Approach 6: Minimal - just interactive with version
      const nodes6: BinaryNode[] = [
        {
          tag: 'biz',
          attrs: {},
          content: [
            {
              tag: 'interactive',
              attrs: { v: '1' },
              content: undefined,
            }
          ],
        },
      ];
      if (!isGroup) {
        nodes6.push({ tag: 'bot', attrs: { biz_bot: '1' }, content: undefined });
      }
      return nodes6;

    case 7:
      // Approach 7: For list messages (single_select) - use name: 'single_select'
      const nodes7: BinaryNode[] = [
        {
          tag: 'biz',
          attrs: {},
          content: [
            {
              tag: 'interactive',
              attrs: { type: 'native_flow', v: '1' },
              content: [
                {
                  tag: 'native_flow',
                  attrs: { v: '9', name: 'single_select' },
                  content: undefined,
                }
              ],
            }
          ],
        },
      ];
      if (!isGroup) {
        nodes7.push({ tag: 'bot', attrs: { biz_bot: '1' }, content: undefined });
      }
      return nodes7;

    case 8:
      // Approach 8: List with type: 'list' - OLD approach
      const nodes8: BinaryNode[] = [
        {
          tag: 'biz',
          attrs: {},
          content: [
            {
              tag: 'interactive',
              attrs: { type: 'list', v: '1' },
              content: undefined,
            }
          ],
        },
      ];
      if (!isGroup) {
        nodes8.push({ tag: 'bot', attrs: { biz_bot: '1' }, content: undefined });
      }
      return nodes8;

    case 9:
      // Approach 9: BaileysHelper list structure - tag: 'list' with v: '2', type: 'product_list'
      // This is the correct structure for single_select (list) messages
      const nodes9: BinaryNode[] = [
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
        nodes9.push({ tag: 'bot', attrs: { biz_bot: '1' }, content: undefined });
      }
      return nodes9;

    case 10:
      // Approach 10: List with just 'list' tag (no nested in biz)
      const nodes10: BinaryNode[] = [
        { tag: 'biz', attrs: {}, content: undefined },
        { tag: 'list', attrs: { v: '2', type: 'product_list' }, content: undefined },
      ];
      if (!isGroup) {
        nodes10.push({ tag: 'bot', attrs: { biz_bot: '1' }, content: undefined });
      }
      return nodes10;

    case 11:
      // Approach 11: List with type: 'single_select'
      const nodes11: BinaryNode[] = [
        {
          tag: 'biz',
          attrs: {},
          content: [
            {
              tag: 'list',
              attrs: { v: '2', type: 'single_select' },
              content: undefined,
            }
          ],
        },
      ];
      if (!isGroup) {
        nodes11.push({ tag: 'bot', attrs: { biz_bot: '1' }, content: undefined });
      }
      return nodes11;

    default:
      // Original approach: just biz + bot
      const nodes0: BinaryNode[] = [
        { tag: 'biz', attrs: {}, content: undefined },
      ];
      if (!isGroup) {
        nodes0.push({ tag: 'bot', attrs: { biz_bot: '1' }, content: undefined });
      }
      return nodes0;
  }
}

/**
 * Send an interactive message (buttons or list) using binary node injection.
 *
 * This function handles the complete flow:
 * 1. Wraps the interactive content in the appropriate protobuf wrapper
 * 2. Generates the WhatsApp message structure
 * 3. Injects required binary nodes for server acceptance
 * 4. Relays the message through the socket
 *
 * @param sock - Baileys socket instance (WASocket)
 * @param chatId - Recipient JID (xxx@c.us for contacts, xxx@g.us for groups)
 * @param interactiveContent - The interactive message content (buttons/list)
 * @param wrapperType - Optional wrapper type override (defaults to current global setting)
 * @param nodeApproach - Binary node structure approach (defaults to 4 - recommended)
 *
 * @returns The full message object with key.id for tracking
 *
 * @example
 * // Send a simple button message
 * const buttons = [
 *   { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Yes', id: 'yes' }) },
 *   { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'No', id: 'no' }) },
 * ];
 *
 * const result = await sendInteractiveMessage(sock, '1234567890@c.us', {
 *   body: { text: 'Do you agree?' },
 *   nativeFlowMessage: {
 *     buttons,
 *     messageParamsJson: JSON.stringify({ from: 'api', templateId: randomId() }),
 *     messageVersion: 1,
 *   },
 * });
 *
 * console.log('Message ID:', result.key.id);
 *
 * @warning Uses unofficial WhatsApp API. May stop working if Meta patches their servers.
 */
export async function sendInteractiveMessage(
  sock: any,
  chatId: string,
  interactiveContent: InteractiveMessageContent,
  wrapperType?: InteractiveWrapperType,
  nodeApproach?: number,
): Promise<any> {
  const wrapper = wrapperType || currentWrapper;
  // Default to approach 4 (BaileysHelper style) - proven to work
  const approach = nodeApproach ?? 4;
  const isGroup = chatId.endsWith('@g.us');

  const data = wrapInteractiveMessage(interactiveContent, wrapper);

  const msg = esm.b.proto.Message.create(data);
  const fullMessage = esm.b.generateWAMessageFromContent(chatId, msg, {
    userJid: sock?.user?.id,
  });

  // Binary node injection - the key to making interactive messages work
  // Without these nodes, WhatsApp servers reject/ignore the interactive content
  const additionalNodes = buildAdditionalNodes(chatId, approach);

  await sock.relayMessage(chatId, fullMessage.message, {
    messageId: fullMessage.key.id,
    additionalNodes,
  });

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
      const result = await sendInteractiveMessage(
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
