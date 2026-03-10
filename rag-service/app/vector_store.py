"""
In-memory FAISS vector store for the RAG service.

Why FAISS (IndexFlatIP) over ChromaDB?
- FAISS is a pure Python/C++ library with no server process required.
  ChromaDB spins up a persistent server or uses a SQLite backend — both add
  complexity that isn't needed for a PoC.
- IndexFlatIP performs exact (brute-force) inner-product search. With a few
  hundred IT handbook chunks, this is more than fast enough (sub-millisecond).
  We'd switch to IndexIVFFlat or HNSW only when the corpus exceeds ~100k chunks.
- We store the raw chunk texts and source metadata in a parallel Python list
  so we can return them alongside similarity scores without a separate DB lookup.
- Trade-off: in-memory means data is lost on service restart. For production,
  we'd persist the FAISS index to disk (faiss.write_index) or migrate to
  Azure AI Search with vector indexing.
"""

from typing import List, Dict, Any
import numpy as np
import faiss


class VectorStore:
    def __init__(self, dimension: int = 384):
        """
        Initialise an empty FAISS flat inner-product index.

        dimension=384 matches all-MiniLM-L6-v2's output size.
        IndexFlatIP uses cosine similarity when vectors are unit-normalised,
        which our embedder.py guarantees via normalize_embeddings=True.
        """
        self.dimension = dimension
        # IndexFlatIP: exact search using inner product (== cosine similarity
        # when vectors are L2-normalised). Simple, accurate, no training needed.
        self.index = faiss.IndexFlatIP(dimension)
        # Parallel metadata store — index i in this list corresponds to
        # vector i in the FAISS index.
        self.chunks: List[str] = []
        self.sources: List[str] = []

    def add_chunks(self, chunks: List[str], embeddings: np.ndarray, source: str) -> int:
        """
        Add a batch of chunks and their embeddings to the store.

        Returns the number of chunks successfully added.
        """
        if len(chunks) != embeddings.shape[0]:
            raise ValueError("chunks and embeddings length mismatch")

        self.index.add(embeddings)
        self.chunks.extend(chunks)
        self.sources.extend([source] * len(chunks))

        return len(chunks)

    def search(self, query_embedding: np.ndarray, top_k: int = 3) -> List[Dict[str, Any]]:
        """
        Semantic search: return the top_k most similar chunks.

        Returns a list of dicts with keys: chunk, source, similarity.
        similarity is the inner-product score (0.0–1.0 for normalised vectors).
        """
        if self.index.ntotal == 0:
            # The index is empty — caller should handle this gracefully
            return []

        # FAISS search returns (distances, indices) arrays of shape (1, top_k)
        # We reshape query_embedding to (1, D) for the API call
        query_vec = query_embedding.reshape(1, -1)
        actual_k = min(top_k, self.index.ntotal)  # can't fetch more than we have
        distances, indices = self.index.search(query_vec, actual_k)

        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx == -1:
                # FAISS returns -1 for slots it couldn't fill (shouldn't happen
                # with IndexFlatIP but we guard against it anyway)
                continue
            results.append({
                "chunk": self.chunks[idx],
                "source": self.sources[idx],
                # Round to 4 decimal places for readable log output
                "similarity": round(float(dist), 4),
            })

        return results

    def health(self) -> Dict[str, Any]:
        """Return the current state of the vector store for the /rag/health endpoint."""
        return {
            "total_chunks": self.index.ntotal,
            "embedding_model": "all-MiniLM-L6-v2",
            "embedding_dimension": self.dimension,
            "index_type": "IndexFlatIP (cosine similarity)",
            "sources": list(set(self.sources)),
        }


# Module-level singleton — shared across all requests in the FastAPI process.
# A single process owns the FAISS index; horizontal scaling would require
# each replica to load from a shared persisted index (e.g., Azure Blob Storage).
_store = VectorStore()


def get_store() -> VectorStore:
    return _store
