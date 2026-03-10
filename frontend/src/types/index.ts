// Shared types mirroring the TypeScript orchestration service response shape.
// Keeping these in one file makes it easy to update if the API contract changes.

export interface ToolInvocation {
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
}

export interface RagContext {
  chunk: string;
  source: string;
  similarity: number;
}

export interface ChatApiResponse {
  answer: string;
  tools_invoked: ToolInvocation[];
  rag_context: RagContext[];
  errors: string[];
  // debug field is only present on /api/debug responses
  debug?: {
    raw_query: string;
    employee_id: string;
    execution_trace: object[];
    total_latency_ms: number;
  };
}

// Message shape for the chat history displayed in the UI
export type MessageRole = "user" | "assistant" | "error";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  apiResponse?: ChatApiResponse; // stored so the debug panel can show it
  timestamp: Date;
}

// Agent activity items shown while processing
export interface AgentActivity {
  icon: string;
  label: string;
}

// Conversation history sent to backend for context
export interface ConversationHistory {
  role: "user" | "assistant";
  content: string;
}
