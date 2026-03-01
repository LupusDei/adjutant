/**
 * ChatAgentSelector - Agent picker for the chat view.
 * Simplified replacement for the removed mail/RecipientSelector.
 */
import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties } from 'react';
import { api } from '../../services/api';
import type { CrewMember } from '../../types';

export interface ChatAgentSelectorProps {
  value: string;
  onChange: (agentId: string) => void;
  unreadCounts?: Record<string, number>;
}

export function ChatAgentSelector({ value, onChange, unreadCounts }: ChatAgentSelectorProps) {
  const [agents, setAgents] = useState<CrewMember[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch agents on mount
  useEffect(() => {
    void api.agents.list().then(setAgents).catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => { document.removeEventListener('mousedown', handleClick); };
  }, []);

  const filteredAgents = useMemo(() => {
    if (!filter) return agents;
    const lower = filter.toLowerCase();
    return agents.filter(a =>
      a.name.toLowerCase().includes(lower) || a.id.toLowerCase().includes(lower)
    );
  }, [agents, filter]);

  const selectedAgent = useMemo(
    () => agents.find(a => a.id === value || a.name === value),
    [agents, value]
  );

  const handleSelect = useCallback((agentId: string) => {
    onChange(agentId);
    setIsOpen(false);
    setFilter('');
  }, [onChange]);

  const displayLabel = selectedAgent?.name.toUpperCase() ?? (value || 'SELECT AGENT');
  const unread = value && unreadCounts ? (unreadCounts[value] ?? 0) : 0;

  return (
    <div ref={containerRef} style={styles.container}>
      <button
        type="button"
        style={styles.trigger}
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) setTimeout(() => { inputRef.current?.focus(); }, 50);
        }}
      >
        <span style={styles.label}>TO:</span>
        <span style={styles.selected}>{displayLabel}</span>
        {unread > 0 && <span style={styles.badge}>{unread}</span>}
        <span style={styles.arrow}>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div style={styles.dropdown}>
          <input
            ref={inputRef}
            type="text"
            value={filter}
            onChange={(e) => { setFilter(e.target.value); }}
            placeholder="FILTER..."
            style={styles.filterInput}
          />
          <div style={styles.list}>
            {/* User/broadcast option */}
            <button
              type="button"
              style={{
                ...styles.option,
                ...(value === 'user' ? styles.optionSelected : {}),
              }}
              onClick={() => { handleSelect('user'); }}
            >
              <span>USER (BROADCAST)</span>
            </button>
            {filteredAgents.map((agent) => {
              const count = unreadCounts?.[agent.id] ?? 0;
              const isSelected = value === agent.id || value === agent.name;
              return (
                <button
                  key={agent.id}
                  type="button"
                  style={{
                    ...styles.option,
                    ...(isSelected ? styles.optionSelected : {}),
                  }}
                  onClick={() => { handleSelect(agent.id); }}
                >
                  <span>{agent.name.toUpperCase()}</span>
                  {count > 0 && <span style={styles.optionBadge}>{count}</span>}
                </button>
              );
            })}
            {filteredAgents.length === 0 && (
              <div style={styles.empty}>NO AGENTS FOUND</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    position: 'relative',
    fontFamily: '"Share Tech Mono", monospace',
  } as CSSProperties,

  trigger: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '6px 10px',
    background: 'transparent',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor)',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    cursor: 'pointer',
    textAlign: 'left',
  } as CSSProperties,

  label: {
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
    flexShrink: 0,
  },

  selected: {
    flex: 1,
    letterSpacing: '0.1em',
  },

  badge: {
    background: 'var(--crt-phosphor)',
    color: '#0A0A0A',
    fontSize: '0.65rem',
    fontWeight: 'bold',
    padding: '1px 5px',
    borderRadius: '2px',
  },

  arrow: {
    fontSize: '0.6rem',
    color: 'var(--crt-phosphor-dim)',
  },

  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    zIndex: 100,
    background: '#0A0A0A',
    border: '1px solid var(--crt-phosphor-dim)',
    borderTop: 'none',
    maxHeight: '300px',
    display: 'flex',
    flexDirection: 'column',
  } as CSSProperties,

  filterInput: {
    padding: '6px 10px',
    background: '#050505',
    border: 'none',
    borderBottom: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor)',
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    outline: 'none',
  } as CSSProperties,

  list: {
    overflowY: 'auto',
    maxHeight: '250px',
  } as CSSProperties,

  option: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '6px 10px',
    background: 'transparent',
    border: 'none',
    color: 'var(--crt-phosphor)',
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    cursor: 'pointer',
    textAlign: 'left',
    letterSpacing: '0.05em',
  } as CSSProperties,

  optionSelected: {
    background: 'rgba(0, 255, 0, 0.1)',
    color: 'var(--crt-phosphor-bright)',
  },

  optionBadge: {
    background: 'var(--crt-phosphor)',
    color: '#0A0A0A',
    fontSize: '0.6rem',
    fontWeight: 'bold',
    padding: '1px 4px',
    borderRadius: '2px',
  },

  empty: {
    padding: '12px',
    textAlign: 'center',
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.75rem',
  } as CSSProperties,
};
