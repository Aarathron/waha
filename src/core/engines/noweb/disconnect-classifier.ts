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
 * 401 = loggedOut (DisconnectReason.loggedOut — user logged out from another device)
 * 403 = forbidden (DisconnectReason.forbidden — account banned or restricted)
 * 405 = not in Baileys' DisconnectReason enum; observed as a pairing/registration
 *        rejection when auth keys are stale
 */
const PERMANENT_CODES: ReadonlySet<number> = new Set([401, 403, 405]);

/**
 * Status codes where the server explicitly tells us to restart.
 *
 * 515 = restartRequired
 */
const RESTART_CODES: ReadonlySet<number> = new Set([515]);

/**
 * Classify a Baileys disconnect status code into an action category.
 *
 * Baileys wraps disconnect reasons as Boom errors with a statusCode.
 * These may come from CB:failure (raw WhatsApp reason), stream errors,
 * or internal Baileys logic. Not all codes appear in the DisconnectReason
 * enum — e.g., 405 is not — so we must handle unknown codes gracefully.
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
