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
ollama pull llama3.1:8b

cd ai_service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # defaults already point at localhost:11434 / llama3.1:8b
```

`AI_MODEL=llama3.2` (3B, `ollama pull llama3.2`) is a faster but less
reliable alternative — see the manual test evidence below for the
concrete difference in tool-selection reliability between the two.

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

**Full agent loop, exercised end-to-end against Ollama**, tool calls
confirmed in the `hbntory.agent` log for each (never invented — every
fact traces back to a logged tool result):

| Question | Tool called | Answer |
|---|---|---|
| Quels sont les détails du produit HB-LAP-1001 ? | `get_product_details({'identifier': 'HB-LAP-1001'})` | "Le produit HB-LAP-1001 est une laptop Holberton Student Laptop 14 ... 799 USD ... 1,35 kg" — matches the real catalog entry exactly (price, weight). |
| Quelles branches ont du stock du produit HB-KBD-4102 ? | `get_branches_with_product_tool({'product_sku': 'HB-KBD-4102'})` | Cites Lyon and quantity 25, matching the tool result exactly. |
| As-tu du stock pour un produit qui n'existe pas, XYZ-0000 ? | `get_product_details({'identifier': 'XYZ-0000'})` | "Désolé, je n'ai pas trouvé de stock pour le produit XYZ-0000 car il ne semble pas exister dans notre catalogue." — correctly declines instead of inventing a product. |

Observed latency: with `llama3.1:8b` (current default), 2-8 seconds per
question in this environment, model already loaded (`keep_alive: "30m"`
on every request). The team also measured **1-3 minutes per question**
with CPU-only inference on other hardware — see
[docs/architecture_and_planning.md](../docs/architecture_and_planning.md)
§2.4. Actual latency depends heavily on the machine; a cold start (model
not yet loaded) adds on top either way.

### Tool-selection reliability: why the default model changed (2026-07-27)

Two real failure modes were found while testing "Quels produits sont
disponibles dans la branche Lyon/Paris ?" — both are documented here
instead of hidden, per the project's own "never hide what's unavailable"
principle applied to our own limitations:

**1. Wrong tool entirely, with `llama3.2` (3B).** The model called
`list_products_tool` (the whole 39-product catalog, no branch filter)
instead of `get_stock_by_branch_tool`, then presented the entire catalog
as if it were that branch's stock — a real grounding failure (data came
from a real tool call, but the wrong one for the question asked).
Mitigation applied: `product_mcp/server.py`'s tool docstrings now
explicitly warn against this (`list_products_tool` says "do NOT use this
for branch stock questions"; `get_stock_by_branch_tool` says "this is the
only correct tool for branch stock questions"). This fixed the Lyon case
but not consistently: retesting "Paris" afterward, the model still picked
`list_products_tool`, this time with an invalid `limit: None` argument,
got a validation error back, and produced a confused answer telling the
end user to call the tool themselves. **The 3B model's tool selection
stayed unreliable even after the fix.**

**2. Correct tools, wrong arithmetic, with `llama3.1:8b`.** Retesting the
same branch questions with the larger model, tool selection was correct
and consistent in every trial. But a shopping-list question ("5 unités de
HB-KBD-4102 et 10 unités de HB-MON-2101, quelle branche peut tout
fournir ?") exposed a different bug: the model called the right tools
(`get_branches_with_product_tool` per item) and got the right raw data
(Lyon has only 5 units of HB-MON-2101, not the 10 requested), but then
concluded "Lyon a en stock suffisamment" — an arithmetic/comparison
error over real data, not an invented fact. **Neither model is fully
reliable at the quantity-comparison question type (Task 5.1 #4)**; this
is called out as a known limitation in the main
[README.md](../README.md#limitations-connues) rather than silently
accepted.

**Decision:** default `AI_MODEL` switched from `llama3.2` to
`llama3.1:8b` — clearly more reliable at tool selection in every retest
run, at the cost of a larger download and (on slower hardware) higher
latency. `llama3.2` remains available via `AI_MODEL=llama3.2` for a
faster but less reliable demo.

### Follow-up retest with `llama3.1:8b` (2026-07-27, later)

A fuller retest of all five example questions surfaced two more findings,
one fixed, one accepted as an unresolved limitation:

**3. Fixed — product question misread as a branch question.** "As-tu du
stock pour un produit qui n'existe pas, XYZ-0000 ?" made the model call
`get_stock_by_branch_tool({'branch_name': 'un'})` — it read the French
indefinite article "un" as if it were a branch name, instead of
recognizing the SKU `XYZ-0000` and calling `get_product_details`.
Grounded (the tool really did error on an unknown branch), but not
useful. **Mitigation applied:** `SYSTEM_PROMPT` now spells out that
`branch_name` must be a real branch name (never a word guessed from
grammar) and explicitly redirects "does this product exist" phrasing to
`get_product_details` regardless of how the question is worded.
Retested: fixed, correct answer.

**4. Still unresolved — shopping-list quantity comparison.** Same
question as before ("5 unités de HB-KBD-4102 et 10 unités de
HB-MON-2101, quelle branche peut tout fournir ?"), retested against the
strengthened prompt (explicit "a branch only qualifies if it meets every
item's quantity" rule added). Result: **still wrong**, and in a new way.
The model called the right tools first and got the right data (Lyon:
25 KBD / 5 MON, Paris: 12 MON), but then made several more tool calls
with garbage arguments — literally `get_stock_by_branch_tool({'branch_name':
'[branches résultat 1]'})`, a template placeholder passed as a literal
string instead of a real value — before running low on tool turns and
answering "Lyon a suffisamment" anyway, still wrong (Lyon only has 5 of
the 10 units needed).

Two independent prompt-engineering attempts have now failed to fix this
question type reliably. **Decision: stop iterating on the prompt for
this case and document it as a known, unresolved limitation** (see
[README.md](../README.md#limitations-connues)) rather than keep chasing
it — comparing exact quantities across multiple items is an arithmetic
task, and prompt wording changes have not made either model reliable at
it. The most likely real fix would be to have `agent.py` perform the
quantity comparison itself in Python once it has the tool results,
rather than asking the LLM to do the arithmetic — not implemented here,
left as a documented next step rather than an accepted silent gap.

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
