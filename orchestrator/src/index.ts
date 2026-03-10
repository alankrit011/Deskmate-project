/**
 * DeskMate TypeScript Orchestration Service — entry point.
 *
 * Boots an Express server and mounts the /api routes.
 * All environment variables are loaded from .env before anything else.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import chatRouter from "./routes/chat";
import { get_logger } from "./logger";

const logger = get_logger("server");

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

// Allow the React dev server (port 5173) and any production origin to call us.
// In production this list would be locked to the known frontend domain.
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      process.env.FRONTEND_URL ?? "",
    ].filter(Boolean),
    methods: ["GET", "POST"],
  })
);

app.use(express.json({ limit: "1mb" }));

// ── Health check ───────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "deskmate-orchestrator",
    rag_service_url: process.env.RAG_SERVICE_URL ?? "http://localhost:8000",
  });
});

// ── API routes ─────────────────────────────────────────────────────────────
app.use("/api", chatRouter);

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info({
    event: "server_start",
    port: PORT,
    rag_service_url: process.env.RAG_SERVICE_URL ?? "http://localhost:8000",
    llm_model: "claude-sonnet-4-6",
  });
});
