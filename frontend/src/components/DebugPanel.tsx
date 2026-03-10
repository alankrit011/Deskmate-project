/**
 * DebugPanel — expandable section that shows the raw structured response.
 * This is the "debug/trace toggle" required by the spec.
 * It lets the interviewer see tools_invoked, rag_context, and errors at a glance.
 */

import { useState } from "react";
import type { ChatApiResponse } from "../types";

interface Props {
  response: ChatApiResponse;
}

export function DebugPanel({ response }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="debug-panel">
      <button className="debug-panel__toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▼" : "▶"} Debug / Trace {open ? "(hide)" : "(show)"}
      </button>

      {open && (
        <div className="debug-panel__content">
          {/* Tools invoked */}
          <section>
            <h4>Tools Invoked ({response.tools_invoked.length})</h4>
            {response.tools_invoked.length === 0 ? (
              <p className="muted">No tools called</p>
            ) : (
              response.tools_invoked.map((t, i) => (
                <details key={i} className="debug-panel__tool">
                  <summary>
                    <strong>{t.tool}</strong>
                  </summary>
                  <div className="debug-panel__json">
                    <div>
                      <span className="label">Input:</span>
                      <pre>{JSON.stringify(t.input, null, 2)}</pre>
                    </div>
                    <div>
                      <span className="label">Output:</span>
                      <pre>{JSON.stringify(t.output, null, 2)}</pre>
                    </div>
                  </div>
                </details>
              ))
            )}
          </section>

          {/* RAG context */}
          <section>
            <h4>RAG Context ({response.rag_context.length} chunks)</h4>
            {response.rag_context.length === 0 ? (
              <p className="muted">No knowledge base results</p>
            ) : (
              response.rag_context.map((r, i) => (
                <details key={i} className="debug-panel__rag">
                  <summary>
                    [{r.source}] similarity: {r.similarity.toFixed(3)}
                  </summary>
                  <pre className="debug-panel__chunk">{r.chunk}</pre>
                </details>
              ))
            )}
          </section>

          {/* Errors */}
          {response.errors.length > 0 && (
            <section>
              <h4>Errors</h4>
              {response.errors.map((e, i) => (
                <p key={i} className="error-text">
                  {e}
                </p>
              ))}
            </section>
          )}

          {/* Full debug trace (only on /api/debug responses) */}
          {response.debug && (
            <section>
              <h4>Execution Trace (total: {response.debug.total_latency_ms}ms)</h4>
              <pre className="debug-panel__trace">
                {JSON.stringify(response.debug.execution_trace, null, 2)}
              </pre>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
