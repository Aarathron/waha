import { Section } from '@waha/structures/chatting.list.dto';
import esm from '@waha/vendor/esm';
import { randomId } from './noweb.buttons';

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
