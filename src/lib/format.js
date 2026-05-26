export function fmtMoney(n) {
  return (n ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function rm(n) {
  return `RM ${fmtMoney(Math.abs(n ?? 0))}`;
}
