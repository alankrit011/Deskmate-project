"""
Structured JSON logger for the RAG service.
We use JSON format so logs can be piped directly into Azure Monitor,
Splunk, or any structured logging system without further transformation.
"""

import json
import logging
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    """
    Formats each log record as a single-line JSON object.
    This makes it trivial to parse and query logs in Azure Log Analytics.
    """

    def format(self, record: logging.LogRecord) -> str:
        # Base fields that every log entry should have
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "service": "rag-service",
            "message": record.getMessage(),
        }

        # Attach any extra context fields passed by the caller
        # e.g. logger.info("query received", extra={"query": "..."})
        if hasattr(record, "extra_data"):
            log_entry.update(record.extra_data)

        # Attach exception info if present
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_entry)


def get_logger(name: str = "rag-service") -> logging.Logger:
    logger = logging.getLogger(name)

    # Avoid adding duplicate handlers if get_logger is called multiple times
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        # Don't propagate to the root logger — we own our output format
        logger.propagate = False

    return logger
