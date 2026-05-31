/**
 * QuestionsBadge — open-question count badge on the QUESTIONS nav tab.
 * (adj-181.13)
 *
 * Mirrors the ChatBadge pattern: a small isolated component that subscribes
 * to useOpenQuestions() so re-renders from new WS question:new events are
 * scoped to this badge and do not force AppContent to re-render.
 *
 * Returns null when there are no open questions.
 */

import React from 'react';
import { useOpenQuestions } from '../../hooks/useOpenQuestions';

/**
 * Render the open-question count badge. Returns null when openCount is 0,
 * otherwise renders a small pill with the count (capped at "99+").
 */
export const QuestionsBadge = React.memo(function QuestionsBadge() {
  const { openCount } = useOpenQuestions();
  if (openCount <= 0) return null;
  return (
    <span className="nav-tab-badge">
      {openCount > 99 ? '99+' : openCount}
    </span>
  );
});
