import { TextInput } from '@mantine/core';
import { useState, useEffect } from 'react';

const toCents = (n) => {
  const num = typeof n === 'number' ? n : parseFloat(n);
  return Math.round(isNaN(num) ? 0 : num * 100);
};

export default function CurrencyInput({ value, onChange, ...props }) {
  const [cents, setCents] = useState(() => toCents(value));

  useEffect(() => {
    setCents(toCents(value));
  }, [value]);

  const display = (cents / 100).toFixed(2);

  function handleKeyDown(e) {
    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault();
      const next = cents * 10 + parseInt(e.key, 10);
      if (next <= 99999999999) {
        setCents(next);
        onChange?.(next / 100);
      }
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      const next = Math.floor(cents / 10);
      setCents(next);
      onChange?.(next / 100);
    }
  }

  function handlePaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const parsed = parseFloat(text.replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed)) {
      const next = Math.min(Math.round(parsed * 100), 99999999999);
      setCents(next);
      onChange?.(next / 100);
    }
  }

  return (
    <TextInput
      {...props}
      value={display}
      onChange={() => {}}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      inputMode="numeric"
    />
  );
}
