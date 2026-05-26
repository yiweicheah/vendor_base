import { TextInput } from '@mantine/core';
import { useState, useEffect } from 'react';

function stripCommas(s) {
  return s.replace(/,/g, '');
}

function addCommas(s) {
  if (!s) return '';
  const [int, dec] = s.split('.');
  const formatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec !== undefined ? `${formatted}.${dec}` : formatted;
}

function numToStr(n) {
  const num = typeof n === 'number' ? n : parseFloat(n);
  return isNaN(num) || num === 0 ? '' : String(num);
}

export default function CurrencyInput({ value, onChange, ...props }) {
  const [raw, setRaw] = useState(() => numToStr(value));

  useEffect(() => {
    setRaw(numToStr(value));
  }, [value]);

  function handleChange(e) {
    const el = e.target;
    const cursorPos = el.selectionEnd;
    const prevDisplay = el.value;

    // Strip commas, allow only digits and one decimal point, max 2dp
    let cleaned = stripCommas(el.value).replace(/[^0-9.]/g, '');
    const dot = cleaned.indexOf('.');
    if (dot !== -1) {
      cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
      cleaned = cleaned.slice(0, dot + 3);
    }

    setRaw(cleaned);
    onChange?.(parseFloat(cleaned) || 0);

    // Restore cursor accounting for added/removed commas
    const newDisplay = addCommas(cleaned);
    const digitsBeforeCursor = stripCommas(prevDisplay.slice(0, cursorPos)).length;
    let newCursor = newDisplay.length;
    let count = 0;
    for (let i = 0; i < newDisplay.length; i++) {
      if (newDisplay[i] !== ',') count++;
      if (count === digitsBeforeCursor) { newCursor = i + 1; break; }
    }
    requestAnimationFrame(() => el.setSelectionRange(newCursor, newCursor));
  }

  return (
    <TextInput
      {...props}
      value={addCommas(raw)}
      onChange={handleChange}
      inputMode="decimal"
    />
  );
}
