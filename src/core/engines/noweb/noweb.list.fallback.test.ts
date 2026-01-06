import { Subject } from 'rxjs';

import { ButtonType } from '@waha/structures/chatting.buttons.dto';
import { Section } from '@waha/structures/chatting.list.dto';

import {
  convertListToButtons,
  monitorAndFallback,
  DEFAULT_FALLBACK_CONFIG,
  ListFallbackResult,
} from './noweb.list.fallback';

describe('convertListToButtons', () => {
  describe('basic conversion', () => {
    it('converts single section with one row to one button', () => {
      const sections: Section[] = [
        {
          title: 'Menu',
          rows: [{ title: 'Pizza', rowId: 'pizza' }],
        },
      ];

      const result = convertListToButtons(sections);

      expect(result.buttons).toHaveLength(1);
      expect(result.buttons[0]).toEqual({
        type: ButtonType.REPLY,
        text: 'Pizza',
        id: 'pizza',
      });
      expect(result.truncated).toBe(false);
      expect(result.originalRowCount).toBe(1);
    });

    it('converts single section with multiple rows', () => {
      const sections: Section[] = [
        {
          title: 'Menu',
          rows: [
            { title: 'Pizza', rowId: 'pizza' },
            { title: 'Burger', rowId: 'burger' },
            { title: 'Salad', rowId: 'salad' },
          ],
        },
      ];

      const result = convertListToButtons(sections);

      expect(result.buttons).toHaveLength(3);
      expect(result.buttons[0].text).toBe('Pizza');
      expect(result.buttons[1].text).toBe('Burger');
      expect(result.buttons[2].text).toBe('Salad');
      expect(result.truncated).toBe(false);
    });

    it('uses rowId as button id', () => {
      const sections: Section[] = [
        {
          title: 'Options',
          rows: [{ title: 'Option A', rowId: 'opt-a-123' }],
        },
      ];

      const result = convertListToButtons(sections);

      expect(result.buttons[0].id).toBe('opt-a-123');
    });

    it('sets all buttons to REPLY type', () => {
      const sections: Section[] = [
        {
          title: 'Menu',
          rows: [
            { title: 'One', rowId: '1' },
            { title: 'Two', rowId: '2' },
          ],
        },
      ];

      const result = convertListToButtons(sections);

      result.buttons.forEach((button) => {
        expect(button.type).toBe(ButtonType.REPLY);
      });
    });
  });

  describe('multiple sections', () => {
    it('prefixes button text with section title when multiple sections', () => {
      const sections: Section[] = [
        {
          title: 'Food',
          rows: [{ title: 'Pizza', rowId: 'pizza' }],
        },
        {
          title: 'Drinks',
          rows: [{ title: 'Cola', rowId: 'cola' }],
        },
      ];

      const result = convertListToButtons(sections);

      expect(result.buttons[0].text).toBe('Food: Pizza');
      expect(result.buttons[1].text).toBe('Drinks: Cola');
    });

    it('flattens rows from multiple sections', () => {
      const sections: Section[] = [
        {
          title: 'Section 1',
          rows: [
            { title: 'A', rowId: 'a' },
            { title: 'B', rowId: 'b' },
          ],
        },
        {
          title: 'Section 2',
          rows: [{ title: 'C', rowId: 'c' }],
        },
      ];

      const result = convertListToButtons(sections);

      expect(result.buttons).toHaveLength(3);
      expect(result.originalRowCount).toBe(3);
    });
  });

  describe('truncation', () => {
    it('truncates to 3 buttons by default', () => {
      const sections: Section[] = [
        {
          title: 'Menu',
          rows: [
            { title: 'One', rowId: '1' },
            { title: 'Two', rowId: '2' },
            { title: 'Three', rowId: '3' },
            { title: 'Four', rowId: '4' },
            { title: 'Five', rowId: '5' },
          ],
        },
      ];

      const result = convertListToButtons(sections);

      expect(result.buttons).toHaveLength(3);
      expect(result.truncated).toBe(true);
      expect(result.originalRowCount).toBe(5);
    });

    it('respects maxButtons parameter', () => {
      const sections: Section[] = [
        {
          title: 'Menu',
          rows: [
            { title: 'One', rowId: '1' },
            { title: 'Two', rowId: '2' },
            { title: 'Three', rowId: '3' },
          ],
        },
      ];

      const result = convertListToButtons(sections, undefined, 2);

      expect(result.buttons).toHaveLength(2);
      expect(result.truncated).toBe(true);
    });

    it('caps maxButtons at 3 even if higher value provided', () => {
      const sections: Section[] = [
        {
          title: 'Menu',
          rows: [
            { title: 'One', rowId: '1' },
            { title: 'Two', rowId: '2' },
            { title: 'Three', rowId: '3' },
            { title: 'Four', rowId: '4' },
            { title: 'Five', rowId: '5' },
          ],
        },
      ];

      const result = convertListToButtons(sections, undefined, 10);

      expect(result.buttons).toHaveLength(3);
    });

    it('adds truncation notice to body text', () => {
      const sections: Section[] = [
        {
          title: 'Menu',
          rows: [
            { title: 'One', rowId: '1' },
            { title: 'Two', rowId: '2' },
            { title: 'Three', rowId: '3' },
            { title: 'Four', rowId: '4' },
          ],
        },
      ];

      const result = convertListToButtons(sections, 'Choose:');

      expect(result.body).toContain('Choose:');
      expect(result.body).toContain('Showing 3 of 4 options');
    });
  });

  describe('text truncation', () => {
    it('truncates button text longer than 20 characters', () => {
      const sections: Section[] = [
        {
          title: 'Menu',
          rows: [{ title: 'This is a very long option title', rowId: 'long' }],
        },
      ];

      const result = convertListToButtons(sections);

      expect(result.buttons[0].text).toBe('This is a very lo...');
      expect(result.buttons[0].text.length).toBe(20);
    });

    it('does not truncate text exactly 20 characters', () => {
      const sections: Section[] = [
        {
          title: 'Menu',
          rows: [{ title: '12345678901234567890', rowId: 'exact' }],
        },
      ];

      const result = convertListToButtons(sections);

      expect(result.buttons[0].text).toBe('12345678901234567890');
    });

    it('truncates combined section:title text in multi-section lists', () => {
      const sections: Section[] = [
        {
          title: 'Long Section',
          rows: [{ title: 'Long Title', rowId: 'long' }],
        },
        {
          title: 'Other',
          rows: [{ title: 'X', rowId: 'x' }],
        },
      ];

      const result = convertListToButtons(sections);

      // "Long Section: Long Title" is 24 chars, should be truncated to 17 + "..."
      expect(result.buttons[0].text).toBe('Long Section: Lon...');
      expect(result.buttons[0].text.length).toBe(20);
    });
  });

  describe('body text', () => {
    it('uses custom description as body', () => {
      const sections: Section[] = [
        {
          title: 'Menu',
          rows: [{ title: 'Option', rowId: 'opt' }],
        },
      ];

      const result = convertListToButtons(sections, 'Please select an item:');

      expect(result.body).toBe('Please select an item:');
    });

    it('uses default body when no description provided', () => {
      const sections: Section[] = [
        {
          title: 'Menu',
          rows: [{ title: 'Option', rowId: 'opt' }],
        },
      ];

      const result = convertListToButtons(sections);

      expect(result.body).toBe('Select an option:');
    });

    it('uses default body when description is undefined', () => {
      const sections: Section[] = [
        {
          title: 'Menu',
          rows: [{ title: 'Option', rowId: 'opt' }],
        },
      ];

      const result = convertListToButtons(sections, undefined);

      expect(result.body).toBe('Select an option:');
    });
  });

  describe('edge cases', () => {
    it('handles empty sections array', () => {
      const result = convertListToButtons([]);

      expect(result.buttons).toHaveLength(0);
      expect(result.truncated).toBe(false);
      expect(result.originalRowCount).toBe(0);
    });

    it('handles section with empty rows array', () => {
      const sections: Section[] = [
        {
          title: 'Empty',
          rows: [],
        },
      ];

      const result = convertListToButtons(sections);

      expect(result.buttons).toHaveLength(0);
      expect(result.originalRowCount).toBe(0);
    });

    it('handles rows with description field (ignores it)', () => {
      const sections: Section[] = [
        {
          title: 'Menu',
          rows: [
            { title: 'Pizza', rowId: 'pizza', description: 'Delicious pizza' },
          ],
        },
      ];

      const result = convertListToButtons(sections);

      expect(result.buttons[0].text).toBe('Pizza');
      // Description is not included in button
    });
  });
});

