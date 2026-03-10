/**
 * AgentActivityPanel — shown while the agent is processing.
 * Displays a spinner and a rotating set of status messages so the user
 * knows work is happening, not that the page is frozen.
 */

import { useEffect, useState } from "react";

const ACTIVITY_STEPS = [
  { icon: "🔍", label: "Searching IT Handbook..." },
  { icon: "🎫", label: "Looking up your tickets..." },
  { icon: "🤖", label: "Reasoning with AI agent..." },
  { icon: "📋", label: "Preparing your answer..." },
];

export function AgentActivityPanel() {
  const [stepIndex, setStepIndex] = useState(0);

  // Rotate through steps every 1.5s to simulate progressive work
  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex((prev) => (prev + 1) % ACTIVITY_STEPS.length);
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  const current = ACTIVITY_STEPS[stepIndex];

  return (
    <div className="agent-activity">
      <div className="agent-activity__spinner" />
      <span className="agent-activity__icon">{current.icon}</span>
      <span className="agent-activity__label">{current.label}</span>
    </div>
  );
}
