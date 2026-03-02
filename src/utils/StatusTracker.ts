import { WAHASessionStatus } from '../structures/enums.dto';

const STUCK_IN_STARTING_THRESHOLD = 60;

/**
 * Consecutive occurrences of the same permanent disconnect code
 * before we short-circuit and treat it as definitely permanent.
 */
const PERMANENT_CODE_REPEAT_THRESHOLD = 3;

/**
 * Codes that are permanently fatal — auth is dead, retrying won't help.
 */
const PERMANENT_CODES = new Set([401, 403, 405]);

/**
 * Tracks session status transitions and disconnect codes to detect
 * stuck sessions and permanent failures.
 */
export class StatusTracker {
  private numberOfStarting: number = 0;
  private lastDisconnectCode: number | undefined | null = undefined;
  private disconnectCodeCount: number = 0;

  public track(status: WAHASessionStatus): void {
    if (status == WAHASessionStatus.STARTING) {
      this.numberOfStarting += 1;
    } else {
      this.numberOfStarting = 0;
    }
  }

  /**
   * Checks if the session has been continuously 'STARTING'
   */
  public isStuckInStarting(): boolean {
    return this.numberOfStarting >= STUCK_IN_STARTING_THRESHOLD;
  }

  /**
   * Track a disconnect status code and return whether it indicates
   * a confirmed permanent failure (same permanent code repeated).
   *
   * Returns true if the same permanent-category code has appeared
   * PERMANENT_CODE_REPEAT_THRESHOLD times consecutively.
   * Returns false for transient codes (they should be retried).
   */
  public trackDisconnectCode(
    statusCode: number | undefined | null,
  ): boolean {
    if (statusCode == null || !PERMANENT_CODES.has(statusCode)) {
      this.lastDisconnectCode = statusCode;
      this.disconnectCodeCount = 0;
      return false;
    }

    if (statusCode === this.lastDisconnectCode) {
      this.disconnectCodeCount += 1;
    } else {
      this.lastDisconnectCode = statusCode;
      this.disconnectCodeCount = 1;
    }

    return this.disconnectCodeCount >= PERMANENT_CODE_REPEAT_THRESHOLD;
  }
}
