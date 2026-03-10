/**
 * DeskMate Agent — Mastra-powered orchestration layer.
 *

 *
 * Flow for a single user message:
 *   1. Agent receives message + employeeId context
 *   2. LLM decides which tools to call (RAG, tickets, etc.)
 *   3. Tools execute and return results
 *   4. LLM synthesises a final answer using tool outputs
 *   5. We return structured JSON with answer + full trace
 */

import { Agent } from "@mastra/core/agent";
import type { Agent as AgentType } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { get_logger } from "../logger";
import {
  getEmployeeTickets,
  createSupportTicket,
  checkSoftwareEntitlement,
} from "../tools/ticketTools";

const logger = get_logger("deskmate-agent");

// ── LLM provider setup ─────────────────────────────────────────────────────
// We use Anthropic claude-sonnet-4-6 — strong reasoning for multi-step tool use
// and available via Azure OpenAI in production.
const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

// ── RAG tool — calls the Python FastAPI service ────────────────────────────
// Using createTool() from @mastra/core/tools — this is the correct Mastra 0.7.x API.
// The execute function receives args DIRECTLY (not wrapped in { context }).
const ragQueryTool = createTool({
  id: "rag_query",
  description:
    "Search the IT Knowledge Base (IT Handbook) for policy information, troubleshooting steps, or procedures. Use this whenever the user asks about IT policies, VPN issues, password resets, software access, hardware, or any question that might be answered by the handbook.",
  inputSchema: z.object({
    query: z.string().describe("The search query — be specific and use relevant IT keywords"),
    top_k: z.number().optional().default(3).describe("Number of results to return (1-5)"),
  }),
  execute: async ({ context }) => {
    const { query, top_k = 3 } = context;
    const start = Date.now();
    const ragUrl = process.env.RAG_SERVICE_URL ?? "http://localhost:8000";

    logger.info({ event: "rag_call_start", query, top_k });

    try {
      const response = await fetch(`${ragUrl}/rag/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, top_k }),
        signal: AbortSignal.timeout(10_000), // 10s timeout — fast fail if RAG is down
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ event: "rag_call_error", status: response.status, error: errorText, latency_ms: Date.now() - start });
        return { error: true, message: `RAG service returned status ${response.status}: ${errorText}`, results: [] };
      }

      const data = await response.json() as { results?: Array<{ chunk: string; source: string; similarity: number }>; error?: boolean; message?: string };
      logger.info({
        event: "rag_call_success",
        query,
        chunks_returned: data.results?.length ?? 0,
        similarity_scores: data.results?.map((r) => r.similarity) ?? [],
        latency_ms: Date.now() - start,
      });
      return data;
    } catch (err) {
      // Network error — Python service is probably down
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ event: "rag_call_network_error", error: msg, latency_ms: Date.now() - start });
      return { error: true, message: `Could not reach the RAG service: ${msg}. The knowledge base is temporarily unavailable.`, results: [] };
    }
  },
});

// ── Ticket tools — wrapped for Mastra ─────────────────────────────────────

const getTicketsTool = createTool({
  id: "getEmployeeTickets",
  description:
    "Look up all support tickets (open and resolved) for an employee. Use this when the user asks about their tickets, ticket status, or before creating a new ticket to check for duplicates.",
  inputSchema: z.object({
    employeeId: z.string().describe("The employee ID, e.g. E1001"),
  }),
  execute: async ({ context }) => {
    return getEmployeeTickets(context.employeeId);
  },
});

const createTicketTool = createTool({
  id: "createSupportTicket",
  description:
    "Create a new IT support ticket for an employee. Only call this after you have a clear subject AND description. If either is missing, ask the user for the information first.",
  inputSchema: z.object({
    employeeId: z.string().describe("The employee ID"),
    subject: z.string().describe("Short summary of the issue (at least 5 characters)"),
    description: z.string().describe("Detailed description of the issue (at least 10 characters)"),
    priority: z.enum(["Low", "Medium", "High", "Critical"]).optional().default("Medium").describe("Ticket priority"),
  }),
  execute: async ({ context }) => {
    return createSupportTicket(context.employeeId, context.subject, context.description, context.priority ?? "Medium");
  },
});

const softwareEntitlementTool = createTool({
  id: "checkSoftwareEntitlement",
  description:
    "Check whether an employee is entitled to use a specific software package and what approval is needed. Use this when the user asks about software access, licensing, or purchasing approvals.",
  inputSchema: z.object({
    employeeId: z.string().describe("The employee ID"),
    softwareName: z.string().describe("The name of the software to check"),
  }),
  execute: async ({ context }) => {
    return checkSoftwareEntitlement(context.employeeId, context.softwareName);
  },
});

// ── System prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are DeskMate, an AI-powered IT Help Desk Assistant for Black Box Network Services.

Your role is to help employees resolve IT issues by:
1. Searching the IT Knowledge Base for relevant policies and troubleshooting steps
2. Checking and creating support tickets when needed
3. Verifying software entitlements

GUIDELINES:
- Always search the knowledge base first when the user asks about IT policies, procedures, or troubleshooting
- Before creating a ticket, check if an open ticket already exists for the same issue
- If you need to create a ticket but the user hasn't provided enough detail, ask for clarification — do NOT create a vague ticket
- For out-of-scope questions (weather, personal topics, etc.), politely redirect: "I'm your IT assistant and can only help with IT-related topics."
- If the RAG service is unavailable, acknowledge it clearly and still try to help with ticket tools
- If no knowledge base results are relevant, say so honestly rather than guessing
- Be concise and helpful — employees want quick answers, not essays
- IMPORTANT: Always write your final answer in plain, clear English prose. Do NOT output raw document chunks, bullet symbols, markdown headers (# ##), pipes (|), or table syntax. Format your response as natural conversational text only.
- Use the conversation history to understand follow-up questions and maintain context across messages.

The employee's ID is provided in each request. Use it for ticket operations.`;

// ── Agent instance ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const deskmateAgent: AgentType<any> = new Agent({
  name: "DeskMate",
  instructions: SYSTEM_PROMPT,
  model: anthropic("claude-sonnet-4-6"),
  tools: {
    rag_query: ragQueryTool,
    getEmployeeTickets: getTicketsTool,
    createSupportTicket: createTicketTool,
    checkSoftwareEntitlement: softwareEntitlementTool,
  },
});

// ── Types for structured response ─────────────────────────────────────────

export interface ToolInvocation {
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
  latency_ms?: number;
}

export interface RagContext {
  chunk: string;
  source: string;
  similarity: number;
}

export interface ChatResponse {
  answer: string;
  tools_invoked: ToolInvocation[];
  rag_context: RagContext[];
  errors: string[];
}

// ── Main chat function ─────────────────────────────────────────────────────

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export async function runChat(
  message: string,
  employeeId: string,
  history: ConversationMessage[] = []
): Promise<{ response: ChatResponse; trace: object[] }> {
  const requestStart = Date.now();
  const trace: object[] = [];
  const tools_invoked: ToolInvocation[] = [];
  const rag_context: RagContext[] = [];
  const errors: string[] = [];

  // Build messages array: prior history + current user message with employeeId injected
  const messages: ConversationMessage[] = [
    ...history,
    { role: "user", content: `[Employee ID: ${employeeId}]\n\n${message}` },
  ];

  logger.info({
    event: "chat_request_start",
    employeeId,
    message,
  });

  trace.push({
    step: "input",
    employeeId,
    raw_message: message,
    timestamp: new Date().toISOString(),
  });

  try {
    // generate() runs the agent turn — Mastra handles tool-calling loops
    // until the LLM produces a final text response.
    const result = await deskmateAgent.generate(messages, {
      onStepFinish: (step: {
        toolCalls?: Array<{ toolName: string; args: Record<string, unknown> }>;
        toolResults?: Array<{ toolName: string; result: unknown }>;
        text?: string;
        usage?: { promptTokens: number; completionTokens: number };
      }) => {
        // onStepFinish fires after each tool call + result pair
        if (step.toolCalls && step.toolResults) {
          step.toolCalls.forEach((call, i) => {
            const result_data = step.toolResults![i];
            const invocation: ToolInvocation = {
              tool: call.toolName,
              input: call.args,
              output: result_data?.result,
            };
            tools_invoked.push(invocation);

            trace.push({
              step: "tool_call",
              tool: call.toolName,
              input: call.args,
              output: result_data?.result,
              timestamp: new Date().toISOString(),
            });

            // Extract RAG context from rag_query results
            if (call.toolName === "rag_query") {
              const ragResult = result_data?.result as {
                results?: Array<{ chunk: string; source: string; similarity: number }>;
                error?: boolean;
                message?: string;
              };
              if (ragResult?.results) {
                rag_context.push(...ragResult.results);
              }
              if (ragResult?.error) {
                errors.push(ragResult.message ?? "RAG service error");
              }
            }
          });
        }

        // Log final LLM step
        if (step.text) {
          trace.push({
            step: "llm_response",
            text_preview: step.text.slice(0, 200),
            usage: step.usage,
            timestamp: new Date().toISOString(),
          });
        }
      },
    });

    const totalLatency = Date.now() - requestStart;

    logger.info({
      event: "chat_request_complete",
      employeeId,
      tools_called: tools_invoked.map((t) => t.tool),
      total_latency_ms: totalLatency,
    });

    trace.push({
      step: "summary",
      total_latency_ms: totalLatency,
      tools_called_count: tools_invoked.length,
      rag_chunks_used: rag_context.length,
      errors_count: errors.length,
    });

    return {
      response: {
        answer: result.text,
        tools_invoked,
        rag_context,
        errors,
      },
      trace,
    };
  } catch (err) {
    const message_err = err instanceof Error ? err.message : String(err);
    logger.error({
      event: "chat_request_failed",
      error: message_err,
      latency_ms: Date.now() - requestStart,
    });
    errors.push(`Agent error: ${message_err}`);

    return {
      response: {
        answer:
          "I encountered an unexpected error and could not process your request. Please try again or contact IT support directly.",
        tools_invoked,
        rag_context,
        errors,
      },
      trace,
    };
  }
}
