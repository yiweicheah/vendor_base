import { describe, it, expect } from 'vitest';
import {
  normalizeStr,
  tokenize,
  buildQuery,
  isQueryTooShort,
  buildAlternateNumberQuery,
} from '../lib/tokenizer.js';

// ─── normalizeStr ─────────────────────────────────────────────────────────────

describe('normalizeStr', () => {
  it('removes accents', () => {
    expect(normalizeStr('café')).toBe('cafe');
    expect(normalizeStr('Pokémon')).toBe('Pokemon');
    expect(normalizeStr('naïve')).toBe('naive');
  });

  it('leaves plain ASCII unchanged', () => {
    expect(normalizeStr('pikachu')).toBe('pikachu');
    expect(normalizeStr('Charizard')).toBe('Charizard');
  });

  it('handles empty string', () => {
    expect(normalizeStr('')).toBe('');
  });
});

// ─── tokenize ─────────────────────────────────────────────────────────────────

describe('tokenize', () => {
  it('name only', () => {
    expect(tokenize('charizard')).toEqual({
      nameTokens: ['charizard'], localId: null, setTotal: null, setTotalRaw: null,
    });
  });

  it('number only', () => {
    expect(tokenize('276')).toEqual({
      nameTokens: [], localId: '276', setTotal: null, setTotalRaw: null,
    });
  });

  it('N/M format preserves leading zeros', () => {
    expect(tokenize('080/080')).toEqual({
      nameTokens: [], localId: '080', setTotal: 80, setTotalRaw: '080',
    });
  });

  it('name + N/M', () => {
    expect(tokenize('pikachu 276/217')).toEqual({
      nameTokens: ['pikachu'], localId: '276', setTotal: 217, setTotalRaw: '217',
    });
  });

  it('whitespace only → all empty', () => {
    expect(tokenize('   ')).toEqual({
      nameTokens: [], localId: null, setTotal: null, setTotalRaw: null,
    });
  });

  it('multiple name tokens', () => {
    const { nameTokens } = tokenize('dark charizard holo');
    expect(nameTokens).toEqual(['dark', 'charizard', 'holo']);
  });

  it('name + standalone number', () => {
    expect(tokenize('charizard 10')).toMatchObject({
      nameTokens: ['charizard'],
      localId: '10',
    });
  });
});

// ─── buildQuery ───────────────────────────────────────────────────────────────

describe('buildQuery', () => {
  it('name only', () => {
    expect(buildQuery({ nameTokens: ['charizard'], localId: null, setTotalRaw: null }))
      .toBe('charizard');
  });

  it('number with set total', () => {
    expect(buildQuery({ nameTokens: [], localId: '080', setTotalRaw: '080' }))
      .toBe('080/080');
  });

  it('name + number/set', () => {
    expect(buildQuery({ nameTokens: ['pikachu'], localId: '276', setTotalRaw: '217' }))
      .toBe('pikachu 276/217');
  });

  it('number without set total', () => {
    expect(buildQuery({ nameTokens: [], localId: '42', setTotalRaw: null }))
      .toBe('42');
  });

  it('preserves leading zeros in set total', () => {
    expect(buildQuery({ nameTokens: [], localId: '082', setTotalRaw: '090' }))
      .toBe('082/090');
  });
});

// ─── isQueryTooShort ─────────────────────────────────────────────────────────

describe('isQueryTooShort', () => {
  it('empty string → true', () => expect(isQueryTooShort('')).toBe(true));
  it('single char → true', () => expect(isQueryTooShort('a')).toBe(true));
  it('spaces with 1 char → true', () => expect(isQueryTooShort(' a ')).toBe(true));
  it('two chars → false', () => expect(isQueryTooShort('ab')).toBe(false));
  it('two chars with spaces → false', () => expect(isQueryTooShort('a b')).toBe(false));
  it('number string → false', () => expect(isQueryTooShort('42')).toBe(false));
});

// ─── buildAlternateNumberQuery ────────────────────────────────────────────────

describe('buildAlternateNumberQuery', () => {
  it('padded localId with padded set → strips both', () => {
    expect(buildAlternateNumberQuery({ localId: '082', setTotalRaw: '090' })).toBe('82/90');
  });

  it('unpadded localId with unpadded set → pads both', () => {
    expect(buildAlternateNumberQuery({ localId: '82', setTotalRaw: '90' })).toBe('082/090');
  });

  it('number with no padding needed → null', () => {
    expect(buildAlternateNumberQuery({ localId: '100', setTotalRaw: null })).toBeNull();
  });

  it('alphanumeric localId → null', () => {
    expect(buildAlternateNumberQuery({ localId: 'tg06', setTotalRaw: null })).toBeNull();
  });

  it('alphanumeric set → null', () => {
    expect(buildAlternateNumberQuery({ localId: '082', setTotalRaw: 'tg01' })).toBeNull();
  });

  it('single digit → pads to 3 digits', () => {
    expect(buildAlternateNumberQuery({ localId: '5', setTotalRaw: null })).toBe('005');
  });

  it('null localId → null', () => {
    expect(buildAlternateNumberQuery({ localId: null, setTotalRaw: null })).toBeNull();
  });
});
