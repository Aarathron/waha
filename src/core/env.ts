import { parseBool } from '@waha/helpers';

//
// Presence
//

// Automatically mark session as ONLINE on any messages activity
export const PRESENCE_AUTO_ONLINE = process.env.WAHA_PRESENCE_AUTO_ONLINE
  ? parseBool(process.env.WAHA_PRESENCE_AUTO_ONLINE)
  : true;

// Duration (in seconds) to keep session ONLINE after activity
// 25 seconds is default web timeout with no activity
export const PRESENCE_AUTO_ONLINE_DURATION_SECONDS =
  parseInt(process.env.WAHA_PRESENCE_AUTO_ONLINE_DURATION_SECONDS) || 25;

//
// Local - sqlite3 engine
//
let KNEX_SQLITE_CLIENT = process.env.WAHA_SQLITE_ENGINE;
if (KNEX_SQLITE_CLIENT != 'sqlite3' && KNEX_SQLITE_CLIENT != 'better-sqlite3') {
  KNEX_SQLITE_CLIENT = 'sqlite3';
}
export { KNEX_SQLITE_CLIENT };

//
// Client config
//
export const WAHA_CLIENT_DEVICE_NAME =
  process.env.WAHA_CLIENT_DEVICE_NAME || null;
export const WAHA_CLIENT_BROWSER_NAME =
  process.env.WAHA_CLIENT_BROWSER_NAME || null;

//
// WhatsApp Web version override (format: "2,3000,1034386130")
//
export const WAHA_WA_VERSION = process.env.WAHA_WA_VERSION || null;

//
// NOWEB periodic forced-restart interval (minutes).
// 0 = disabled (default, recommended). A real WhatsApp companion device holds a
// persistent connection; tearing it down on a timer is bot-like connection churn
// and does NOT improve longevity. Upstream WAHA added a 30-min restart, then
// removed it (restart only on socket error). Set >0 only as a last-resort crutch.
//
export const WAHA_NOWEB_AUTO_RESTART_MINUTES =
  parseInt(process.env.WAHA_NOWEB_AUTO_RESTART_MINUTES) || 0;

//
// Interactive messages (buttons/lists) wrapper type
// Options: viewOnceMessage, viewOnceMessageV2, viewOnceMessageV2Extension, botInvokeMessage, direct
// Default: viewOnceMessageV2 (experimental - trying to find what works)
//
export const WAHA_INTERACTIVE_WRAPPER =
  process.env.WAHA_INTERACTIVE_WRAPPER || 'viewOnceMessageV2';
