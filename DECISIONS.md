# DECISIONS.md — DeskMate Technical Decisions

This document explains 5+ non-obvious technical decisions made during the design and implementation of DeskMate.

---

## 1. Why FAISS over ChromaDB for the vector store

**Decision:** Use FAISS (Facebook AI Similarity Search) as the in-process vector store.

**Why not ChromaDB?**
ChromaDB runs as a separate process (or embedded SQLite), which adds startup complexity and an extra dependency for a demo. FAISS is a pure in-memory library: import it, create an index, add vectors. There is no server to start, no migration to run.

**Trade-off:** FAISS does not persist to disk by default — the index lives in memory and is rebuilt on startup by re-ingesting the handbook. For a PoC this is acceptable and actually desirable (clean state every run). In production we would switch to Azure AI Search which supports persistent, scalable vector indexing with zero infrastructure management.

---

## 2. Why chunk size 400 characters with 80-character overlap

**Decision:** Split documents into ~400-character chunks with an 80-character sliding overlap.

**Rationale:**
- **400 characters (~70–80 words)** is small enough that a single chunk stays focused on one topic (e.g., "VPN troubleshooting" vs. "password policy"), which keeps similarity scores meaningful. Larger chunks (>1000 chars) retrieve too much text and dilute the semantic signal.
- **80-character overlap** ensures that sentences split at a boundary are fully captured in at least one chunk, preventing answers from being cut off mid-instruction.
- We split on paragraph/sentence boundaries where possible (newlines first) rather than hard character cuts, so chunks are coherent prose rather than truncated mid-sentence.

**Alternative considered:** Token-based chunking (e.g., 200 tokens). Token counts are more accurate for LLM context windows but require a tokenizer dependency. Character counts are fast, deterministic, and sufficient for this use case.

---

## 3. Why sentence-transformers (all-MiniLM-L6-v2) for embeddings

**Decision:** Use the `sentence-transformers/all-MiniLM-L6-v2` model via the `sentence-transformers` Python library instead of the OpenAI Embeddings API.

**Why:**
- **No API key required** — the model runs locally, so the demo works offline and has no cost per embedding.
- **Fast** — MiniLM-L6 is a distilled 22M-parameter model that runs in ~50ms per batch on CPU.
- **Good quality** — it was specifically trained for semantic similarity tasks (exactly what RAG retrieval needs).

**Trade-off vs. OpenAI `text-embedding-3-small`:** OpenAI embeddings have a larger dimension (1536 vs 384) and slightly better accuracy on out-of-domain text. For a single IT handbook, MiniLM is more than sufficient. In production on Azure we would use Azure OpenAI `text-embedding-3-small` to avoid the cold-start download of the MiniLM model weights.

---

## 4. Why Mastra over LangChain.js for TypeScript orchestration

**Decision:** Use Mastra as the agent framework for the TypeScript service.

**Why Mastra:**
- Mastra's `Agent` class maps directly to the interview requirement: define tools with Zod schemas, attach to an agent, let the LLM decide when to call them. The abstraction is thin and explicit — every line can be explained on the spot.
- Mastra uses the Vercel AI SDK (`ai` package) under the hood, which gives native support for Anthropic Claude's tool-calling API without a separate adapter.
- LangChain.js is more powerful but significantly more abstract (chains, runnables, memory, LCEL syntax). For a demo that will be walked through live, fewer abstraction layers = fewer "what does this do?" moments.

**Trade-off:** Mastra's ecosystem is younger and has less community content than LangChain. For production systems with complex memory, evaluation pipelines, or multi-agent graphs, LangChain/LangGraph would be a stronger choice.

---

## 5. Why multi-step tool ordering: RAG first, then tickets

**Decision:** The system prompt instructs the agent to search the knowledge base *before* checking tickets.

**Why this order matters:**
- Users often describe a problem (VPN disconnecting) and separately ask about tickets. If we look up tickets first, the agent wastes a round-trip on ticket data that is irrelevant to the policy question.
- RAG results inform the ticket description: if we know the handbook says "VPN issues require L2 escalation", the agent can create a more accurate ticket with that context already in hand.
- The agent is not hard-coded to this order — the LLM can deviate if the user's intent is clearly ticket-only (e.g., "show me my open tickets"). The prompt nudges the default behavior without constraining agentic flexibility.

---

## 6. Why FastAPI auto-ingests the handbook on startup

**Decision:** The RAG service calls `_ingest_file()` during the `startup` event, so the vector store is populated before any requests arrive.

**Why:** Without auto-ingest, the TypeScript orchestrator would need to call `POST /rag/ingest` before any query — adding an initialization choreography step that's easy to forget and confusing in a demo. Auto-ingest means "docker-compose up" is the entire setup.

**Trade-off:** If the handbook is large and the service restarts frequently, re-embedding on every startup costs time. In production, we would persist the FAISS index to Azure Blob Storage and reload it on startup instead of re-embedding.

---

## 7. Why structured JSON logging in both services

**Decision:** Both the Python (RAG) and TypeScript (orchestrator) services emit JSON lines to stdout.

**Why JSON lines:**
- Azure Monitor / Log Analytics ingests JSON natively — no parsing regex required.
- Every log entry is self-contained: timestamp, level, service, event name, and all relevant fields in a single line. This lets you `grep` for a specific `employeeId` or `ticketId` across both service logs and reconstruct a full request trace.
- Structured logs make the `/api/debug` endpoint easy to implement: we collect the same structured data already being logged and return it as a response field.
