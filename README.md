# DeskMate — AI IT Help Desk Assistant

An AI-powered IT Help Desk built as a dual-language microservices application:
- **Python** (FastAPI) for RAG — document ingestion, embeddings, semantic retrieval
- **TypeScript** (Express + Mastra) for agent orchestration and tool calling
- **React** (Vite + TypeScript) for the chat frontend

---

## Repository Structure

```
deskmate/
├── frontend/          # React chat UI (TypeScript)
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── orchestrator/      # TypeScript orchestration service
│   ├── src/
│   │   ├── agent/deskmate.ts    # Mastra agent + 4 tools
│   │   ├── routes/chat.ts       # /api/chat, /api/debug
│   │   ├── tools/ticketTools.ts # Mock IT system functions
│   │   ├── logger.ts
│   │   └── index.ts             # Express server entry point
│   ├── .env.example
│   ├── package.json
│   └── Dockerfile
├── rag-service/       # Python RAG microservice
│   ├── app/
│   │   ├── main.py          # FastAPI endpoints
│   │   ├── chunker.py       # Document chunking strategy
│   │   ├── embedder.py      # Sentence-transformers embeddings
│   │   ├── vector_store.py  # FAISS in-memory index
│   │   └── logger.py        # Structured JSON logger
│   ├── requirements.txt
│   └── Dockerfile
├── data/
│   └── IT_Handbook.txt    # IT knowledge base (57 chunks after ingestion)
├── DECISIONS.md           # 7 non-obvious technical decisions
├── docker-compose.yml     # Start all 3 services with one command
└── README.md
```

---

## Architecture Overview

```
React Frontend (port 5173 dev / 80 prod)
        │  HTTP POST /api/chat
        ▼
TypeScript Orchestration Service (port 3001)
  - Express routes validate the request
  - Mastra Agent (Claude claude-sonnet-4-6) decides which tools to call
  - Tools: rag_query | getEmployeeTickets | createSupportTicket | checkSoftwareEntitlement
        │  HTTP POST /rag/query
        ▼
Python RAG Service (port 8000)
  - FAISS vector store (in-memory, rebuilt on startup)
  - all-MiniLM-L6-v2 embeddings (runs locally, no API key needed)
  - Returns top-k chunks with similarity scores
```

**How services communicate:**
- Frontend → Orchestrator: HTTP REST on port 3001 (Vite proxy in dev, Nginx in prod)
- Orchestrator → RAG Service: HTTP REST on port 8000 (Docker internal network in prod)
- Mock IT tools run as in-process TypeScript functions inside the orchestrator

---

## Setup & Run — Local Development

### Prerequisites
- Node.js 20+
- Python 3.10+
- Anthropic API key — get one at https://console.anthropic.com

### Step 1 — Python RAG Service

```bash
cd rag-service
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Wait for:
```
Document ingested ... chunks_created: 57
Application startup complete.
```

Swagger UI: http://localhost:8000/docs

### Step 2 — TypeScript Orchestration Service

```bash
cd orchestrator
npm install
cp .env.example .env
# Open .env and set ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

Health check: http://localhost:3001/health

### Step 3 — React Frontend

```bash
cd frontend
npm install
npm run dev
```

Open: http://localhost:5173

> Start in order: RAG Service first → Orchestrator second → Frontend third

---

## Setup & Run — Docker Compose (One Command)

```bash
# From the deskmate/ root directory:
cp orchestrator/.env.example orchestrator/.env
# Edit orchestrator/.env — add your ANTHROPIC_API_KEY

docker-compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost |
| Orchestrator health | http://localhost:3001/health |
| RAG Swagger UI | http://localhost:8000/docs |

---

## Environment Variables

### orchestrator/.env

| Variable | Description | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key | **Required** |
| `RAG_SERVICE_URL` | URL of the Python RAG service | `http://localhost:8000` |
| `PORT` | Port for the orchestration service | `3001` |
| `FRONTEND_URL` | Frontend origin for CORS | `http://localhost:5173` |

