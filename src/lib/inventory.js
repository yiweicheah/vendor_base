/**
 * Derive current stock for a card from saved transaction history.
 * Returns null if cardExternalId is missing.
 */
export function getStock(cardExternalId, transactions) {
  if (!cardExternalId) return null;
  const id = String(cardExternalId);
  let count = 0;
  for (const tx of transactions) {
    for (const line of tx.transactionLines ?? []) {
      if (line.type === 'card' && String(line.cardExternalId) === id) {
        count += line.side === 'in' ? line.qty : -line.qty;
      }
    }
  }
  return count;
}
