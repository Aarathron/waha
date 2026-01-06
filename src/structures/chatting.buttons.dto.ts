import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { WHATSAPP_DEFAULT_SESSION_NAME } from '@waha/structures/base.dto';
import { ChatRequest } from '@waha/structures/chatting.dto';
import { BinaryFile, RemoteFile } from '@waha/structures/files.dto';
import { ChatIdProperty } from '@waha/structures/properties.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * Button types supported by WhatsApp interactive messages
 *
 * **Platform Support**: All button types work on both Android and iOS.
 */
export enum ButtonType {
  /** Quick reply button - returns button ID when clicked */
  REPLY = 'reply',
  /** URL button - opens the specified URL in browser */
  URL = 'url',
  /** Call button - initiates a phone call to the specified number */
  CALL = 'call',
  /** Copy button - copies the specified code to clipboard */
  COPY = 'copy',
}

/**
 * Interactive button definition
 *
 * Each button type has specific required fields:
 * - **reply**: Just `text` (and optional `id`)
 * - **url**: `text` + `url` (required)
 * - **call**: `text` + `phoneNumber` (required)
 * - **copy**: `text` + `copyCode` (required)
 */
export class Button {
  @ApiProperty({
    enum: ButtonType,
    example: ButtonType.REPLY,
    description: `Button type:
- **reply**: Quick reply button (returns ID when clicked)
- **url**: Opens URL in browser
- **call**: Initiates phone call
- **copy**: Copies code to clipboard

**Platform Support**: All types work on Android AND iOS.`,
  })
  @IsEnum(ButtonType)
  type: ButtonType = ButtonType.REPLY;

  @ApiProperty({
    example: 'Button Text',
    description: 'Display text for the button. **Maximum 20 characters** for best display.',
    maxLength: 20,
  })
  @IsString()
  text: string;

  @ApiProperty({
    example: '321321',
    description: 'Unique identifier for this button. Returned in webhook when user clicks. Auto-generated if not provided.',
    required: false,
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({
    example: 'https://example.com',
    description: 'URL to open when button is clicked. **Required for URL button type.**',
    required: false,
  })
  @ValidateIf((o) => o.type === ButtonType.URL)
  @IsNotEmpty()
  url?: string;

  @ApiProperty({
    example: '+1234567890',
    description: 'Phone number to call when button is clicked. **Required for CALL button type.** Include country code.',
    required: false,
  })
  @ValidateIf((o) => o.type === ButtonType.CALL)
  @IsNotEmpty()
  phoneNumber?: string;

  @ApiProperty({
    example: '4321',
    description: 'Code to copy to clipboard when button is clicked. **Required for COPY button type.**',
    required: false,
  })
  @ValidateIf((o) => o.type === ButtonType.COPY)
  @IsNotEmpty()
  copyCode?: string;
}

/**
 * Request to send a button message
 *
 * **Platform Support**: Buttons work on BOTH Android and iOS devices.
 *
 * @warning This uses unofficial WhatsApp API. Meta may block these messages.
 * @see https://github.com/WhiskeySockets/Baileys/issues/56
 */
@ApiExtraModels(RemoteFile, BinaryFile)
export class SendButtonsRequest {
  @IsString()
  session: string = WHATSAPP_DEFAULT_SESSION_NAME;

  @ChatIdProperty()
  @IsString()
  chatId: string;

  @ApiProperty({
    example: 'viewOnceMessageV2',
    description: `Message encoding wrapper type.

**Options**:
- \`viewOnceMessageV2\` - **Recommended**, most reliable
- \`viewOnceMessage\` - Legacy view-once wrapper
- \`viewOnceMessageV2Extension\` - Extended view-once
- \`botInvokeMessage\` - Bot invocation wrapper
- \`direct\` - No wrapper (least reliable)

**WARNING**: This uses unofficial WhatsApp API. Meta may block these messages.`,
    required: false,
  })
  @IsOptional()
  @IsString()
  wrapper?: string;

  @ApiProperty({
    example: 4,
    description: `Binary node structure approach for message encoding.

**Recommended**: \`4\` (BaileysHelper nested structure - proven reliable)

Other options (for debugging only):
- 1: biz[native_flow]+bot
- 2: biz+native_flow+bot
- 3: biz[interactive]+bot
- 5: BaileysHelper with Uint8Array
- 6-11: Experimental variants

**Note**: Groups automatically omit the \`<bot>\` node as it's not needed.`,
    required: false,
  })
  @IsOptional()
  nodeApproach?: number;

  @ApiProperty({
    example: 'How are you?',
    description: 'Header text displayed at the top of the message. Optional.',
    required: false,
  })
  @IsOptional()
  header: string;

  @ApiProperty({
    description: `Header image to display above the message.

Supports remote URL or base64-encoded binary data.
**Note**: Image will be displayed at the top of the message above the header text.`,
    oneOf: [
      { $ref: getSchemaPath(RemoteFile) },
      { $ref: getSchemaPath(BinaryFile) },
    ],
    required: false,
  })
  @IsOptional()
  headerImage?: RemoteFile | BinaryFile;

  @ApiProperty({
    example: 'Tell us how are you please 🙏',
    description: 'Main message body text. This is the primary content of your message.',
    required: false,
  })
  @IsOptional()
  body: string;

  @ApiProperty({
    example: 'If you have any questions, please send it in the chat',
    description: 'Footer text displayed at the bottom of the message in smaller font.',
    required: false,
  })
  @IsOptional()
  footer: string;

  @ValidateNested({ each: true })
  @Type(() => Button)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ApiProperty({
    description: `Array of interactive buttons.

**Limits**:
- Minimum: 1 button
- Maximum: 4 buttons
- Button text: Max 20 characters

**Platform Support**: All button types work on Android AND iOS.`,
    example: [
      {
        type: 'reply',
        text: 'I am good!',
      },
      {
        type: 'call',
        text: 'Call us',
        phoneNumber: '+1234567890',
      },
      {
        type: 'copy',
        text: 'Copy code',
        copyCode: '4321',
      },
      {
        type: 'url',
        text: 'How did you do that?',
        url: 'https://waha.devlike.pro',
      },
    ],
  })
  buttons: Button[];
}
