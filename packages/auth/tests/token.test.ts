import { describe, expect, it } from 'vitest';
import { generateBridgeToken, hashBridgeToken } from '../src/token.js';
describe('bridge tokens', () => {
  it('generates opaque prefixed tokens', () =>
    expect(generateBridgeToken()).toMatch(/^brg_[A-Za-z0-9_-]+$/));
  it('hashes deterministically', () =>
    expect(hashBridgeToken('x', 'p')).toBe(hashBridgeToken('x', 'p')));
});
