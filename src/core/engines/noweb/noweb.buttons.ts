/**
 * Button Messages Module
 *
 * Implements WhatsApp button messages using binary node injection.
 *
 * ## Platform Compatibility
 *
 * | Button Type | Android | iOS | Notes |
 * |-------------|---------|-----|-------|
 * | Reply (quick_reply) | ✅ | ✅ | Returns button ID on click |
 * | URL (cta_url) | ✅ | ✅ | Opens URL in browser |
 * | Call (cta_call) | ✅ | ✅ | Initiates phone call |
 * | Copy (cta_copy) | ✅ | ✅ | Copies code to clipboard |
 *
 * ## Usage
 *
 * ```typescript
 * await sendButtonMessage(sock, '1234567890@c.us', [
 *   { type: ButtonType.REPLY, text: 'Yes', id: 'yes' },
 *   { type: ButtonType.REPLY, text: 'No', id: 'no' },
 *   { type: ButtonType.URL, text: 'Website', url: 'https://example.com' },
 * ], 'Question', undefined, 'Do you agree?', 'Click a button');
 * ```
 *
 * ## Limits
 *
 * - Maximum 4 buttons per message
 * - Button text: Maximum 20 characters
 * - nodeApproach 4 is recommended (BaileysHelper style)
 *
 * @warning Uses unofficial WhatsApp API. Meta may block these messages.
 * @see https://github.com/WhiskeySockets/Baileys/issues/56
 */
import { Button, ButtonType } from '@waha/structures/chatting.buttons.dto';

import {
  getCurrentWrapper,
  InteractiveWrapperType,
  randomId,
  sendInteractiveMessage,
  setInteractiveWrapper,
} from './noweb.interactive';

// Re-export for use in other modules
export { randomId, setInteractiveWrapper, InteractiveWrapperType, getCurrentWrapper };

const BUTTON_DEPRECATION_WARNING = `
[WAHA WARNING] Button messages may not work reliably.
Meta/WhatsApp deprecated interactive messages (lists, buttons) for unofficial APIs in May 2023.
For reliable interactive messages, use the official WhatsApp Cloud API.
See: https://github.com/WhiskeySockets/Baileys/issues/56
`;

let buttonWarningShown = false;

/**
 * Convert ButtonType enum to WhatsApp native flow button name.
 *
 * @param type - The WAHA ButtonType enum value
 * @returns WhatsApp native button name string
 */
function toName(type: ButtonType): string {
  switch (type) {
    case ButtonType.REPLY:
      return 'quick_reply';
    case ButtonType.URL:
      return 'cta_url';
    case ButtonType.CALL:
      return 'cta_call';
    case ButtonType.COPY:
      return 'cta_copy';
  }
}

/**
 * Convert a WAHA Button object to WhatsApp native flow JSON format.
 *
 * @param button - The WAHA Button object to convert
 * @returns Object with `name` and `buttonParamsJson` fields
 *
 * @example
 * const nativeButton = buttonToJson({
 *   type: ButtonType.REPLY,
 *   text: 'Click me',
 *   id: 'btn-1',
 * });
 * // Returns: { name: 'quick_reply', buttonParamsJson: '{"display_text":"Click me","id":"btn-1",...}' }
 */
export function buttonToJson(button: Button): { name: string; buttonParamsJson: string } {
  const name = toName(button.type);
  const buttonParams: any = {
    display_text: button.text,
    id: button.id || randomId(),
    disabled: false,
  };
  switch (button.type) {
    case ButtonType.REPLY:
      break;
    case ButtonType.CALL:
      buttonParams.phone_number = button.phoneNumber;
      break;
    case ButtonType.COPY:
      buttonParams.copy_code = button.copyCode;
      break;
    case ButtonType.URL:
      buttonParams.url = button.url;
      buttonParams.merchant_url = button.url;
      break;
  }
  return {
    name: name,
    buttonParamsJson: JSON.stringify(buttonParams),
  };
}

/**
 * Convert string wrapper name to InteractiveWrapperType enum.
 *
 * @param wrapper - String wrapper name from API request
 * @returns Corresponding enum value or undefined
 */
function parseWrapperType(wrapper?: string): InteractiveWrapperType | undefined {
  if (!wrapper) return undefined;
  switch (wrapper) {
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
      return undefined;
  }
}

/**
 * Send an interactive button message.
 *
 * @param sock - Baileys socket instance (WASocket)
 * @param chatId - Recipient JID (xxx@c.us for contacts, xxx@g.us for groups)
 * @param buttons - Array of 1-4 buttons to display
 * @param header - Optional header text displayed at the top
 * @param headerImage - Optional header image (RemoteFile or BinaryFile)
 * @param body - Main message body text
 * @param footer - Optional footer text (displayed smaller)
 * @param wrapper - Message wrapper type (default: viewOnceMessageV2)
 * @param nodeApproach - Binary node approach (default: 4 - recommended)
 *
 * @returns Message object with key.id for tracking
 *
 * @example
 * // Simple yes/no buttons
 * await sendButtonMessage(sock, '1234567890@c.us', [
 *   { type: ButtonType.REPLY, text: 'Yes', id: 'yes' },
 *   { type: ButtonType.REPLY, text: 'No', id: 'no' },
 * ], undefined, undefined, 'Do you agree?');
 *
 * @example
 * // Mixed button types
 * await sendButtonMessage(sock, '1234567890@c.us', [
 *   { type: ButtonType.REPLY, text: 'OK', id: 'ok' },
 *   { type: ButtonType.URL, text: 'Website', url: 'https://example.com' },
 *   { type: ButtonType.CALL, text: 'Call Us', phoneNumber: '+1234567890' },
 * ], 'Contact Us', undefined, 'Choose an option', 'Powered by WAHA');
 *
 * @warning Uses unofficial WhatsApp API. May be blocked by Meta.
 */
export async function sendButtonMessage(
  sock: any,
  chatId: string,
  buttons: Button[],
  header?: string,
  headerImage?: any,
  body?: string,
  footer?: string,
  wrapper?: string,
  nodeApproach?: number,
): Promise<any> {
  // Show deprecation warning once per process
  if (!buttonWarningShown) {
    console.warn(BUTTON_DEPRECATION_WARNING);
    buttonWarningShown = true;
  }

  const interactiveContent: any = {
    nativeFlowMessage: {
      buttons: buttons.map(buttonToJson),
      messageParamsJson: JSON.stringify({
        from: 'api',
        templateId: randomId(),
      }),
      messageVersion: 1,
    },
  };

  if (header || headerImage) {
    interactiveContent.header = {
      title: header,
      hasMediaAttachment: !!headerImage,
      imageMessage: headerImage,
    };
  }
  if (body) {
    interactiveContent.body = {
      text: body,
    };
  }
  if (footer) {
    interactiveContent.footer = {
      text: footer,
    };
  }

  const wrapperType = parseWrapperType(wrapper);
  return await sendInteractiveMessage(sock, chatId, interactiveContent, wrapperType, nodeApproach);
}
