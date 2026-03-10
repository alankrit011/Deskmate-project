"""
Embedding model wrapper for the RAG service.

Why sentence-transformers / all-MiniLM-L6-v2?
- It runs entirely locally — no API key, no network dependency, no latency
  from external calls. This is ideal for a PoC where reliability matters.
- all-MiniLM-L6-v2 is a compact (22M parameter) model that produces strong
  semantic embeddings for short-to-medium English text. It consistently
  scores well on MTEB (Massive Text Embedding Benchmark) for retrieval tasks.
- It produces 384-dimensional vectors, which is small enough for FAISS to
  search quickly in memory even with thousands of chunks.
- Trade-off vs. OpenAI text-embedding-3-small: OpenAI's model would produce
  higher-quality embeddings for complex domain-specific text and doesn't
  require local compute. However, it requires an API key, adds network
  latency, and has per-token cost. For this PoC, the local model is the
  better engineering choice.
"""

from typing import List
import numpy as np
from sentence_transformers import SentenceTransformer

# Module-level singleton — we load the model once at startup to avoid
# paying the 1-2 second model load cost on every request.
_model: SentenceTransformer | None = None
MODEL_NAME = "all-MiniLM-L6-v2"


def get_model() -> SentenceTransformer:
    """Return the singleton embedding model, loading it if not yet initialised."""
    global _model
    if _model is None:
        # SentenceTransformer downloads the model on first use and caches it locally.
        # Subsequent calls use the cache without any network access.
        _model = SentenceTransformer(MODEL_NAME)
    return _model


def embed_texts(texts: List[str]) -> np.ndarray:
    """
    Embed a list of strings and return a float32 numpy array of shape (N, 384).
    We normalise embeddings to unit length so that cosine similarity equals
    the inner product — this lets us use FAISS's IndexFlatIP (inner product)
    for fast cosine similarity search.
    """
    model = get_model()
    # show_progress_bar=False keeps logs clean during ingestion
    embeddings = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
    return embeddings.astype(np.float32)


def embed_query(query: str) -> np.ndarray:
    """
    Embed a single query string.
    Returns shape (1, 384) so it can be passed directly to FAISS search.
    """
    return embed_texts([query])
