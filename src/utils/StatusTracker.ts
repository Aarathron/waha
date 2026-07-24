import { WAHASessionStatus } from '../structures/enums.dto';

const STUCK_IN_STARTING_THRESHOLD = 60;

/**
 * Consecutive occurrences of the same disconnect code
 * before we treat it as a confirmed repeated failure.
 */
const DISCONNECT_CODE_REPEAT_THRESHOLD = 3;

/**
 * Sliding window for counting 440 (connectionReplaced) conflicts.
 * A single 440 is normal (another device took over once); a burst of them
 * within this window means two clients are fighting over the same creds.
 */
const CONFLICT_WINDOW_MS = 2 * 60 * 1000;

/**
 * Per-session tracker for status transitions and disconnect codes.
 * Detects stuck sessions (continuous STARTING) and repeated failures
 * (same disconnect code appearing consecutively).
 */
export class StatusTracker {
  private numberOfStarting: number = 0;
  private lastDisconnectCode: number | undefined | null = undefined;
  private disconnectCodeCount: number = 0;
  // Wall-clock time of the first disconnect in the current same-code streak.
  private streakStartedAtMs: number | null = null;
  // Timestamps of recent 440 conflicts (connectionReplaced), pruned to the window.
  private conflictTimestamps: number[] = [];

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
   * Reset the consecutive disconnect-code streak.
   * Call on successful connection — a working session proves the previous
   * disconnects were recoverable, so they must not count toward escalation.
   */
  public resetDisconnectCode(): void {
    this.lastDisconnectCode = undefined;
    this.disconnectCodeCount = 0;
    this.streakStartedAtMs = null;
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
   *
   * `now` is injectable for testing; defaults to wall-clock time and is used
   * only to stamp the start of a new streak (see streakElapsedMs).
   */
  public trackDisconnectCode(
    statusCode: number | undefined | null,
    now: number = Date.now(),
  ): boolean {
    if (statusCode == null) {
      this.lastDisconnectCode = statusCode;
      this.disconnectCodeCount = 0;
      this.streakStartedAtMs = null;
      return false;
    }

    if (statusCode === this.lastDisconnectCode) {
      this.disconnectCodeCount += 1;
    } else {
      this.lastDisconnectCode = statusCode;
      this.disconnectCodeCount = 1;
      this.streakStartedAtMs = now;
    }

    return this.disconnectCodeCount >= DISCONNECT_CODE_REPEAT_THRESHOLD;
  }

  /**
   * Wall-clock milliseconds elapsed since the first disconnect of the current
   * same-code streak. Returns 0 when there is no active streak.
   *
   * Used to decide whether a repeated-transient streak has lasted long enough
   * to be a genuine outage (give up) rather than a brief blip (keep retrying).
   */
  public streakElapsedMs(now: number = Date.now()): number {
    if (this.streakStartedAtMs == null) {
      return 0;
    }
    return now - this.streakStartedAtMs;
  }

  /**
   * Record a 440 connectionReplaced conflict and return how many have occurred
   * within CONFLICT_WINDOW_MS. Unlike the disconnect-code streak, this counter
   * deliberately SURVIVES successful connections — a conflict fight cycles
   * open -> 440 -> reconnect -> open -> 440, so resetting on 'open' would hide
   * it forever. Old entries age out of the sliding window on their own.
   */
  public trackConflict(now: number = Date.now()): number {
    this.conflictTimestamps = this.conflictTimestamps.filter(
      (t) => now - t < CONFLICT_WINDOW_MS,
    );
    this.conflictTimestamps.push(now);
    return this.conflictTimestamps.length;
  }

  /**
   * Clear the conflict window. Call once the session has stopped fighting
   * (e.g. after escalating to FAILED) so a later relink starts clean.
   */
  public resetConflicts(): void {
    this.conflictTimestamps = [];
  }
}
