/**
 * OverseerToggle Component
 * A toggle switch for filtering to overseer-relevant items.
 * Persists state to localStorage.
 */
import React, { useEffect, useState } from 'react';
import './OverseerToggle.css';

export interface OverseerToggleProps {
  /** Storage key for localStorage persistence */
  storageKey: string;
  /** Callback when toggle state changes */
  onChange: (enabled: boolean) => void;
  /** Optional label override */
  label?: string;
}

/**
 * Toggle switch for overseer view filtering.
 * Persists preference to localStorage.
 */
export const OverseerToggle: React.FC<OverseerToggleProps> = ({
  storageKey,
  onChange,
  label = 'OVERSEER VIEW',
}) => {
  const [enabled, setEnabled] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored === 'true';
  });

  // Notify parent on initial mount
  useEffect(() => {
    onChange(enabled);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = () => {
    const newValue = !enabled;
    setEnabled(newValue);
    localStorage.setItem(storageKey, String(newValue));
    onChange(newValue);
  };

  return (
    <button
      type="button"
      className={`overseer-toggle ${enabled ? 'overseer-toggle-active' : ''}`}
      onClick={handleToggle}
      title={enabled ? 'Showing overseer-relevant items only' : 'Showing all items'}
    >
      <span className="overseer-toggle-icon">{enabled ? '◉' : '○'}</span>
      <span className="overseer-toggle-label">{label}</span>
    </button>
  );
};

export default OverseerToggle;
