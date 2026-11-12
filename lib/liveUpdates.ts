/**
 * Live-update settings (LIVE_UPDATES = smart-polling). Shared by the client
 * polling hooks and the server route handlers; no secrets, safe to bundle.
 *
 * There is no client-side Supabase/Realtime anymore: the browser polls
 * authenticated GET route handlers (app/api/**) that check the session and
 * chat participation on every request. See docs/realtime-security.md.
 */

/** While a chat is open and the tab is visible. */
export const CHAT_POLL_MS = 3_000;
/** Chat list and the navigation unread badge. */
export const LIST_POLL_MS = 20_000;
/** Map data and the "liked me" tab. */
export const SLOW_POLL_MS = 60_000;
/** Upper bound for the exponential back-off after failed polls. */
export const MAX_POLL_BACKOFF_MS = 5 * 60_000;

/** Messages per page (initial load, "load older" and each `?after=` batch). */
export const MESSAGE_PAGE_SIZE = 50;
/** Chats per page in the chat list. */
export const CHAT_LIST_PAGE_SIZE = 30;
/** Largest `limit` the chat list accepts (lets a poll refresh everything already loaded). */
export const CHAT_LIST_MAX_LIMIT = 100;
