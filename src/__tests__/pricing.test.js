import { describe, it, expect } from 'vitest';
import { calcPct, pctColor } from '../lib/pricing.js';

// ─── calcPct ──────────────────────────────────────────────────────────────────

describe('calcPct', () => {
  it('returns correct percentage', () => {
    expect(calcPct(75, 100)).toBe(75);
    expect(calcPct(50, 100)).toBe(50);
    expect(calcPct(200, 100)).toBe(200);
  });

  it('rounds to nearest integer', () => {
    expect(calcPct(1, 3)).toBe(33);   // 33.33...
    expect(calcPct(2, 3)).toBe(67);   // 66.66...
  });

  it('returns null when enteredMyr is 0', () => {
    expect(calcPct(0, 100)).toBeNull();
  });

  it('returns null when enteredMyr is null', () => {
    expect(calcPct(null, 100)).toBeNull();
  });

  it('returns null when marketMyr is 0', () => {
    expect(calcPct(100, 0)).toBeNull();
  });

  it('returns null when marketMyr is null', () => {
    expect(calcPct(100, null)).toBeNull();
  });

  it('returns null when both are null', () => {
    expect(calcPct(null, null)).toBeNull();
  });
});

// ─── pctColor ─────────────────────────────────────────────────────────────────

describe('pctColor — side: in (buying)', () => {
  it('null pct → gray', () => {
    expect(pctColor(null, 'in')).toBe('gray');
  });

  it('≤75 → green (great buy price)', () => {
    expect(pctColor(75, 'in')).toBe('green');
    expect(pctColor(50, 'in')).toBe('green');
    expect(pctColor(0,  'in')).toBe('green');
  });

  it('76–90 → yellow (acceptable)', () => {
    expect(pctColor(76, 'in')).toBe('yellow');
    expect(pctColor(90, 'in')).toBe('yellow');
  });

  it('>90 → red (overpaying)', () => {
    expect(pctColor(91,  'in')).toBe('red');
    expect(pctColor(100, 'in')).toBe('red');
    expect(pctColor(150, 'in')).toBe('red');
  });
});

describe('pctColor — side: out (selling)', () => {
  it('≥95 → green (good sell price)', () => {
    expect(pctColor(95,  'out')).toBe('green');
    expect(pctColor(100, 'out')).toBe('green');
    expect(pctColor(120, 'out')).toBe('green');
  });

  it('85–94 → yellow (below market but ok)', () => {
    expect(pctColor(85, 'out')).toBe('yellow');
    expect(pctColor(94, 'out')).toBe('yellow');
  });

  it('<85 → red (selling too cheap)', () => {
    expect(pctColor(84, 'out')).toBe('red');
    expect(pctColor(50, 'out')).toBe('red');
    expect(pctColor(0,  'out')).toBe('red');
  });
});
