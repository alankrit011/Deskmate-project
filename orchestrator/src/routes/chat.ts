/**
 * Express routes for the DeskMate orchestration service.
 *
 * POST /api/chat   — main endpoint, returns structured response
 * POST /api/debug  — same logic, returns  execution trace
 *
  * Each route validates the request body, logs the incoming request, and then
 */

import { Router, Request, Response } from "express";
import { runChat, ConversationMessage } from "../agent/deskmate";
import { get_logger } from "../logger";

const router = Router();
const logger = get_logger("chat-routes");

// ── Request validation helper ──────────────────────────────────────────────

interface ChatRequestBody {
  message?: string;
  employeeId?: string;
  history?: ConversationMessage[];
}

function validateChatBody(body: ChatRequestBody): { valid: boolean; error?: string } {
  if (!body.message || typeof body.message !== "string" || body.message.trim().length === 0) {
    return { valid: false, error: "message is required and must be a non-empty string" };
  }
  if (!body.employeeId || typeof body.employeeId !== "string") {
    return { valid: false, error: "employeeId is required" };
  }
  return { valid: true };
}

// ── POST /api/chat ─────────────────────────────────────────────────────────

router.post("/chat", async (req: Request, res: Response) => {
  const validation = validateChatBody(req.body);
  if (!validation.valid) {
    return res.status(400).json({
      error: "Bad Request",
      detail: validation.error,
    });
  }

  const { message, employeeId, history = [] } = req.body as Required<ChatRequestBody>;

  logger.info({
    event: "http_request",
    endpoint: "POST /api/chat",
    employeeId,
    message_preview: message.slice(0, 100),
  });

  try {
    const { response } = await runChat(message.trim(), employeeId.trim(), history);
    return res.json(response);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ event: "http_error", endpoint: "POST /api/chat", error: errMsg });
    return res.status(500).json({
      error: "Internal Server Error",
      detail: errMsg,
      answer: "Something went wrong on our end. Please try again.",
      tools_invoked: [],
      rag_context: [],
      errors: [errMsg],
    });
  }
});

// ── POST /api/debug ────────────────────────────────────────────────────────

router.post("/debug", async (req: Request, res: Response) => {
  const validation = validateChatBody(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: "Bad Request", detail: validation.error });
  }

  const { message, employeeId, history = [] } = req.body as Required<ChatRequestBody>;

  logger.info({
    event: "http_request",
    endpoint: "POST /api/debug",
    employeeId,
    message_preview: message.slice(0, 100),
  });

  try {
    const startTime = Date.now();
    const { response, trace } = await runChat(message.trim(), employeeId.trim(), history);

    // Debug response includes everything from /api/chat PLUS the full trace
    return res.json({
      ...response,
      debug: {
        raw_query: message,
        employee_id: employeeId,
        execution_trace: trace,
        total_latency_ms: Date.now() - startTime,
      },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ event: "http_error", endpoint: "POST /api/debug", error: errMsg });
    return res.status(500).json({ error: "Internal Server Error", detail: errMsg });
  }
});

export default router;
