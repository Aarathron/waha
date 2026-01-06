/**
 * iOS Fallback Module for List Messages
 *
 * List messages (single_select) do NOT work on iOS devices.
 * This module provides automatic fallback to buttons when list messages
 * are detected as undelivered.
 *
 * ## How it works:
 * 1. Send list message normally
 * 2. Monitor ACK status via RxJS observable
 * 3. If message stays PENDING for timeout period, trigger fallback
 * 4. Convert list rows to reply buttons (max 3)
 * 5. Send button message as fallback
 *
 * ## Platform Compatibility:
 * - Lists: Android ONLY (iOS filters single_select messages)
 * - Buttons: Android AND iOS (quick_reply is allowed)
 *
 * @see noweb.list.ts - List message implementation
 * @see noweb.buttons.ts - Button message implementation
 */

import { Observable, first, timeout, catchError, of, filter } from 'rxjs';

import { Button, ButtonType } from '@waha/structures/chatting.buttons.dto';
import { Section, Row } from '@waha/structures/chatting.list.dto';

/**
 * Configuration for iOS fallback behavior
 */
export interface ListFallbackConfig {
  /**
   * Enable automatic fallback from list to buttons for iOS recipients
   * @default false
   */
  enabled?: boolean;

  /**
   * Timeout in milliseconds to wait for ACK before triggering fallback
   * If message stays in PENDING state for this duration, fallback is triggered
   * @default 30000 (30 seconds)
   */
  timeoutMs?: number;

  /**
   * Maximum number of buttons to create from list rows (max 3 for reply buttons)
   * @default 3
   */
  maxButtons?: number;
}

/**
 * Result of list message send with fallback support
 */
export interface ListFallbackResult {
  /**
   * ID of the original list message
   */
  originalMessageId: string;

  /**
   * ID of the fallback button message (only present if fallback was triggered)
   */
  fallbackMessageId?: string;

  /**
   * Whether fallback was triggered
   */
  fallbackTriggered: boolean;

  /**
   * Reason for fallback (or delivery confirmation)
   */
  reason: 'timeout' | 'delivered';
}

/**
 * Result of converting a list to buttons
 */
export interface ListToButtonsConversion {
  /**
   * Array of buttons created from list rows
   */
  buttons: Button[];

  /**
   * Message body text
   */
  body: string;

  /**
   * Whether the list was truncated (more rows than maxButtons)
   */
  truncated: boolean;

  /**
   * Original number of rows across all sections
   */
  originalRowCount: number;
}

/**
 * Convert list sections/rows to reply buttons
 *
 * Conversion rules:
 * - Take first N rows across all sections (flattened)
 * - Use row.title as button.text (truncated to 20 chars)
 * - Use row.rowId as button.id
 * - Max 3 buttons (WhatsApp reply button limit)
 * - Add section title as prefix if multiple sections
 *
 * @param sections - Array of list sections with rows
 * @param description - Optional description to use as body text
 * @param maxButtons - Maximum number of buttons (1-3, default 3)
 * @returns Conversion result with buttons and metadata
 *
 * @example
 * const sections = [
 *   { title: 'Menu', rows: [{ title: 'Pizza', rowId: 'pizza' }] }
 * ];
 * const result = convertListToButtons(sections, 'Select an option');
 * // result.buttons = [{ type: 'reply', text: 'Pizza', id: 'pizza' }]
 */
export function convertListToButtons(
  sections: Section[],
  description?: string,
  maxButtons: number = 3,
): ListToButtonsConversion {
  // Flatten all rows from all sections
  const allRows: Array<{ row: Row; sectionTitle: string }> = [];

  for (const section of sections) {
    for (const row of section.rows) {
      allRows.push({ row, sectionTitle: section.title });
    }
  }

  // Take first N rows (limited by maxButtons and WhatsApp's 3 button limit)
  const effectiveMax = Math.min(maxButtons, 3);
  const selectedRows = allRows.slice(0, effectiveMax);
  const truncated = allRows.length > selectedRows.length;

  // Convert rows to buttons
  const buttons: Button[] = selectedRows.map(({ row, sectionTitle }) => {
    // If multiple sections, prefix with section title
    let buttonText = sections.length > 1 ? `${sectionTitle}: ${row.title}` : row.title;

    // Truncate to 20 characters (WhatsApp button text limit)
    if (buttonText.length > 20) {
      buttonText = buttonText.substring(0, 17) + '...';
    }

    return {
      type: ButtonType.REPLY,
      text: buttonText,
      id: row.rowId,
    };
  });

  // Build body text
  let body = description || 'Select an option:';
  if (truncated) {
    body += `\n\n(Showing ${selectedRows.length} of ${allRows.length} options)`;
  }

  return {
    buttons,
    body,
    truncated,
    originalRowCount: allRows.length,
  };
}

