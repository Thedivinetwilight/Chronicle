/**
 * Stable, sortable, globally unique identifiers.
 *
 * Chronicle uses a ULID-compatible encoding: 48 bits of millisecond timestamp
 * followed by 80 bits of randomness, rendered as 26 characters of Crockford
 * Base32. Properties that matter for this product:
 *
 * - **Stable across exports/imports**: ids are content-independent strings, so
 *   an archive restored on another device keeps every relationship intact.
 * - **Sortable**: lexicographic order matches creation order, which makes
 *   IndexedDB range queries and future sync cursors cheap.
 * - **No coordination required**: two devices can mint ids offline without
 *   colliding (80 bits of entropy per millisecond).
 * - **Opaque**: they carry no personal data, unlike slug-style ids.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford Base32 (no I L O U)
const DECODING: Record<string, number> = Object.fromEntries(
  [...ENCODING].map((c, i) => [c, i])
) as Record<string, number>;

const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
export const ID_LENGTH = TIME_LENGTH + RANDOM_LENGTH;

function encodeTime(time: number, length: number): string {
  let out = '';
  let value = time;
  for (let i = length; i > 0; i -= 1) {
    const mod = value % 32;
    out = ENCODING[mod] + out;
    value = (value - mod) / 32;
  }
  return out;
}

function decodeTime(chars: string): number {
  let value = 0;
  for (const char of chars) {
    const digit = DECODING[char];
    if (digit === undefined) throw new Error(`Invalid id character: ${char}`);
    value = value * 32 + digit;
  }
  return value;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoObj =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function'
      ? globalThis.crypto
      : undefined;
  if (cryptoObj) {
    cryptoObj.getRandomValues(bytes);
    return bytes;
  }
  // Deterministic-free fallback for environments without WebCrypto (e.g. some
  // minimal test runtimes). Not used in browsers.
  for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function encodeRandom(length: number): string {
  // 5 bits per character -> ceil(length*8/5) bytes.
  const bytes = randomBytes(Math.ceil((length * 5) / 8));
  let bits = 0;
  let buffer = 0;
  let out = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      bits -= 5;
      out += ENCODING[(buffer >> bits) & 31];
    }
  }
  while (out.length < length) out += ENCODING[0];
  return out;
}

/** Create a new id for "now" (or an explicit timestamp, used by imports/tests). */
export function createId(time: number = Date.now()): string {
  return encodeTime(time, TIME_LENGTH) + encodeRandom(RANDOM_LENGTH);
}

/**
 * Monotonic id factory. Two records created within the same millisecond still
 * sort in creation order, which keeps timelines stable.
 */
export function createIdFactory(now: () => number = () => Date.now()): () => string {
  let lastTime = 0;
  let lastRandom = '';
  return () => {
    const time = now();
    if (time === lastTime && lastRandom) {
      // Increment the random component to preserve ordering within a millisecond.
      let carried = 1;
      const chars = [...lastRandom];
      for (let i = chars.length - 1; i >= 0 && carried; i -= 1) {
        const current = chars[i] as string;
        const index = DECODING[current] ?? 0;
        const next = (index + 1) % 32;
        chars[i] = ENCODING[next] ?? ENCODING[0] ?? '0';
        carried = next === 0 ? 1 : 0;
      }
      lastRandom = chars.join('');
      return encodeTime(lastTime, TIME_LENGTH) + lastRandom;
    }
    lastTime = time;
    lastRandom = encodeRandom(RANDOM_LENGTH);
    return encodeTime(time, TIME_LENGTH) + lastRandom;
  };
}

export function isValidId(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length === ID_LENGTH &&
    [...value].every((c) => DECODING[c] !== undefined)
  );
}

/** Milliseconds since epoch encoded in an id, or `null` when not decodable. */
export function idTimestamp(id: string): number | null {
  if (id.length < TIME_LENGTH) return null;
  try {
    return decodeTime(id.slice(0, TIME_LENGTH));
  } catch {
    return null;
  }
}

/**
 * Deterministic id derived from a string. Used for idempotency keys so a
 * retried capture operation produces the *same* id instead of a duplicate
 * record (see §28.13).
 */
export function deterministicId(seed: string, time = 0): string {
  let h1 = 0x9e3779b9;
  let h2 = 0x85ebca6b;
  for (let i = 0; i < seed.length; i += 1) {
    const code = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761) >>> 0;
    h2 = Math.imul(h2 + code + i, 1597334677) >>> 0;
  }
  const hex = (h1.toString(16) + h2.toString(16) + seed.length.toString(16)).padEnd(16, '0');
  let random = '';
  for (const char of hex.slice(0, RANDOM_LENGTH)) {
    const n = parseInt(char, 16) || 0;
    random += ENCODING[n % 32];
  }
  return encodeTime(time, TIME_LENGTH) + random;
}

/** Short, human-friendly suffix for referencing a record in the UI. */
export function shortId(id: string): string {
  return id.slice(-6).toLowerCase();
}
