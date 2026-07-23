# HBntory Product MCP Server (Task 4)

Bridges the AI agent to the external Product API and, as of Task 5, the
Backoffice's stock data. Per
[docs/architecture_and_planning.md](../docs/architecture_and_planning.md)
(§1.2–1.6): this server exposes tools that query the Product API and the
Backoffice's stock (read-only) on the agent's behalf, and it never invents
information the tools didn't return.

## Setup

```bash
cd product_mcp
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Run

The server speaks MCP over stdio — an MCP client (e.g. an AI agent host)
launches it as a subprocess, it does not listen on a port itself:

```bash
PRODUCT_API_URL=http://127.0.0.1:5001 \
DATABASE_URL="sqlite:///../backoffice/hbntory.db" \
.venv/bin/python server.py
```

`PRODUCT_API_URL` defaults to `http://localhost:5001` (see
[product_api/docs/api_contract.md](../product_api/docs/api_contract.md) for
the Product API contract this server consumes). `DATABASE_URL` defaults to
`sqlite:///../backoffice/hbntory.db` (same file the Backoffice uses,
opened **read-only**) and is only used by the stock tools below.

## Tools

### `list_products_tool`

List or search the supplier catalog.

| Input | Type | Notes |
|---|---|---|
| `query` | string, optional | Free-text search over name, SKU, description, tags |
| `category` | string, optional | Exact category filter |
| `min_price` / `max_price` | number, optional | Price range filter |
| `include_discontinued` | boolean, default `false` | |
| `limit` | integer, default 20 | 1–100, validated before calling the API |
| `offset` | integer, default 0 | >= 0, validated before calling the API |

Output (`ListProductsResult`): `count`, `limit`, `offset`, and `results` — a
list of `ProductSummary` (`id`, `sku`, `name`, `category`, `brand`,
`unit_price`, `currency`, `discontinued`). Deliberately trimmed compared to
the full Product API response: no `description`, `tags`, `weight_kg`, or
supplier details in a listing — that belongs in `get_product_details`, so
the agent isn't handed data it didn't ask for.

### `get_product_details`

Full details for exactly one product, looked up by numeric id or SKU
(e.g. `HB-LAP-1001`).

Output (`ProductDetails`): `id`, `sku`, `name`, `description`, `category`,
`brand`, `supplier_id`, `supplier_name`, `unit_price`, `currency`,
`discontinued`, `weight_kg`, `tags`, `updated_at`.

### `list_branches_tool`

No input. Returns the sorted list of branch names.

### `get_stock_by_branch_tool`

Input: `branch_name` (exact name). Output (`BranchStockResult`):
`branch_name` and `items` — a list of `{product_sku, quantity}` for that
branch (only rows with quantity > 0). Raises a clear error if the branch
name doesn't exist.

### `get_branches_with_product_tool`

Input: `product_sku`. Output (`ProductAvailabilityResult`): `product_sku`
and `branches` — a list of `{branch_name, quantity}` currently holding that
product (quantity > 0). Does not validate the SKU against the catalog
(pair with `get_product_details` for that) — an empty list just means no
branch currently has stock.

All five tools are read-only and stateless — no side effects, no writes to
any store. The stock tools open the Backoffice's SQLite file with
`mode=ro`, so a write is structurally impossible, not just a convention.

## Error handling

`product_client.py` is intentionally stricter than
`backoffice/product_client.py`: the Backoffice degrades silently (an
unreachable Product API just means an empty product list in the UI),
because a browsing feature failing quietly is an acceptable tradeoff. An AI
agent tool cannot make that tradeoff — if it silently returned an empty
result, the agent could not distinguish "no results" from "the catalog is
down" and might answer confidently with wrong information. So this client
raises instead of swallowing:

- `ProductNotFoundError` — the Product API returned 404 for a specific
  id/SKU. Expected, normal outcome of a lookup.
- `ProductAPIError` — anything else: unreachable host, timeout, a non-200/404
  HTTP status (including the `force_error=true` simulated 503), or a
  response body that isn't valid JSON.
- `BranchNotFoundError` (`stock_client.py`) — no branch with that exact
  name.
- `StockAPIError` (`stock_client.py`) — the Backoffice database file
  couldn't be opened or read.

All five tools in `server.py` catch these and re-raise as `mcp.server.fastmcp
.exceptions.ToolError` with a descriptive message. FastMCP's tool-call
handler turns any exception raised inside a tool into a
`CallToolResult(isError=True, ...)` carrying that message as text content
— so the agent always gets a clear, structured explanation of what went
wrong instead of a silent failure, a stack trace, or a hung request.
Invalid tool arguments (e.g. `limit` out of range) are rejected the same
way, before any HTTP call is made.

## Manual test evidence

`manual_test.py` calls the tools through FastMCP's own `call_tool` path —
the same code path a real MCP client hits — covering the four required
cases (run with the Product API up on `:5001`):

```bash
PRODUCT_API_URL=http://127.0.0.1:5001 .venv/bin/python manual_test.py
```

Observed results (2026-07-23):

1. **Successful listing** — `list_products_tool(query="laptop", limit=3)` →
   `count=5`, 3 summarized results (laptops + a laptop backpack matched by
   tag/description).
2. **Detail retrieval** — `get_product_details("HB-LAP-1001")` → full
   `ProductDetails` including description, supplier, tags.
3. **Not found** — `get_product_details("does-not-exist")` → `ToolError:
   No product found for id/SKU 'does-not-exist'.`
4. **Invalid input** — `list_products_tool(limit=0)` → `ToolError: limit
   must be between 1 and 100.` (rejected before any HTTP call).
5. **Product API unreachable** — `PRODUCT_API_URL` pointed at a closed port
   → both tools raise `ToolError: Product catalog is currently
   unavailable: Could not reach the Product API at ...: Connection
   refused`.

Additionally verified directly against the Product API's `force_error=true`
simulation (a reachable-but-erroring backend, distinct from case 5's
unreachable one):

```
ProductAPIError: Product API returned HTTP 503 for /api/v1/products: {"error": "supplier_unavailable", "message": "Forced simulation error."}
```

Stock tools verified directly against the seeded Backoffice database
(`backoffice/seed.py`, branches Lyon/Paris):

```
list_branches_tool()                                  -> ['Lyon', 'Paris']
get_stock_by_branch_tool('Lyon')                       -> 4 items (HB-KBD-4102 x25, HB-LAP-1001 x10, ...)
get_branches_with_product_tool('HB-KBD-4102')          -> [{'branch_name': 'Lyon', 'quantity': 25}]
get_stock_by_branch_tool('Nowhere')                    -> ToolError: No branch named 'Nowhere'.
```
