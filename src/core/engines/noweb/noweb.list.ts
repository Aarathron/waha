/**
 * WARNING: List messages (and button messages) are DEPRECATED by Meta/WhatsApp.
 *
 * As of May 2023, Meta actively patches unofficial WhatsApp Web libraries to block
 * interactive messages (lists, buttons). This feature may not work reliably.
 *
 * For reliable interactive messages, use the official WhatsApp Cloud API:
 * https://business.whatsapp.com/products/business-platform
 *
 * See: https://dev.to/purpshell/buttons-and-lists-get-deprecated-by-many-libraries-54h
 * See: https://github.com/WhiskeySockets/Baileys/issues/56
 */
import { Section } from '@waha/structures/chatting.list.dto';
import esm from '@waha/vendor/esm';
import { randomId } from './noweb.buttons';

const LIST_DEPRECATION_WARNING = `
[WAHA WARNING] List messages may not work reliably.
Meta/WhatsApp deprecated interactive messages (lists, buttons) for unofficial APIs in May 2023.
For reliable interactive messages, use the official WhatsApp Cloud API.
See: https://github.com/WhiskeySockets/Baileys/issues/56
`;

let listWarningShown = false;

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

export async function sendListMessage(
  sock: any,
  chatId: string,
  title: string,
  description: string | undefined,
  buttonText: string,
  footerText: string | undefined,
  sections: Section[],
) {
  // Show deprecation warning once per process
  if (!listWarningShown) {
    console.warn(LIST_DEPRECATION_WARNING);
    listWarningShown = true;
  }

  // Modern approach: Use interactiveMessage with list action (like Whapi.cloud)
  const data = {
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2,
        },
        interactiveMessage: {
          header: title
            ? { title: title, hasMediaAttachment: false }
            : undefined,
          body: description ? { text: description } : undefined,
          footer: footerText ? { text: footerText } : undefined,
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
          },
        },
      },
    },
  };

  const msg = esm.b.proto.Message.create(data);
  const fullMessage = esm.b.generateWAMessageFromContent(chatId, msg, {
    userJid: sock?.user?.id,
  });
  await sock.relayMessage(chatId, fullMessage.message, {
    messageId: fullMessage.key.id,
  });
  return fullMessage;
}
