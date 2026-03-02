import { WAHASessionStatus } from '../structures/enums.dto';

const STUCK_IN_STARTING_THRESHOLD = 60;

/**
 * Consecutive occurrences of the same disconnect code
 * before we treat it as a confirmed repeated failure.
 */
const DISCONNECT_CODE_REPEAT_THRESHOLD = 3;

/**
 * Per-session tracker for status transitions and disconnect codes.
 * Detects stuck sessions (continuous STARTING) and repeated failures
 * (same disconnect code appearing consecutively).
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
   * a repeated failure (same code appearing consecutively).
   *
   * Returns true if the same code has appeared
   * DISCONNECT_CODE_REPEAT_THRESHOLD times consecutively.
   *
   * Note: null/undefined codes reset the consecutive counter,
   * breaking any in-progress detection streak.
   */
  public trackDisconnectCode(
    statusCode: number | undefined | null,
  ): boolean {
    if (statusCode == null) {
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

    return this.disconnectCodeCount >= DISCONNECT_CODE_REPEAT_THRESHOLD;
  }
}
