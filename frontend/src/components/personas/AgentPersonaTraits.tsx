/**
 * AgentPersonaTraits (adj-158.5.2) — an agent's persona shown where the agent is.
 *
 * The web dashboard shipped the persona BADGE but never the trait display, so an
 * agent's disposition was invisible on the web even though iOS renders a full
 * radar plus a per-category breakdown (AgentDetailView `personaTabContent`). This
 * is the web half, against the same finished backend, reusing the existing
 * RadarChart rather than inventing a second visual language for the same data.
 *
 * Lazy by design: the overview page renders many agent rows, and eagerly loading
 * every agent's persona would be a burst of requests for data almost none of
 * which is being looked at. The fetch happens when this mounts — i.e. when a row
 * is actually expanded.
 */
import { useEffect, useState } from 'react';

import { RadarChart } from './RadarChart';
import { api } from '../../services/api';
import { TRAIT_DISPLAY, TRAIT_GROUPS, type Persona } from '../../types';

interface AgentPersonaTraitsProps {
  /** The persona to display. Changing it refetches. */
  personaId: string;
}

export function AgentPersonaTraits({ personaId }: AgentPersonaTraitsProps) {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // `cancelled` closes the stale-response race: on a fast row switch a slow
    // response for the PREVIOUS personaId can resolve after the new one and
    // would otherwise overwrite it with the wrong agent's traits.
    let cancelled = false;

    setPersona(null);
    setFailed(false);

    api.personas
      .get(personaId)
      .then((result) => {
        if (!cancelled) setPersona(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [personaId]);

  if (failed) {
    return <div className="agent-persona-traits agent-persona-traits-error">PERSONA UNAVAILABLE</div>;
  }

  if (!persona) {
    return <div className="agent-persona-traits agent-persona-traits-loading">LOADING PERSONA…</div>;
  }

  return (
    <div className="agent-persona-traits">
      <div className="agent-persona-traits-header">
        <RadarChart traits={persona.traits} size={72} />
        <div className="agent-persona-traits-identity">
          <span className="agent-persona-traits-name">{persona.name}</span>
          {persona.description && (
            <span className="agent-persona-traits-description">{persona.description}</span>
          )}
        </div>
      </div>

      <div className="agent-persona-traits-groups">
        {TRAIT_GROUPS.map((group) => (
          <div key={group.key} className="agent-persona-traits-group">
            <span className="agent-persona-traits-group-label">{group.label}</span>
            {group.traits.map((trait) => (
              <div key={trait} className="agent-persona-traits-row">
                <span className="agent-persona-traits-label">{TRAIT_DISPLAY[trait].label}</span>
                <span className="agent-persona-traits-value">{persona.traits[trait]}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
