/**
 * MessageBubble — renders a single chat message.
 * For assistant messages, includes the DebugPanel if an API response exists.
 */

import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "../types";
import { DebugPanel } from "./DebugPanel";

interface Props {
  message: ChatMessage;
  debugMode: boolean;
}

export function MessageBubble({ message, debugMode }: Props) {
  const isUser = message.role === "user";
  const isError = message.role === "error";

  return (
    <div className={`message message--${message.role}`}>
      <div className="message__header">
        <span className="message__role">
          {isUser ? "You" : isError ? "⚠ Error" : "🤖 DeskMate"}
        </span>
        <span className="message__time">
          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      <div className="message__content">
        {!isUser && !isError
          ? <ReactMarkdown>{message.content}</ReactMarkdown>
          : message.content}
      </div>

      {/* Show debug panel for assistant messages when debug mode is on */}
      {!isUser && !isError && message.apiResponse && debugMode && (
        <DebugPanel response={message.apiResponse} />
      )}
    </div>
  );
}
