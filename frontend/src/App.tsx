/**
 * DeskMate Chat Application — main component.
 *
 * State:
 *   messages    — full chat history
 *   input       — current text in the input box
 *   loading     — true while waiting for API response
 *   debugMode   — toggle to show/hide debug panels on assistant messages
 *   employeeId  — set once at the start (simulates authentication)
 *
 * The flow:
 *   1. User types a message and hits Send / Enter
 *   2. Message is appended to history immediately (optimistic UI)
 *   3. API call is made to /api/chat (or /api/debug if debugMode is on)
 *   4. Response is appended to history with the full structured payload
 *   5. If an error occurs, an error bubble is shown
 */

import { useState, useRef, useEffect, useCallback } from "react";
import type { ChatMessage, ChatApiResponse, ConversationHistory } from "./types";
import { sendMessage, sendDebugMessage } from "./api/chat";
import { MessageBubble } from "./components/MessageBubble";
import { AgentActivityPanel } from "./components/AgentActivityPanel";
import "./App.css";

let messageIdCounter = 0;
function newId(): string {
  return `msg-${++messageIdCounter}`;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: newId(),
  role: "assistant",
  content:
    "Hi! I'm DeskMate, your AI IT Help Desk Assistant. I can help you with VPN issues, password resets, software access, ticket management, and more. How can I help you today?",
  timestamp: new Date(),
};

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  // Default employee ID — in a real app this comes from SSO/auth
  const [employeeId] = useState("E1001");

  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");

    // Add user message immediately
    appendMessage({
      id: newId(),
      role: "user",
      content: text,
      timestamp: new Date(),
    });

    setLoading(true);

    try {
      // Build history from existing messages (user + assistant only, skip errors)
      const history: ConversationHistory[] = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      // Use /api/debug when debugMode is on — same logic, richer response
      const apiResponse: ChatApiResponse = debugMode
        ? await sendDebugMessage(text, employeeId, history)
        : await sendMessage(text, employeeId, history);

      appendMessage({
        id: newId(),
        role: "assistant",
        content: apiResponse.answer,
        apiResponse,
        timestamp: new Date(),
      });

      // If the API returned errors alongside the answer, show them
      if (apiResponse.errors.length > 0) {
        appendMessage({
          id: newId(),
          role: "error",
          content: `Note: ${apiResponse.errors.join("; ")}`,
          timestamp: new Date(),
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendMessage({
        id: newId(),
        role: "error",
        content: `Could not reach DeskMate: ${errMsg}. Make sure the backend services are running.`,
        timestamp: new Date(),
      });
    } finally {
      setLoading(false);
    }
  }, [input, loading, debugMode, employeeId, appendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Send on Enter, newline on Shift+Enter
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="app">
      {/* Header */}
      <header className="app__header">
        <div className="app__header-left">
          <span className="app__logo">🖥️</span>
          <div>
            <h1 className="app__title">DeskMate</h1>
            <p className="app__subtitle">AI IT Help Desk — {employeeId}</p>
          </div>
        </div>
        <label className="debug-toggle">
          <input
            type="checkbox"
            checked={debugMode}
            onChange={(e) => setDebugMode(e.target.checked)}
          />
          <span>Debug Mode</span>
        </label>
      </header>

      {/* Message history */}
      <main className="app__messages">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} debugMode={debugMode} />
        ))}

        {loading && <AgentActivityPanel />}

        <div ref={bottomRef} />
      </main>

      {/* Input area */}
      <footer className="app__input-area">
        <textarea
          className="app__textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about VPN, password resets, software access, tickets... (Enter to send)"
          disabled={loading}
          rows={2}
        />
        <button
          className="app__send-btn"
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          {loading ? "..." : "Send"}
        </button>
      </footer>
    </div>
  );
}