describe('monitorAndFallback', () => {
  let messageUpdates$: Subject<any>;

  beforeEach(() => {
    messageUpdates$ = new Subject();
  });

  afterEach(() => {
    messageUpdates$.complete();
  });

  describe('successful delivery', () => {
    it('returns delivered when ACK received before timeout', async () => {
      const resultPromise = monitorAndFallback(
        'MSG123',
        5000,
        async () => ({ key: { id: 'FALLBACK123' } }),
        messageUpdates$.asObservable(),
      );

      // Emit ACK update (status > 1 means delivered)
      messageUpdates$.next({
        key: { id: 'MSG123' },
        update: { status: 2 }, // SERVER_ACK
      });

      const result = await resultPromise;

      expect(result.fallbackTriggered).toBe(false);
      expect(result.reason).toBe('delivered');
      expect(result.originalMessageId).toBe('MSG123');
      expect(result.fallbackMessageId).toBeUndefined();
    });

    it('handles alternative update structure with nested key', async () => {
      const resultPromise = monitorAndFallback(
        'MSG456',
        5000,
        async () => ({ key: { id: 'FALLBACK456' } }),
        messageUpdates$.asObservable(),
      );

      // Alternative structure: key nested in update
      messageUpdates$.next({
        update: {
          key: { id: 'MSG456' },
          status: 3, // DEVICE_ACK
        },
      });

      const result = await resultPromise;

      expect(result.fallbackTriggered).toBe(false);
      expect(result.reason).toBe('delivered');
    });

    it('ignores updates for other messages', async () => {
      const fallbackFn = jest.fn().mockResolvedValue({ key: { id: 'FB' } });

      const resultPromise = monitorAndFallback(
        'MSG123',
        100, // Short timeout
        fallbackFn,
        messageUpdates$.asObservable(),
      );

      // Emit ACK for different message
      messageUpdates$.next({
        key: { id: 'OTHER_MSG' },
        update: { status: 2 },
      });

      const result = await resultPromise;

      // Should timeout because we didn't get ACK for MSG123
      expect(result.fallbackTriggered).toBe(true);
      expect(result.reason).toBe('timeout');
    });

    it('ignores PENDING status updates (status = 1)', async () => {
      const fallbackFn = jest.fn().mockResolvedValue({ key: { id: 'FB' } });

      const resultPromise = monitorAndFallback(
        'MSG123',
        100, // Short timeout
        fallbackFn,
        messageUpdates$.asObservable(),
      );

      // Emit PENDING status (should be ignored)
      messageUpdates$.next({
        key: { id: 'MSG123' },
        update: { status: 1 }, // PENDING
      });

      const result = await resultPromise;

      // Should timeout because status=1 is not considered delivered
      expect(result.fallbackTriggered).toBe(true);
    });

    it('ignores ERROR status updates (status = 0)', async () => {
      const fallbackFn = jest.fn().mockResolvedValue({ key: { id: 'FB' } });

      const resultPromise = monitorAndFallback(
        'MSG123',
        100,
        fallbackFn,
        messageUpdates$.asObservable(),
      );

      messageUpdates$.next({
        key: { id: 'MSG123' },
        update: { status: 0 }, // ERROR
      });

      const result = await resultPromise;

      expect(result.fallbackTriggered).toBe(true);
    });
  });

  describe('timeout and fallback', () => {
    it('triggers fallback on timeout', async () => {
      const fallbackFn = jest.fn().mockResolvedValue({
        key: { id: 'FALLBACK_MSG_ID' },
      });

      const result = await monitorAndFallback(
        'MSG123',
        50, // Very short timeout
        fallbackFn,
        messageUpdates$.asObservable(),
      );

      expect(result.fallbackTriggered).toBe(true);
      expect(result.reason).toBe('timeout');
      expect(result.originalMessageId).toBe('MSG123');
      expect(result.fallbackMessageId).toBe('FALLBACK_MSG_ID');
      expect(fallbackFn).toHaveBeenCalledTimes(1);
    });

    it('calls fallback function when timeout occurs', async () => {
      const fallbackFn = jest.fn().mockResolvedValue({ key: { id: 'FB' } });

      await monitorAndFallback(
        'MSG123',
        50,
        fallbackFn,
        messageUpdates$.asObservable(),
      );

      expect(fallbackFn).toHaveBeenCalled();
    });
  });

  describe('fallback failure', () => {
    it('reports fallback_failed when fallback function throws', async () => {
      const fallbackFn = jest
        .fn()
        .mockRejectedValue(new Error('Network error'));

      const result = await monitorAndFallback(
        'MSG123',
        50,
        fallbackFn,
        messageUpdates$.asObservable(),
      );

      expect(result.fallbackTriggered).toBe(false);
      expect(result.reason).toBe('fallback_failed');
      expect(result.error).toBe('Network error');
      expect(result.originalMessageId).toBe('MSG123');
    });

    it('converts non-Error throws to string', async () => {
      const fallbackFn = jest.fn().mockRejectedValue('String error');

      const result = await monitorAndFallback(
        'MSG123',
        50,
        fallbackFn,
        messageUpdates$.asObservable(),
      );

      expect(result.reason).toBe('fallback_failed');
      expect(result.error).toBe('String error');
    });

    it('handles fallback returning undefined key', async () => {
      const fallbackFn = jest.fn().mockResolvedValue({});

      const result = await monitorAndFallback(
        'MSG123',
        50,
        fallbackFn,
        messageUpdates$.asObservable(),
      );

      expect(result.fallbackTriggered).toBe(true);
      expect(result.fallbackMessageId).toBeUndefined();
    });
  });

  describe('logger integration', () => {
    it('calls logger.info on timeout', async () => {
      const logger = {
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };

      await monitorAndFallback(
        'MSG123',
        50,
        async () => ({ key: { id: 'FB' } }),
        messageUpdates$.asObservable(),
        logger,
      );

      expect(logger.info).toHaveBeenCalledWith(
        { messageId: 'MSG123', timeoutMs: 50 },
        'List message ACK timeout - triggering iOS fallback',
      );
    });

    it('calls logger.error on fallback failure', async () => {
      const logger = {
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };

      await monitorAndFallback(
        'MSG123',
        50,
        async () => {
          throw new Error('Failed');
        },
        messageUpdates$.asObservable(),
        logger,
      );

      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Failed', messageId: 'MSG123' },
        'Failed to send fallback button message',
      );
    });

    it('calls logger.debug on successful delivery', async () => {
      const logger = {
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };

      const resultPromise = monitorAndFallback(
        'MSG123',
        5000,
        async () => ({ key: { id: 'FB' } }),
        messageUpdates$.asObservable(),
        logger,
      );

      messageUpdates$.next({
        key: { id: 'MSG123' },
        update: { status: 2 },
      });

      await resultPromise;

      expect(logger.debug).toHaveBeenCalledWith(
        { messageId: 'MSG123' },
        'List message ACK received - no fallback needed',
      );
    });

    it('works without logger (optional parameter)', async () => {
      const result = await monitorAndFallback(
        'MSG123',
        50,
        async () => ({ key: { id: 'FB' } }),
        messageUpdates$.asObservable(),
        // No logger passed
      );

      expect(result.reason).toBe('timeout');
    });
  });
});

describe('DEFAULT_FALLBACK_CONFIG', () => {
  it('has correct default values', () => {
    expect(DEFAULT_FALLBACK_CONFIG).toEqual({
      enabled: false,
      timeoutMs: 30000,
      maxButtons: 3,
    });
  });
});
