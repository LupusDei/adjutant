import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { api } from '../../services/api';
import { useDeploymentMode } from '../../hooks/useDeploymentMode';
import type { CrewMember } from '../../types';

/**
 * Props for the RecipientSelector component.
 */
export interface RecipientSelectorProps {
  /** Currently selected recipient address */
  value: string;
  /** Callback when recipient is selected */
  onChange: (address: string) => void;
  /** Whether the selector is disabled */
  disabled?: boolean;
  /** Optional CSS class name */
  className?: string;
}

/**
 * Pip-Boy styled recipient selector with autocomplete functionality.
 * Fetches available agents and provides dropdown selection with type-ahead filter.
 */
export function RecipientSelector({
  value,
  onChange,
  disabled = false,
  className = '',
}: RecipientSelectorProps) {
  const [agents, setAgents] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get deployment mode for coordinator selection
  const { isGasTown } = useDeploymentMode();

  // Fetch agents on mount
  useEffect(() => {
    let mounted = true;

    const fetchAgents = async () => {
      try {
        const data = await api.agents.list();
        if (mounted) {
          // Add special entries based on deployment mode
          const specialRecipients: CrewMember[] = isGasTown
            ? [
                {
                  id: 'mayor/',
                  name: 'Mayor',
                  type: 'mayor',
                  rig: null,
                  status: 'idle',
                  unreadMail: 0,
                },
                {
                  id: 'overseer',
                  name: 'Overseer (Human)',
                  type: 'crew',
                  rig: null,
                  status: 'idle',
                  unreadMail: 0,
                },
              ]
            : [
                {
                  id: 'user',
                  name: 'User',
                  type: 'user',
                  rig: null,
                  status: 'idle',
                  unreadMail: 0,
                },
              ];
          setAgents([...specialRecipients, ...data]);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load agents');
          setLoading(false);
        }
      }
    };

    void fetchAgents();
    return () => { mounted = false; };
  }, [isGasTown]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => { document.removeEventListener('mousedown', handleClickOutside); };
  }, []);

  // Filter agents based on input
  const filteredAgents = agents.filter(agent => {
    const searchTerm = filter.toLowerCase();
    return (
      agent.name.toLowerCase().includes(searchTerm) ||
      agent.id.toLowerCase().includes(searchTerm) ||
      agent.type.toLowerCase().includes(searchTerm)
    );
  });

  // Get display name for selected value
  const getDisplayName = (address: string): string => {
    const agent = agents.find(a => a.id === address);
    return agent ? agent.name : address || 'Select recipient...';
  };

  const handleSelect = (agent: CrewMember) => {
    onChange(agent.id);
    setFilter('');
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(e.target.value);
    if (!isOpen) setIsOpen(true);
  };

  const handleInputFocus = () => {
    if (!disabled) setIsOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setFilter('');
    } else if (e.key === 'Enter' && filteredAgents.length === 1 && filteredAgents[0]) {
      handleSelect(filteredAgents[0]);
    }
  };

  // Get icon for agent type
  const getAgentIcon = (type: CrewMember['type']): string => {
    switch (type) {
      // Gas Town roles
      case 'mayor': return '👑';
      case 'deacon': return '⚙';
      case 'witness': return '👁';
      case 'refinery': return '🔧';
      case 'crew': return '👤';
      case 'polecat': return '🐾';
      // Standalone roles
      case 'user': return '👤';
      case 'agent': return '🤖';
      default: return '•';
    }
  };

  if (loading) {
    return (
      <div style={styles.container} className={className}>
        <div style={styles.loadingBadge}>◌ LOADING...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container} className={className}>
        <div style={styles.errorBadge}>⚠ {error}</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={styles.container}
      className={className}
    >
      <label style={styles.label} htmlFor="recipient-input">
        TO:
      </label>
      <div style={styles.inputContainer}>
        <input
          ref={inputRef}
          id="recipient-input"
          type="text"
          style={styles.input}
          value={isOpen ? filter : getDisplayName(value)}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Select recipient..."
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls="recipient-listbox"
        />
        <button
          type="button"
          style={styles.dropdownButton}
          onClick={() => { if (!disabled) setIsOpen(!isOpen); }}
          disabled={disabled}
          aria-label={isOpen ? 'Close recipient list' : 'Open recipient list'}
        >
          {isOpen ? '▲' : '▼'}
        </button>
      </div>

      {isOpen && (
        <ul
          id="recipient-listbox"
          role="listbox"
          style={styles.dropdown}
          aria-label="Available recipients"
        >
          {filteredAgents.length === 0 ? (
            <li style={styles.emptyItem}>No matching recipients</li>
          ) : (
            filteredAgents.map(agent => (
              <li
                key={agent.id}
                role="option"
                aria-selected={agent.id === value}
                style={{
                  ...styles.dropdownItem,
                  ...(agent.id === value ? styles.dropdownItemSelected : {}),
                }}
                onClick={() => { handleSelect(agent); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSelect(agent); }}
                tabIndex={0}
              >
                <span style={styles.agentIcon}>{getAgentIcon(agent.type)}</span>
                <span style={styles.agentName}>{agent.name}</span>
                <span style={styles.agentAddress}>{agent.id}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// Pip-Boy color palette (matching ComposeMessage)
const colors = {
  primary: 'var(--crt-phosphor)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
  background: '#0A0A0A',
  backgroundDark: '#050505',
  error: '#FF4444',
} as const;

const styles = {
  container: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
  },

  label: {
    fontSize: '0.75rem',
    color: colors.primaryDim,
    letterSpacing: '0.1em',
    whiteSpace: 'nowrap',
  },

  inputContainer: {
    flex: 1,
    display: 'flex',
    alignItems: 'stretch',
  },

  input: {
    flex: 1,
    padding: '6px 10px',
    background: 'transparent',
    border: `1px solid ${colors.primaryDim}`,
    borderRight: 'none',
    borderRadius: '2px 0 0 2px',
    color: colors.primary,
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    outline: 'none',
  },

  dropdownButton: {
    padding: '6px 10px',
    background: 'transparent',
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '0 2px 2px 0',
    color: colors.primary,
    fontFamily: 'inherit',
    fontSize: '0.7rem',
    cursor: 'pointer',
  },

  dropdown: {
    position: 'absolute',
    top: '100%',
    left: '28px',
    right: '0',
    marginTop: '4px',
    padding: '4px 0',
    background: colors.backgroundDark,
    border: `1px solid ${colors.primary}`,
    borderRadius: '2px',
    boxShadow: `0 4px 12px rgba(0,0,0,0.5), 0 0 8px ${colors.primaryGlow}`,
    listStyle: 'none',
    maxHeight: '200px',
    overflowY: 'auto',
    zIndex: 100,
  },

  dropdownItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    cursor: 'pointer',
    transition: 'background-color 0.1s',
    color: colors.primary,
    fontSize: '0.8rem',
  },

  dropdownItemSelected: {
    background: 'transparent',
    borderLeft: `4px solid ${colors.primary}`,
    paddingLeft: '10px',
    boxShadow: `inset 4px 0 8px -4px ${colors.primaryGlow}`,
  },

  emptyItem: {
    padding: '12px',
    color: colors.primaryDim,
    fontStyle: 'italic',
    fontSize: '0.8rem',
    textAlign: 'center',
  },

  agentIcon: {
    fontSize: '0.9rem',
    width: '20px',
    textAlign: 'center',
  },

  agentName: {
    flex: 1,
    fontWeight: 'bold',
  },

  agentAddress: {
    fontSize: '0.7rem',
    color: colors.primaryDim,
    opacity: 0.8,
  },

  loadingBadge: {
    padding: '6px 12px',
    fontSize: '0.75rem',
    color: colors.primaryDim,
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    animation: 'pulse 1.5s ease-in-out infinite',
  },

  errorBadge: {
    padding: '6px 12px',
    fontSize: '0.75rem',
    color: colors.error,
    border: `1px solid ${colors.error}`,
    borderRadius: '2px',
  },
} satisfies Record<string, CSSProperties>;

export default RecipientSelector;
