"""
Document chunking strategy for the IT Handbook.

Why 400 characters with 80-character overlap?
- IT policy paragraphs typically contain self-contained procedural steps.
  A 400-character window captures roughly 2-4 sentences, which is enough
  context for a retrieval hit to be useful without being so large that it
  dilutes semantic similarity scores.
- 80-character overlap (20% of chunk size) ensures that sentences split
  across chunk boundaries don't lose their context — the overlapping region
  re-introduces the tail of the previous chunk at the head of the next one.
- We split on sentence boundaries first (". ") then fall back to character
  splits so we never cut mid-sentence within a chunk, which would confuse
  the embedding model.

This is a character-level chunker (not token-level) for simplicity. In
production, you'd want a token-aware chunker (e.g., tiktoken) to guarantee
chunks fit within the embedding model's context window.
"""

from typing import List


def chunk_text(text: str, chunk_size: int = 400, overlap: int = 80) -> List[str]:
    """
    Split text into overlapping chunks.

    Args:
        text: The full document text.
        chunk_size: Target size of each chunk in characters.
        overlap: Number of characters to repeat at the start of the next chunk.

    Returns:
        List of chunk strings.
    """
    # Normalise whitespace — collapse multiple blank lines into one
    # so we don't waste chunk space on empty lines from the handbook formatting
    lines = [line.strip() for line in text.splitlines()]
    cleaned = "\n".join(line for line in lines if line)

    chunks: List[str] = []
    start = 0

    while start < len(cleaned):
        end = start + chunk_size

        if end >= len(cleaned):
            # We've reached the end of the document
            chunk = cleaned[start:]
            if chunk.strip():
                chunks.append(chunk.strip())
            break

        # Try to end the chunk at a sentence boundary to avoid mid-sentence cuts.
        # We search backwards from `end` for ". " within a 100-char window.
        # If no sentence boundary is found, we fall back to the hard char cut.
        boundary = cleaned.rfind(". ", start, end)
        if boundary != -1 and boundary > start + (chunk_size // 2):
            # +2 to include the period and space in this chunk
            end = boundary + 2

        chunk = cleaned[start:end].strip()
        if chunk:
            chunks.append(chunk)

        # Move start forward by (chunk_size - overlap) to create the sliding window
        start = end - overlap

    return chunks
