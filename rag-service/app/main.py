"""
DeskMate RAG Microservice — FastAPI entry point.

Why FastAPI over Flask?
- FastAPI provides automatic OpenAPI docs (Swagger UI at /docs) out of the box,
  which is invaluable for debugging during development and demo time.
- Native async support means IO-bound work (e.g., future DB calls) won't block
  the event loop. Flask requires extra setup (Quart or async views) for the same.
- Pydantic model validation is built in — request/response schemas are defined
  once and validated automatically, reducing boilerplate and surface area for bugs.

Service responsibilities:
  POST /rag/ingest  — chunk + embed + store a document
  POST /rag/query   — semantic search against the vector store
  GET  /rag/health  — vector store state (bonus endpoint)
"""

import os
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.chunker import chunk_text
from app.embedder import embed_texts, embed_query
from app.vector_store import get_store
from app.logger import get_logger

logger = get_logger("rag-service")

app = FastAPI(
    title="DeskMate RAG Service",
    description="Python microservice handling document ingestion, embedding, and semantic retrieval",
    version="1.0.0",
)

# Allow the TypeScript orchestrator (and the React dev server) to call this service.
# In production this would be locked down to the internal service mesh CIDR.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response models ──────────────────────────────────────────────────

class IngestRequest(BaseModel):
    # Optional — if omitted we fall back to the default handbook path.
    # This lets the TypeScript service trigger re-ingestion without knowing
    # the filesystem layout of the RAG container.
    file_path: str = Field(
        default="",
        description="Absolute path to the document to ingest. Leave empty to use the default IT_Handbook.txt",
    )


class IngestResponse(BaseModel):
    status: str
    chunks_created: int
    source: str
    embedding_time_ms: float


class QueryRequest(BaseModel):
    query: str = Field(..., min_length=1, description="Natural-language question to search")
    top_k: int = Field(default=3, ge=1, le=10, description="Number of results to return")


class QueryResult(BaseModel):
    chunk: str
    source: str
    similarity: float


class QueryResponse(BaseModel):
    results: list[QueryResult]
    query: str
    latency_ms: float


# ── Default handbook path ──────────────────────────────────────────────────────
# We look for the file relative to the project root so the service works both
# inside Docker (where data/ is mounted) and in local dev.
DEFAULT_HANDBOOK_PATH = os.environ.get(
    "HANDBOOK_PATH",
    # From deskmate/rag-service/app/main.py → parents[2] = deskmate/ → data/IT_Handbook.txt
    str(Path(__file__).resolve().parents[2] / "data" / "IT_Handbook.txt"),
)


# ── Startup: auto-ingest the handbook so the service is ready immediately ──────
@app.on_event("startup")
async def auto_ingest_handbook():
    """
    Automatically ingest the IT Handbook when the service starts.
    This means the TypeScript orchestrator can start querying immediately
    without needing to call /rag/ingest first.
    """
    handbook_path = DEFAULT_HANDBOOK_PATH
    if os.path.exists(handbook_path):
        logger.info(
            "Auto-ingesting IT Handbook on startup",
            extra={"extra_data": {"path": handbook_path}},
        )
        await _ingest_file(handbook_path)
    else:
        logger.warning(
            "IT Handbook not found at startup path — call /rag/ingest manually",
            extra={"extra_data": {"expected_path": handbook_path}},
        )


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.post("/rag/ingest", response_model=IngestResponse)
async def ingest(request: IngestRequest):
    """
    Ingest a document: chunk it, embed the chunks, store in FAISS.
    """
    file_path = request.file_path or DEFAULT_HANDBOOK_PATH

    if not os.path.exists(file_path):
        logger.error(
            "Ingest failed — file not found",
            extra={"extra_data": {"file_path": file_path}},
        )
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    chunks_created = await _ingest_file(file_path)
    return IngestResponse(
        status="success",
        chunks_created=chunks_created,
        source=os.path.basename(file_path),
        # We log the real timing inside _ingest_file; this field is informational
        embedding_time_ms=0.0,
    )


async def _ingest_file(file_path: str) -> int:
    """
    Internal helper: read a file, chunk, embed, add to the vector store.
    Separated from the endpoint so startup auto-ingest and manual ingest
    share the same code path.
    """
    start = time.perf_counter()

    with open(file_path, "r", encoding="utf-8") as f:
        text = f.read()

    source_name = os.path.basename(file_path)

    # Chunk the document using our sliding-window strategy
    chunks = chunk_text(text)

    # Embed all chunks in a single batch call — this is much faster than
    # embedding one chunk at a time because the model can parallelise internally
    embeddings = embed_texts(chunks)

    store = get_store()
    count = store.add_chunks(chunks, embeddings, source=source_name)

    elapsed_ms = (time.perf_counter() - start) * 1000

    logger.info(
        "Document ingested",
        extra={
            "extra_data": {
                "event": "rag_ingest",
                "source": source_name,
                "chunks_created": count,
                "embedding_time_ms": round(elapsed_ms, 2),
            }
        },
    )

    return count


@app.post("/rag/query", response_model=QueryResponse)
async def query(request: QueryRequest):
    """
    Semantic search: find the top_k most relevant chunks for the query.
    """
    start = time.perf_counter()
    store = get_store()

    if store.index.ntotal == 0:
        # The store hasn't been populated yet — return a structured error
        # rather than crashing so the TypeScript service can handle it gracefully
        logger.warning(
            "Query received but vector store is empty",
            extra={"extra_data": {"query": request.query}},
        )
        raise HTTPException(
            status_code=503,
            detail="Vector store is empty. Please call /rag/ingest first.",
        )

    # Embed the query with the same model used for ingestion — if they differ,
    # similarity scores become meaningless
    query_embedding = embed_query(request.query)
    raw_results = store.search(query_embedding, top_k=request.top_k)

    elapsed_ms = (time.perf_counter() - start) * 1000

    # Structured log entry for every query — enables tracing in Azure Monitor
    logger.info(
        "RAG query completed",
        extra={
            "extra_data": {
                "event": "rag_query",
                "query": request.query,
                "top_k": request.top_k,
                "chunks_returned": len(raw_results),
                "similarity_scores": [r["similarity"] for r in raw_results],
                "latency_ms": round(elapsed_ms, 2),
            }
        },
    )

    results = [QueryResult(**r) for r in raw_results]
    return QueryResponse(results=results, query=request.query, latency_ms=round(elapsed_ms, 2))


@app.get("/rag/health")
async def health():
    """
    Bonus endpoint: return the current state of the vector store.
    Useful to verify the store is populated.
    """
    store = get_store()
    return store.health()


@app.get("/")
async def root():
    return {"service": "DeskMate RAG Service", "status": "running", "docs": "/docs"}
