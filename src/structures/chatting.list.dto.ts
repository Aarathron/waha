import { ApiExtraModels, ApiProperty } from '@nestjs/swagger';
import { ChatRequest } from '@waha/structures/chatting.dto';
import { ChatIdProperty } from '@waha/structures/properties.dto';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Row in a list section
 */
class Row {
  @ApiProperty({
    example: 'Option 1',
    description: 'Display text for this row. Will be shown in the list picker.',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    example: 'Description of option 1',
    description: 'Optional description shown below the title.',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 'option1',
    description: 'Unique identifier for this row. Returned when user selects this option.',
  })
  @IsString()
  @IsNotEmpty()
  rowId: string;
}

/**
 * Section containing rows in a list message
 */
class Section {
  @ApiProperty({
    example: 'Menu',
    description: 'Section header text displayed above the rows.',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ValidateNested({ each: true })
  @Type(() => Row)
  @IsArray()
  @ArrayMinSize(1)
  @ApiProperty({
    description: 'Array of selectable rows in this section. Minimum 1 row required.',
    example: [
      { title: 'Option 1', rowId: 'option1', description: 'First option' },
      { title: 'Option 2', rowId: 'option2', description: 'Second option' },
    ],
  })
  rows: Row[];
}

/**
 * iOS Fallback Configuration
 *
 * List messages do NOT work on iOS devices. When enabled, this feature
 * monitors the message delivery status and automatically sends buttons
 * as a fallback if the list message stays undelivered.
 */
export class ListFallbackConfigDTO {
  @ApiProperty({
    description: 'Enable automatic fallback to buttons for iOS recipients.',
    example: true,
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({
    description: `Timeout in milliseconds before triggering fallback.
If the list message stays in PENDING status for this duration, buttons are sent.
**Default**: 30000 (30 seconds)`,
    example: 30000,
    required: false,
    default: 30000,
  })
  @IsOptional()
  @IsNumber()
  @Min(5000)
  @Max(120000)
  timeoutMs?: number;

  @ApiProperty({
    description: `Maximum number of buttons to create from list rows.
WhatsApp allows maximum 3 reply buttons. Rows beyond this limit will be truncated.
**Default**: 3`,
    example: 3,
    required: false,
    default: 3,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(3)
  maxButtons?: number;
}

/**
 * List message content
 */
export class SendListMessage {
  @ApiProperty({
    example: 'Example List',
    description: 'Title displayed at the top of the list picker.',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    example: 'Choose one of the options',
    description: 'Description text shown below the title.',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 'Footer note',
    description: 'Footer text shown at the bottom of the message.',
    required: false,
  })
  @IsOptional()
  @IsString()
  footer?: string;

  @ApiProperty({
    example: 'Select',
    description: 'Text displayed on the button that opens the list picker.',
  })
  @IsString()
  @IsNotEmpty()
  button: string;

  @ValidateNested({ each: true })
  @Type(() => Section)
  @IsArray()
  @ArrayMinSize(1)
  @ApiProperty({
    description: 'Array of sections. Each section contains rows that users can select from.',
    example: [
      {
        title: 'Section 1',
        rows: [
          { title: 'Option 1', rowId: 'option1', description: 'Description 1' },
          { title: 'Option 2', rowId: 'option2', description: 'Description 2' },
        ],
      },
    ],
  })
  sections: Section[];
}

/**
 * Request to send a list message
 *
 * **IMPORTANT - Platform Compatibility:**
 * - **Android**: List messages work correctly
 * - **iOS**: Lists do NOT work (iOS filters single_select messages)
 *
 * Use `iosFallback` to automatically send buttons when lists fail on iOS.
 *
 * @warning This uses unofficial WhatsApp API. Meta may block these messages.
 * @see https://github.com/WhiskeySockets/Baileys/issues/56
 */
@ApiExtraModels(SendListMessage, ListFallbackConfigDTO)
export class SendListRequest extends ChatRequest {
  @ChatIdProperty()
  @IsString()
  chatId: string;

  @ApiProperty({
    example: 4,
    description: `Binary node structure approach for lists.

**Recommended**: 4 (BaileysHelper style - same as buttons)
Other options: 7 (single_select), 8 (list type), 9-11 (experimental)

**Platform Note**: Lists only work on Android. Use \`iosFallback\` for iOS users.`,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  nodeApproach?: number;

  @ValidateNested()
  @Type(() => SendListMessage)
  @ApiProperty({
    type: SendListMessage,
    description: 'The list message content including title, sections, and rows.',
    example: {
      title: 'Simple Menu',
      description: 'Please choose an option',
      footer: 'Thank you!',
      button: 'Choose',
      sections: [
        {
          title: 'Main',
          rows: [
            {
              title: 'Option 1',
              rowId: 'option1',
              description: null,
            },
            {
              title: 'Option 2',
              rowId: 'option2',
              description: null,
            },
            {
              title: 'Option 3',
              rowId: 'option3',
              description: null,
            },
          ],
        },
      ],
    },
  })
  message: SendListMessage;

  @ApiProperty({
    description: `**iOS Fallback Configuration**

List messages do NOT work on iOS devices. When enabled, this feature:
1. Sends the list message normally
2. Monitors delivery status for the configured timeout
3. If message stays PENDING (undelivered), sends buttons as fallback
4. Returns both message IDs in the response

**Example:**
\`\`\`json
{
  "enabled": true,
  "timeoutMs": 30000,
  "maxButtons": 3
}
\`\`\``,
    required: false,
    type: ListFallbackConfigDTO,
    example: {
      enabled: true,
      timeoutMs: 30000,
      maxButtons: 3,
    },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ListFallbackConfigDTO)
  iosFallback?: ListFallbackConfigDTO;

  @ApiProperty({
    description: 'Message ID to reply to. Format: false_11111111111@c.us_AAAAAAAAAAAAAAAAAAAA',
    example: null,
    required: false,
  })
  @IsOptional()
  @IsString()
  reply_to?: string;
}

export { Row, Section };
