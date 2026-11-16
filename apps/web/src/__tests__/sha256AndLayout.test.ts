import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bytesToHex, sha256Bytes, sha256HexUniversal } from '../lib/sha256';
import { DEFAULT_LAYOUT, layoutReducer, PINNED_TABS } from '../lib/workspaceLayout';

describe('pure-TS SHA-256 fallback', () => {
  const vectors = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1_000_003)];
  for (const v of vectors) {
    it(`matches node:crypto for length ${v.length}`, () => {
      const expected = createHash('sha256').update(v).digest('hex');
      expect(bytesToHex(sha256Bytes(new TextEncoder().encode(v)))).toBe(expected);
    });
  }

  it('works when crypto.subtle is unavailable (insecure origin)', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: () => {} }, configurable: true });
    try {
      const hex = await sha256HexUniversal('data_3HS4\n');
      expect(hex).toBe(createHash('sha256').update('data_3HS4\n').digest('hex'));
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });
});

describe('workspace layout reducer', () => {
  it('opens a new tab in the focused group and activates existing ones', () => {
    let s = layoutReducer(DEFAULT_LAYOUT, { type: 'open', tab: 'crispr' });
    expect(s.groups[0].tabs).toContain('crispr');
    expect(s.groups[0].active).toBe('crispr');
    s = layoutReducer(s, { type: 'open', tab: 'results' });
    expect(s.groups[1].active).toBe('results');
    expect(s.focused).toBe(1);
  });

  it('never closes the pinned 3D viewer', () => {
    expect(PINNED_TABS.has('viewer')).toBe(true);
    const s = layoutReducer(DEFAULT_LAYOUT, { type: 'close', tab: 'viewer' });
    expect(s.groups.some((g) => g.tabs.includes('viewer'))).toBe(true);
  });

  it('collapses an emptied group and keeps the viewer', () => {
    let s = DEFAULT_LAYOUT;
    for (const t of [...DEFAULT_LAYOUT.groups[1].tabs]) s = layoutReducer(s, { type: 'close', tab: t });
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].tabs).toContain('viewer');
  });

  it('moves a tab to the side, creating a split', () => {
    let s = layoutReducer(DEFAULT_LAYOUT, { type: 'reset' });
    for (const t of [...s.groups[1].tabs]) s = layoutReducer(s, { type: 'close', tab: t });
    s = layoutReducer(s, { type: 'open', tab: 'home', toSide: true });
    expect(s.groups).toHaveLength(2);
    expect(s.groups[1].tabs).toEqual(['home']);
    expect(s.groups[0].tabs).not.toContain('home');
  });

  it('merges split panes back into one group preserving focused active tab', () => {
    let s = layoutReducer(DEFAULT_LAYOUT, { type: 'reset' });
    s = layoutReducer(s, { type: 'activate', tab: 'results' });
    expect(s.groups).toHaveLength(2);
    expect(s.focused).toBe(1);
    s = layoutReducer(s, { type: 'merge_split' });
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].active).toBe('results');
    expect(s.groups[0].tabs).toContain('viewer');
  });
});
