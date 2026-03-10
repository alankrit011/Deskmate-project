FROM python:3.11-slim

WORKDIR /app

# Install build dependencies for FAISS
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the sentence-transformers model so it's baked into the image
# and there's no network call at container startup time
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY . .

# The data directory is mounted via docker-compose; this ENV variable tells
# the service where to find the handbook
ENV HANDBOOK_PATH=/data/IT_Handbook.txt

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