### rag-service (optional override)

| Variable | Description | Default |
|---|---|---|
| `HANDBOOK_PATH` | Absolute path to IT_Handbook.txt | Auto-detected from repo structure |

---

## RAG Implementation

**Files:** `rag-service/app/chunker.py`, `embedder.py`, `vector_store.py`, `main.py`

**1. Chunking (`chunker.py`)**
The IT Handbook is split into ~400-character chunks with 80-character overlap. Splitting happens on paragraph/sentence boundaries first to keep chunks semantically coherent. Small chunks keep similarity scores focused; overlap prevents answers being cut at paragraph boundaries.

**2. Embedding (`embedder.py`)**
Uses `sentence-transformers/all-MiniLM-L6-v2` — a 22M-parameter model that runs locally with no API key required. It produces 384-dimension vectors. `normalize_embeddings=True` enables cosine similarity via inner product, which is what FAISS `IndexFlatIP` computes.

**3. Vector Store (`vector_store.py`)**
FAISS `IndexFlatIP` stores all chunk embeddings in memory. On service startup, `main.py` automatically ingests the IT Handbook so the store is populated before any request arrives.

**4. Retrieval**
`POST /rag/query` embeds the user query with the same model, runs a FAISS similarity search, and returns the top-k most relevant chunks with similarity scores. Every query is logged with: input, chunks returned, scores, and latency.

---

## Orchestration Approach

**File:** `orchestrator/src/agent/deskmate.ts`

Uses **Mastra** (`@mastra/core`) — chosen over LangChain.js because its tool API is simpler and maps directly to the Anthropic tool-calling spec, making it easy to explain in an interview.

The agent has 4 tools created with `createTool()`:

| Tool | What it does |
|---|---|
| `rag_query` | HTTP call to Python RAG service for handbook knowledge |
| `getEmployeeTickets` | Returns employee's tickets from mock in-memory store |
| `createSupportTicket` | Creates a ticket with validation (subject + description required) |
| `checkSoftwareEntitlement` | Returns entitlement status and approval tier |

Claude receives the user message + conversation history, reasons about intent, calls tools in sequence, and synthesises a final plain-English answer using all tool outputs.

The `/api/debug` endpoint returns the complete execution trace: every tool call with inputs/outputs, RAG chunks retrieved, similarity scores, and per-step latency.

---

## Screenshots

### 1. Ticket Creation — Outlook Not Syncing
Natural-language ticket creation with auto-assigned ID, priority, and inline troubleshooting steps.

![Ticket Creation](docs/screenshots/Screenshot%202026-03-10%20233102.png)

---

### 2. Software Entitlement Check — Adobe Creative Suite
Agent checks entitlement, reports access status, annual cost, approval path, and offers to raise a ticket to kick off the process.

![Software Entitlement](docs/screenshots/Screenshot%202026-03-10%20233314.png)

---

### 3. Multi-step Query — VPN + Ticket Check (the spec's example)
Single prompt triggers three tools in sequence: `rag_query` (handbook), `getEmployeeTickets` (existing tickets), and conditional `createSupportTicket`. Agent finds an existing ticket and skips duplicate creation.

![Multi-step VPN Query](docs/screenshots/Screenshot%202026-03-10%20233424.png)

---

## Failure Handling

| Scenario | Behaviour |
|---|---|
| RAG service unavailable | Network error caught, structured error returned, agent acknowledges gap and helps with ticket tools |
| No RAG results match | Agent says so honestly — does not hallucinate handbook content |
| Ticket created without enough detail | Tool returns validation error, agent asks user for clarification |
| Out-of-scope query (weather, etc.) | System prompt instructs agent to politely redirect to IT topics |
| Tool throws an exception | Caught in `runChat()`, added to `errors[]`, agent continues gracefully |
| Unknown employeeId | `getEmployeeTickets` returns empty array, agent offers to create a first ticket |
| Python service down at startup | Warning logged, service continues — handbook can be ingested manually via `POST /rag/ingest` |
