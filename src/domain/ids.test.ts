/** Identifier tests: uniqueness, ordering, determinism and validation. */

import { describe, expect, it } from 'vitest';
import { createId, createIdFactory, deterministicId, idTimestamp, isValidId, shortId, ID_LENGTH } from './ids';

describe('createId', () => {
  it('produces 26-character Crockford base32 ids', () => {
    const id = createId();
    expect(id).toHaveLength(ID_LENGTH);
    expect(isValidId(id)).toBe(true);
    expect(/^[0-9A-HJKMNP-TV-Z]+$/.test(id)).toBe(true);
  });

  it('never repeats across a large batch', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) ids.add(createId());
    expect(ids.size).toBe(20_000);
  });

  it('embeds the creation time', () => {
    const time = Date.parse('2026-10-17T09:30:00.000Z');
    expect(idTimestamp(createId(time))).toBe(time);
    expect(idTimestamp('not-an-id')).toBeNull();
  });

  it('rejects malformed ids', () => {
    expect(isValidId('')).toBe(false);
    expect(isValidId('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
    expect(isValidId('01ARZ3NDEKTSV4RRFFQ69G5FAI')).toBe(false); // I is not Crockford base32
    expect(isValidId(42)).toBe(false);
  });
});

describe('createIdFactory', () => {
  it('keeps ids monotonic within the same millisecond', () => {
    const fixed = Date.parse('2026-10-17T09:30:00.000Z');
    const next = createIdFactory(() => fixed);
    const ids = Array.from({ length: 500 }, () => next());
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(500);
  });

  it('follows the clock when it advances', () => {
    let time = Date.parse('2026-10-17T09:30:00.000Z');
    const next = createIdFactory(() => time);
    const first = next();
    time += 1000;
    const second = next();
    expect(second > first).toBe(true);
    expect(idTimestamp(second)).toBe(time);
  });
});

describe('deterministicId', () => {
  it('maps the same seed to the same id', () => {
    expect(deterministicId('capture:hello', 1)).toBe(deterministicId('capture:hello', 1));
    expect(deterministicId('capture:hello', 1)).not.toBe(deterministicId('capture:hello!', 1));
  });

  it('produces valid, distinct ids for capture keys', () => {
    const entry = deterministicId('cap:entry', 0);
    const task = deterministicId('cap:task:0', 0);
    expect(isValidId(entry)).toBe(true);
    expect(isValidId(task)).toBe(true);
    expect(entry).not.toBe(task);
  });
});

describe('shortId', () => {
  it('returns a stable 6-character suffix', () => {
    expect(shortId('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe('9g5fav');
    expect(shortId('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toHaveLength(6);
  });
});