/**
 * Monitor a message for ACK status and trigger fallback if needed
 *
 * Subscribes to message update events and waits for the message to be
 * acknowledged (status > PENDING). If timeout is reached before ACK,
 * the fallback function is called.
 *
 * @param messageId - ID of the message to monitor
 * @param timeoutMs - Timeout in milliseconds before triggering fallback
 * @param fallbackFn - Function to call if fallback is needed
 * @param messageUpdates$ - RxJS Observable of message update events
 * @param logger - Optional logger for debugging
 * @returns Promise resolving to fallback result
 *
 * @example
 * const result = await monitorAndFallback(
 *   'MSG123',
 *   30000,
 *   async () => sendButtons(sock, chatId, buttons),
 *   messageUpdates$,
 * );
 * if (result.fallbackTriggered) {
 *   console.log('Fallback sent:', result.fallbackMessageId);
 * }
 */
export async function monitorAndFallback(
  messageId: string,
  timeoutMs: number,
  fallbackFn: () => Promise<any>,
  messageUpdates$: Observable<any>,
  logger?: any,
): Promise<ListFallbackResult> {
  return new Promise((resolve) => {
    // Create observable that:
    // 1. Filters for updates to our specific message
    // 2. Checks if status > 1 (not PENDING, meaning SERVER_ACK or higher)
    // 3. Takes the first match
    // 4. Times out if no match within timeoutMs
    //
    // Baileys status values (status = WAMessageAck + 1):
    // - 0 = ERROR, 1 = PENDING, 2 = SERVER, 3 = DEVICE, 4 = READ, 5 = PLAYED
    const ackReceived$ = messageUpdates$.pipe(
      filter((update: any) => {
        // Check if this update is for our message
        const updateMessageId = update?.key?.id || update?.update?.key?.id;
        return updateMessageId === messageId;
      }),
      filter((update: any) => {
        // Check if status changed from PENDING (1) to SERVER_ACK or higher (2+)
        // status=1 means PENDING (not delivered yet)
        // status>=2 means delivered (SERVER, DEVICE, READ, PLAYED)
        const status = update?.update?.status || update?.status;
        return status !== undefined && status > 1;
      }),
      first(),
      timeout(timeoutMs),
      catchError(() => {
        // Timeout occurred - message stayed PENDING
        return of({ timedOut: true });
      }),
    );

    ackReceived$.subscribe(async (result: any) => {
      if (result.timedOut) {
        // Message stayed PENDING - trigger fallback
        logger?.info(
          { messageId, timeoutMs },
          'List message ACK timeout - triggering iOS fallback',
        );

        try {
          const fallbackMsg = await fallbackFn();
          resolve({
            originalMessageId: messageId,
            fallbackMessageId: fallbackMsg?.key?.id,
            fallbackTriggered: true,
            reason: 'timeout',
          });
        } catch (error) {
          logger?.error(
            { error, messageId },
            'Failed to send fallback button message',
          );
          // Still report as triggered even if fallback failed
          resolve({
            originalMessageId: messageId,
            fallbackTriggered: true,
            reason: 'timeout',
          });
        }
      } else {
        // Message was acknowledged - no fallback needed
        logger?.debug(
          { messageId },
          'List message ACK received - no fallback needed',
        );
        resolve({
          originalMessageId: messageId,
          fallbackTriggered: false,
          reason: 'delivered',
        });
      }
    });
  });
}

/**
 * Default fallback configuration
 */
export const DEFAULT_FALLBACK_CONFIG: Required<ListFallbackConfig> = {
  enabled: false,
  timeoutMs: 30000,
  maxButtons: 3,
};
