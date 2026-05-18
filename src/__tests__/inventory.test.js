import { describe, it, expect } from 'vitest';
import { getStock } from '../lib/inventory.js';

function tx(lines) {
  return { transactionLines: lines };
}

function line(type, side, cardExternalId, qty) {
  return { type, side, cardExternalId, qty };
}

describe('getStock', () => {
  it('returns null when cardExternalId is null', () => {
    expect(getStock(null, [])).toBeNull();
  });

  it('returns null when cardExternalId is undefined', () => {
    expect(getStock(undefined, [])).toBeNull();
  });

  it('returns 0 when no matching transactions', () => {
    expect(getStock('A', [])).toBe(0);
  });

  it('returns 0 for non-matching card', () => {
    const txs = [tx([line('card', 'in', 'B', 3)])];
    expect(getStock('A', txs)).toBe(0);
  });

  it('2 in → 2', () => {
    const txs = [tx([line('card', 'in', 'A', 2)])];
    expect(getStock('A', txs)).toBe(2);
  });

  it('2 in 1 out → 1', () => {
    const txs = [
      tx([line('card', 'in',  'A', 2)]),
      tx([line('card', 'out', 'A', 1)]),
    ];
    expect(getStock('A', txs)).toBe(1);
  });

  it('2 in 2 out → 0', () => {
    const txs = [
      tx([line('card', 'in',  'A', 2)]),
      tx([line('card', 'out', 'A', 2)]),
    ];
    expect(getStock('A', txs)).toBe(0);
  });

  it('numeric cardExternalId coerced to string', () => {
    const txs = [tx([line('card', 'in', '123', 3)])];
    expect(getStock(123, txs)).toBe(3);
  });

  it('ignores cash lines', () => {
    const txs = [tx([line('cash', 'in', 'A', 5)])];
    expect(getStock('A', txs)).toBe(0);
  });

  it('ignores sealed lines', () => {
    const txs = [tx([line('sealed', 'in', 'A', 5)])];
    expect(getStock('A', txs)).toBe(0);
  });

  it('handles transactions with no transactionLines', () => {
    const txs = [{ transactionLines: null }, { transactionLines: undefined }];
    expect(getStock('A', txs)).toBe(0);
  });

  it('accumulates across multiple transactions', () => {
    const txs = [
      tx([line('card', 'in', 'A', 3)]),
      tx([line('card', 'in', 'A', 2)]),
      tx([line('card', 'out', 'A', 1)]),
    ];
    expect(getStock('A', txs)).toBe(4);
  });
});
