/**
 * Session-only AI credential (§28.10).
 *
 * The key is entered by the user, kept in memory for the session, and never
 * written to storage, exports or logs. Reload the app and it is gone.
 */

let sessionApiKey: string | null = null;

export function getAiSessionKey(): string | null {
  return sessionApiKey;
}

export function setAiSessionKey(key: string | null): void {
  sessionApiKey = key && key.trim().length > 0 ? key.trim() : null;
}

export function hasAiSessionKey(): boolean {
  return sessionApiKey !== null;
}
