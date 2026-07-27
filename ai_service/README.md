# HBntory AI Query Service (Task 5)

REST backend embedding the AI agent (see
[docs/architecture_and_planning.md](../docs/architecture_and_planning.md)
§1.2–1.6). Receives one natural-language question, has the agent call the
Product MCP server's tools as needed, and returns one answer. No
conversation history is kept between requests (§2.2: each question is
independent).

## Setup

The agent runs against a **local Ollama server** — no API key, no
per-token cost (see
[docs/architecture_and_planning.md](../docs/architecture_and_planning.md)
§2.4 for why: this is a student project with no budget for a paid LLM
API, and the "no answer without a real tool call" grounding rule works
the same regardless of which model enforces it).

```bash
# Install Ollama (https://ollama.com) and pull a tool-calling-capable model:
ollama pull llama3.2

cd ai_service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # defaults already point at localhost:11434 / llama3.2
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

### `GET /api/catalog`

Read-only, grouped by branch — powers `client_web/`'s catalog grid. No
LLM call, just MCP tool calls (`catalog.py`): `list_branches_tool`, then
`get_stock_by_branch_tool` per branch, then `get_product_details` per
distinct SKU found in stock.

Response (200):

```json
{
  "branches": [
    {"name": "Lyon", "items": [
      {"sku": "HB-LAP-1001", "name": "Holberton Student Laptop 14",
       "category": "Laptops", "brand": "Holberton", "unit_price": 799.0,
       "currency": "USD", "quantity": 10}
    ]}
  ]
}
```

Only products with stock (`quantity > 0`) in a branch appear under that
branch — same rule the stock tools already apply. Error responses use the
same `{"error", "message"}` envelope as `/api/ask`; `503 catalog_unavailable`
covers the same MCP/connectivity failures as `agent_unavailable` below.

**FastMCP return-type wrapping quirk**: tools with a bare (non-object)
return type — `list_branches_tool() -> list[str]` — come back with
`structuredContent = {"result": [...]}`, while tools returning a Pydantic
model (`get_stock_by_branch_tool`, `get_product_details`) come back
unwrapped. Confirmed empirically, not documented upstream; `catalog.py`
detects the wrapper by checking `isinstance(..., dict)` before indexing
`["result"]`.

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
| 503 | `agent_unavailable` | Ollama is not reachable at `OLLAMA_HOST`, the LLM call failed, the Product MCP server could not be started, or the agent used too many tool calls without reaching an answer |
| 503 | `catalog_unavailable` (`GET /api/catalog` only) | The Product MCP server could not be started, or a stock/product tool call failed |
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

- **Ollama unreachable / LLM failure** → `agent.py` wraps `httpx.ConnectError`
  (Ollama not running) and any other `httpx.HTTPError` from the
  `/api/chat` call. Both become `AgentError`, surfaced as HTTP 503.
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
needing Ollama. It additionally runs the full agent loop against the
example questions below if Ollama is reachable at `OLLAMA_HOST`.

Observed (2026-07-25), MCP connectivity:

```
--- 1. Product MCP server connectivity ---
Tools exposed: ['get_branches_with_product_tool', 'get_product_details',
'get_stock_by_branch_tool', 'list_branches_tool', 'list_products_tool']
list_products_tool(limit=1) isError: False
get_product_details(unknown) isError: True
MCP connectivity: OK
```

**Full agent loop, exercised end-to-end against Ollama (`llama3.2`)** via
`curl -X POST /api/ask`, tool calls confirmed in the `hbntory.agent` log
for each (never invented — every fact traces back to a logged tool
result):

| Question | Tool called | Answer |
|---|---|---|
| Quels sont les détails du produit HB-LAP-1001 ? | `get_product_details({'identifier': 'HB-LAP-1001'})` | "Le produit HB-LAP-1001 est une laptop Holberton Student Laptop 14 ... 799 USD ... 1,35 kg" — matches the real catalog entry exactly (price, weight). |
| Quelles branches ont du stock du produit HB-KBD-4102 ? | `get_branches_with_product_tool({'product_sku': 'HB-KBD-4102'})` | Cites Lyon and quantity 25, matching the tool result exactly — phrasing is a little disjointed (small-model trade-off, §2.4), but the data is correct. |
| As-tu du stock pour un produit qui n'existe pas, XYZ-0000 ? | `get_product_details({'identifier': 'XYZ-0000'})` | "Désolé, je n'ai pas trouvé de stock pour le produit XYZ-0000 car il ne semble pas exister dans notre catalogue." — correctly declines instead of inventing a product. |

Observed latency: **1-3 minutes per question**, even with the model
already loaded (`keep_alive: "30m"` on every request) — CPU-only local
inference, see
[docs/architecture_and_planning.md](../docs/architecture_and_planning.md)
§2.4. A cold start (model not yet loaded) adds up to another ~90s.

**Also observed — a genuine small-model limitation, not a bug:** for
"Quels produits sont disponibles dans la branche Lyon ?", the model first
called `list_products_tool(limit=100)` (fetching the entire 39-product
catalog — unnecessary for this question) before correctly calling
`get_stock_by_branch_tool({'branch_name': 'Lyon'})`. That extra round
trip pushed a single Ollama call past `REQUEST_TIMEOUT_SECONDS` (240s),
and the request correctly surfaced as `503 agent_unavailable` (the fix
below) rather than hanging or crashing — but no final answer was
produced for that specific run. Re-running the same question can succeed
or hit the same detour; a smaller model is not perfectly consistent
about which tool to call first (§2.4's accepted trade-off).

Error paths, also tested directly:

```
POST /api/ask {"question": "test"}   (OLLAMA_HOST pointed at a closed port)
                                      -> 503 {"error":"agent_unavailable","message":"Ollama is not reachable at http://127.0.0.1:1: All connection attempts failed"}
POST /api/ask {"question": ""}       -> 400 {"error":"bad_request","message":"question is required"}
GET  /health                          -> 200 {"status":"ok"}
```

`GET /api/catalog`, verified end-to-end (2026-07-27) via `curl`, real
data from both branches:

```
GET /api/catalog -> 200
{"branches": [
  {"name": "Lyon",  "items": [HB-MON-2101 x5, HB-KBD-4102 x25, HB-SSD-7101 x15, HB-LAP-1001 x10]},
  {"name": "Paris", "items": [HB-MON-2101 x12, HB-LAP-1001 x7]}
]}
```

Note on `agent.py`'s exception handling: an error raised while the
`product_mcp_session()` context is open (e.g. Ollama unreachable) gets
wrapped by anyio's `TaskGroup` into a `BaseExceptionGroup` during cleanup
— a plain `except AgentError` would silently miss it and fall through to
a generic 500. `agent.py`'s `_unwrap()` helper recurses into single-item
exception groups before the `isinstance` check, so this still surfaces as
the intended `503 agent_unavailable`, confirmed by the test above.
