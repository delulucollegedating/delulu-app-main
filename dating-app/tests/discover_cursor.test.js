import { describe, expect, it } from 'vitest';

const { __discoverTestUtils } = require('../server.js');

describe('Discover cursor pagination', () => {
  it('continues a feed only for the same user and filter', () => {
    const cursor = __discoverTestUtils.createDiscoverCursor(42, 'female', 15);

    expect(__discoverTestUtils.readDiscoverCursor(cursor, 42, 'female')).toBe(15);
    expect(__discoverTestUtils.readDiscoverCursor(cursor, 41, 'female')).toBeNull();
    expect(__discoverTestUtils.readDiscoverCursor(cursor, 42, 'male')).toBeNull();
  });

  it('rejects a tampered continuation cursor', () => {
    const cursor = __discoverTestUtils.createDiscoverCursor(42, null, 30);
    const tampered = `${cursor.slice(0, 12)}${cursor[12] === 'A' ? 'B' : 'A'}${cursor.slice(13)}`;

    expect(__discoverTestUtils.readDiscoverCursor(tampered, 42, null)).toBeNull();
  });
});
