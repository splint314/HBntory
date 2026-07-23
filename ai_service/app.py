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
import os

from flask import Flask, jsonify, request

from agent import AgentError, answer_question

app = Flask(__name__)


@app.after_request
def _add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.errorhandler(Exception)
def _handle_unexpected_error(e):
    app.logger.exception("Unexpected error handling request")
    return jsonify(error="internal_error", message=str(e)), 500


@app.get("/health")
def health():
    return jsonify(status="ok")


@app.post("/api/ask")
def ask():
    data = request.get_json(silent=True) or {}
    question = (data.get("question") or "").strip()
    if not question:
        return jsonify(error="bad_request", message="question is required"), 400

    try:
        answer = asyncio.run(answer_question(question))
    except AgentError as e:
        return jsonify(error="agent_unavailable", message=str(e)), 503

    return jsonify(answer=answer)


if __name__ == "__main__":
    port = int(os.getenv("AI_SERVICE_PORT", "5002"))
    app.run(host="0.0.0.0", port=port)
