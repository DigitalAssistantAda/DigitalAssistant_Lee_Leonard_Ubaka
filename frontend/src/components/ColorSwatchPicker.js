import React from 'react';
import './ColorSwatchPicker.css';

const normalizeHex = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
};

function ColorSwatchPicker({
  colors,
  value,
  onChange,
  ariaLabel = 'Color options',
  optionAriaLabelPrefix = 'Select color',
  customAriaLabel = 'Choose custom color',
  customTitle = 'Choose custom color',
  className = '',
}) {
  const selected = normalizeHex(value);

  return (
    <div className={`swatch-picker ${className}`.trim()} role="listbox" aria-label={ariaLabel}>
      {colors.map((color) => {
        const normalized = normalizeHex(color);
        const active = selected === normalized;
        return (
          <button
            key={color}
            type="button"
            className={`swatch-picker-item ${active ? 'active' : ''}`}
            style={{ background: color }}
            onClick={() => onChange(color)}
            title={`${optionAriaLabelPrefix} ${color}`}
            aria-label={`${optionAriaLabelPrefix} ${color}`}
            aria-pressed={active}
          />
        );
      })}

      <label className="swatch-picker-custom" title={customTitle}>
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={customAriaLabel}
        />
      </label>
    </div>
  );
}

export default ColorSwatchPicker;