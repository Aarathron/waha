export enum DisconnectAction {
  /** Auth is permanently invalid. Clean credentials, show QR. */
  PERMANENT = 'PERMANENT',
  /** Server requested a restart. Reconnect immediately. */
  RESTART = 'RESTART',
  /** Transient network/server issue. Retry with delay. */
  TRANSIENT = 'TRANSIENT',
}

/**
 * Status codes that indicate the session's auth state is permanently
 * invalid — retrying with the same credentials will never succeed.
 *
 * 401 = loggedOut (user logged out from another device)
 * 403 = forbidden (account banned or restricted)
 * 405 = registration rejected (WhatsApp rejects pairing, auth keys are stale)
 */
const PERMANENT_CODES = new Set([401, 403, 405]);

/**
 * Status codes where the server explicitly tells us to restart.
 *
 * 515 = restartRequired
 */
const RESTART_CODES = new Set([515]);

/**
 * Classify a Baileys disconnect status code into an action category.
 *
 * Baileys' CB:failure handler passes the raw reason code from WhatsApp
 * as statusCode. Not all codes are in the DisconnectReason enum —
 * e.g., 405 is not — so we must handle unknown codes gracefully.
 */
export function classifyDisconnect(
  statusCode: number | undefined | null,
): DisconnectAction {
  if (statusCode == null) {
    return DisconnectAction.TRANSIENT;
  }
  if (PERMANENT_CODES.has(statusCode)) {
    return DisconnectAction.PERMANENT;
  }
  if (RESTART_CODES.has(statusCode)) {
    return DisconnectAction.RESTART;
  }
  return DisconnectAction.TRANSIENT;
}
