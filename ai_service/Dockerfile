FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Build context is the repo root (see docker-compose.yml) so this Dockerfile
# can also vendor product_mcp/ below.
COPY ai_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ai_service/ .

# product_mcp/ is spawned as an MCP subprocess (stdio transport, see
# mcp_client.py) rather than run as its own container: it has no HTTP port
# of its own. Its only dependency (the `mcp` package) is already installed
# above from ai_service/requirements.txt, so no separate venv is needed here.
COPY product_mcp/server.py product_mcp/product_client.py product_mcp/stock_client.py ./product_mcp/

ENV PRODUCT_MCP_PYTHON=python3
ENV PRODUCT_MCP_SERVER=/app/product_mcp/server.py

EXPOSE 5002

# ensure_model.py blocks until AI_MODEL is pulled on OLLAMA_HOST (a fresh
# deployment would otherwise 503 on /api/ask until someone remembers to run
# `ollama pull` by hand). gunicorn instead of `python app.py`: the Werkzeug
# dev server isn't meant for production traffic; --timeout must stay above
# agent.py's REQUEST_TIMEOUT_SECONDS since one request can hold a worker for
# minutes on a big model.
CMD ["sh", "-c", "python ensure_model.py && gunicorn --bind 0.0.0.0:5002 --workers 2 --threads 4 --timeout 300 app:app"]
