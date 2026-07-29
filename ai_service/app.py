"""
AI Query Service: REST API in front of the agent (agent.py).

Single endpoint, no authentication (see docs/architecture_and_planning.md
§1.2: "Service IA | Recevoir les questions en langage naturel, les
transmettre à l'agent, et renvoyer une réponse. Indépendant du
backoffice."). CORS is open because the public client interface
(client_web/) is a separate, unauthenticated static page that may be
served from a different origin.
"""

import asyncio
import logging
import os

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from agent import AgentError, _unwrap, answer_question
from catalog import CatalogError, get_catalog
from mcp_client import MCPConnectionError

# INFO-level logs from agent.py ("hbntory.agent") show every tool call the
# agent makes and its result — see README.md "Observing tool calls". Set at
# import time (not just in __main__) so it also applies under gunicorn.
logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")

MAX_QUESTION_LENGTH = 500

app = Flask(__name__)
# /api/ask is public and unauthenticated: cap the request body so a large
# payload can't tie up an LLM call for free (the question length check
# below is the main guard; this is a blunter backstop against oversized
# bodies before Flask even parses JSON).
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024


@app.after_request
def _add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.errorhandler(HTTPException)
def _handle_http_exception(e):
    # Preserve Flask/Werkzeug's own status code (e.g. 413 Payload Too
    # Large from MAX_CONTENT_LENGTH) instead of flattening it to a generic
    # 500 via the catch-all below.
    return jsonify(error="request_error", message=e.description), e.code


@app.errorhandler(Exception)
def _handle_unexpected_error(e):
    app.logger.exception("Unexpected error handling request")
    return jsonify(error="internal_error", message=str(e)), 500


@app.get("/health")
def health():
    return jsonify(status="ok")


@app.get("/api/catalog")
def catalog():
    """
    Read-only product catalog, grouped by branch, for the public client
    page's catalog view. No question, no LLM call — just the MCP stock +
    product tools (see catalog.py). Cheap and fast relative to /api/ask.
    """
    try:
        data = asyncio.run(get_catalog())
    except Exception as exc:
        real = _unwrap(exc)
        if isinstance(real, (CatalogError, MCPConnectionError)):
            return jsonify(error="catalog_unavailable", message=str(real)), 503
        raise

    return jsonify(data)


@app.post("/api/ask")
def ask():
    data = request.get_json(silent=True) or {}
    question = (data.get("question") or "").strip()
    if not question:
        return jsonify(error="bad_request", message="question is required"), 400
    if len(question) > MAX_QUESTION_LENGTH:
        return jsonify(
            error="bad_request",
            message=f"question must be at most {MAX_QUESTION_LENGTH} characters",
        ), 400

    try:
        answer = asyncio.run(answer_question(question))
    except AgentError as e:
        return jsonify(error="agent_unavailable", message=str(e)), 503

    return jsonify(answer=answer)


if __name__ == "__main__":
    port = int(os.getenv("AI_SERVICE_PORT", "5002"))
    app.run(host="0.0.0.0", port=port)
