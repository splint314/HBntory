# HBntory AI Query Service (Task 5)

REST backend embedding the AI agent (see
[docs/architecture_and_planning.md](../docs/architecture_and_planning.md)
§1.2–1.6). Receives one natural-language question, has the agent call the
Product MCP server's tools as needed, and returns one answer. No
conversation history is kept between requests (§2.2: each question is
independent).

## Setup

```bash
cd ai_service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # then fill in ANTHROPIC_API_KEY
```

Also requires `product_mcp/` to have its own venv set up (see
[product_mcp/README.md](../product_mcp/README.md)) — this service launches
`product_mcp/server.py` as a subprocess.

## Run

```bash
cd ai_service
export $(grep -v '^#' .env | xargs)   # or use your own env loading
.venv/bin/python app.py
```

Listens on `http://0.0.0.0:5002` by default (`AI_SERVICE_PORT`).

## API contract

### `POST /api/ask`

Request:

```json
{"question": "Quels sont les détails du produit HB-LAP-1001 ?"}
```

Response (200):

```json
{"answer": "Le produit HB-LAP-1001 est ..."}
```

Error responses (all `{"error": "<code>", "message": "<human-readable>"}`):

| Status | `error` | When |
|---|---|---|
| 400 | `bad_request` | `question` missing or empty |
| 503 | `agent_unavailable` | Missing `ANTHROPIC_API_KEY`, the LLM API failed, the Product MCP server could not be started, or the agent used too many tool calls without reaching an answer |
| 500 | `internal_error` | Anything unexpected — caught by a catch-all Flask error handler so a bug here never surfaces as a raw stack trace to the public client page |

`GET /health` → `{"status": "ok"}`.

CORS is open (`Access-Control-Allow-Origin: *`) since the public client page
(`client_web/`) is an unauthenticated static page that may be served from a
different origin.

## Supported question types (Task 5.1)

The system prompt (`agent.py`) restricts the agent to exactly these four
categories — anything else, it is instructed to say plainly is outside
scope instead of improvising an answer:

1. **Product details** — "Quels sont les détails du produit HB-LAP-1001 ?"
2. **Which branch(es) have a product** — "Quelles branches ont du stock du
   produit HB-KBD-4102 ?"
3. **What's available in a branch** — "Quels produits sont disponibles dans
   la branche Lyon ?"
4. **Shopping-list feasibility** — "J'ai besoin de 5 claviers et 2
   écrans, une branche peut-elle tout fournir ?" — the agent checks each
   item's *quantity* against each branch's actual stock (via
   `get_branches_with_product_tool` per item), not just whether the branch
   stocks the product at all.

Grounding (Task 5.4): the agent has no product/stock knowledge of its own —
every fact in an answer comes from a tool call in the same request. If a
tool reports "not found" or is unavailable, the agent is instructed to say
so rather than guess.

## Observing tool calls (Task 5.2)

Every tool call the agent makes (name, arguments) and its result
(`isError`, truncated content) is logged at `INFO` level under the
`hbntory.agent` logger. Running `python app.py` directly enables this via
`logging.basicConfig` in `app.py`'s `__main__` block, so tool activity is
visible on stdout while the server runs — e.g.:

```
hbntory.agent: tool call: get_branches_with_product_tool({'product_sku': 'HB-KBD-4102'})
hbntory.agent: tool result: get_branches_with_product_tool -> isError=False {"product_sku": "HB-KBD-4102", "branches": [{"branch_name": "Lyon", "quantity": 25}]}
```

## Stock-query strategy (Task 5.3)

Stock tools are exposed **by the Product MCP server** (`product_mcp/`,
extended in Task 5 with `stock_client.py`), not by a separate database MCP
tool or a second internal API — one MCP connection gives the agent both
catalog and stock data, and the boundary (read-only, `mode=ro` SQLite
connection, no writes possible) is enforced at the same layer as the
product tools. See
[product_mcp/README.md](../product_mcp/README.md#error-handling) for why
this was chosen over the alternatives (extend MCP vs. DB tool vs. internal
API) and the tool contracts (`get_branches_with_product_tool`,
`get_stock_by_branch_tool`, `list_branches_tool`).

## Error handling

- **Missing API key / LLM failure** → `agent.py` checks for
  `ANTHROPIC_API_KEY` before doing anything, and wraps every
  `anthropic.APIError` from `messages.create`. Both become `AgentError`,
  surfaced as HTTP 503.
- **Product MCP server unreachable** → `mcp_client.py` raises
  `MCPConnectionError` if the subprocess can't start; `agent.py` wraps it
  into `AgentError` (503). A tool call failing *during* the conversation
  (e.g. product not found) is fed back to the LLM as a `tool_result` with
  `is_error=True` instead of crashing the request — the agent is expected
  to explain the failure to the user in its answer (per the system prompt:
  never invent data, say plainly when something is unavailable).
- **Runaway tool loop** → capped at `MAX_TOOL_TURNS` (8); exceeding it
  raises `AgentError` rather than looping forever.
- **Anything else** → the Flask catch-all error handler returns
  `internal_error` (500) with the exception message, never an HTML stack
  trace page.

## Manual test evidence

```bash
PRODUCT_API_URL=http://127.0.0.1:5001 \
DATABASE_URL="sqlite:///../backoffice/hbntory.db" \
.venv/bin/python manual_test.py
```

This always runs the MCP-connectivity checks (tool listing, a successful
`list_products_tool` call, a `get_product_details` "not found" call) without
needing an API key. It additionally runs the full agent loop against the
example questions below if `ANTHROPIC_API_KEY` is set.

Observed (2026-07-23, no API key set in this environment):

```
--- 1. Product MCP server connectivity ---
Tools exposed: ['get_branches_with_product_tool', 'get_product_details',
'get_stock_by_branch_tool', 'list_branches_tool', 'list_products_tool']
list_products_tool(limit=1) isError: False
get_product_details(unknown) isError: True
MCP connectivity: OK

--- 2. Full agent loop: SKIPPED (ANTHROPIC_API_KEY not set) ---
```

REST endpoint tested directly with `curl`:

```
POST /api/ask {"question": "test"}   -> 503 {"error":"agent_unavailable","message":"ANTHROPIC_API_KEY is not set."}
POST /api/ask {"question": ""}       -> 400 {"error":"bad_request","message":"question is required"}
GET  /health                          -> 200 {"status":"ok"}
```

The full agent loop (LLM actually answering) has **not** been exercised
end-to-end in this environment — no `ANTHROPIC_API_KEY` was available.
Once a key is set, re-run `manual_test.py`; part 2 will ask the example
questions from [client_web/README.md](../client_web/README.md) and print
each answer.
