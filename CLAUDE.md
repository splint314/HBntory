# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

HBntory is a multi-branch stock management system for a fictional retail company (Holberton
school project). All six services from `docs/architecture_and_planning.md` now exist:

- `backoffice/` — Flask REST API + a static HTML/JS/CSS frontend it serves. This is where
  most business-logic work happens.
- `product_api/` — an external supplier-catalog API **provided as a vendored asset**
  (from `hbtn-edu/hbntory-products-api`). It is read-only and must not be modified.
- `product_mcp/` — MCP server bridging the AI agent to the Product API and (read-only) to
  the Backoffice's stock data. Exposes `list_products_tool`, `get_product_details`,
  `list_branches_tool`, `get_stock_by_branch_tool`, `get_branches_with_product_tool`.
- `ai_service/` — REST API embedding the AI agent (Claude, tool use against the Product MCP
  server). One endpoint, `POST /api/ask`, no conversation history between requests.
- `client_web/` — public, unauthenticated static page (no framework) that calls `ai_service`.

Everything is in French in docs/README (student project for a French school); code and
docstrings are in English.

## Commands

Run everything via Docker Compose (from repo root):

```bash
docker compose up --build
```

Starts, in dependency order: the external Product API (`http://localhost:5001`), the
Backoffice (`http://localhost:5000`, admin already seeded `admin` / `ChangeMe123!`, override
via `ADMIN_PASSWORD` in `docker-compose.yml`), the AI Query Service (`http://localhost:5002`),
and the client web interface (`http://localhost:5173`). Backoffice data persists in the
`backoffice_data` named volume, mounted read-only into the `ai-service` container for the
Product MCP server's stock tools (`product_mcp/` has no container of its own — no HTTP port,
it's spawned as a subprocess by `ai_service`, see `ai_service/Dockerfile`). Put
`ANTHROPIC_API_KEY=sk-ant-...` in a `.env` file at the repo root (compose loads it
automatically) for the agent to give real answers; without it everything still starts, only
`POST /api/ask` replies `503 agent_unavailable`.

Backoffice without Docker:

```bash
cd backoffice
python3 -m venv ../.venv
../.venv/bin/pip install -r requirements.txt

# Initialize the DB (admin, 2 branches, sample stock) — required before first run
ADMIN_PASSWORD="somePassword" ../.venv/bin/python seed.py

SECRET_KEY="change-me-in-production" ../.venv/bin/python app.py
```

Product API without Docker (stdlib only, no dependencies):

```bash
cd product_api
HBN_PRODUCTS_PORT=5001 python3 app.py
```

Then run the Backoffice with `PRODUCT_API_URL=http://127.0.0.1:5001` instead of the Docker
service DNS name `external-products-api`.

Automated tests: `backoffice/tests/` (pytest — auth, role authorization, stock rules).
Install `backoffice/requirements-dev.txt` (adds `pytest` on top of `requirements.txt`), then
`cd backoffice && ../.venv/bin/python -m pytest tests/ -v`. Each test gets a fresh temp SQLite
DB via the `app_ctx` fixture in `tests/conftest.py`, which re-imports every backoffice module
after setting `DATABASE_URL` (they cache their engine/session at import time) — `product_exists`
is monkeypatched so tests never hit the real Product API.

`backoffice/manual_test.py` is a manual sanity script for the stock validation rules — run
`python seed.py` first (creates the Lyon branch it depends on), then `python manual_test.py`.
`product_api/scripts/smoke_test.py` is a smoke test for the Product API:
`python3 scripts/smoke_test.py http://localhost:5001`.
`product_mcp/manual_test.py` exercises the MCP tools via FastMCP's own `call_tool` path
(needs the Product API running): `PRODUCT_API_URL=http://127.0.0.1:5001
DATABASE_URL="sqlite:///../backoffice/hbntory.db" .venv/bin/python manual_test.py` (run from
`product_mcp/`, with its own venv — see `product_mcp/README.md`).
`ai_service/manual_test.py` checks Product MCP connectivity unconditionally, and additionally
runs the full agent loop against example questions if `ANTHROPIC_API_KEY` is set (own venv,
see `ai_service/README.md`).

Key environment variables (Backoffice): `DATABASE_URL` (default
`sqlite:///hbntory.db`), `ADMIN_PASSWORD` (required, no default, consumed once by
`seed.py`), `SECRET_KEY` (session cookie signing), `PRODUCT_API_URL` (default
`http://localhost:5001`).

## Architecture

### Data boundary (important, enforced throughout the codebase)

The Backoffice's database **never** stores product data (name, price, description, etc.) —
only a `product_sku` string linking to the external Product API. Product details are always
fetched live via `product_client.py`. This boundary is called out in comments in `models.py`,
`stock_service.py`, and `product_client.py` — don't add product fields to the `Stock` model or
cache product data locally.

### Backoffice module layout (`backoffice/`)

- `models.py` — SQLAlchemy models: `Branch`, `User`, `Stock`. A `User` is either `admin`
  (manages users, no branch, no stock access) or `common` (belongs to exactly one branch,
  manages that branch's stock).
- `database.py` — SQLAlchemy engine/session setup (`SessionLocal`, `Base`).
- `security.py` — password hashing (Argon2id via `argon2-cffi`).
- `auth.py` — session-based auth. `get_current_user()` reads `session["user_id"]`, caches on
  `flask.g`, rejects soft-deleted (`is_active=False`) users even with a valid cookie.
  Authorization decorators: `login_required`, `admin_required`, `common_required`. Every
  protected route in `app.py` must be wrapped with these — authorization is enforced only in
  the backend, never trusted from the frontend.
- `validation.py` — stock validation rules (positive-int quantity, product existence check
  against the Product API).
- `stock_service.py` — the *only* sanctioned entry point for mutating stock
  (`add_stock`/`remove_stock`); applies all validation before writing. Never mutate `Stock`
  rows directly elsewhere. `check_product_api=False` exists only for offline/manual testing.
- `user_service.py` — user management business logic (used by admin routes).
- `product_client.py` — the single place that talks HTTP to the external Product API.
  Never raises on network failure/timeout/bad response — returns `None` (single resource) or
  an empty result set (list), so a flaky external API degrades gracefully instead of crashing
  the Backoffice.
- `app.py` — Flask app and all routes, grouped in four families:
  - `/api/login`, `/api/logout`, `/api/me` — auth, open to anyone
  - `/api/users*`, `/api/branches` — admin only
  - `/api/stock*` — common users only, scoped to their own branch
  - `/api/products*` — any authenticated user, read-only proxy to the Product API
- `seed.py` — creates the admin, sample branches, and sample stock; required before first run.
- `static/` — the frontend: plain `index.html` + `app.js` + `style.css`, no framework, no
  build step, consumes the REST API via `fetch()`. Deliberately kept to this stack (see
  `docs/backoffice_ui.md` §1) for auditability.

### Product API (`product_api/`)

Vendored, read-only, stdlib-only Flask-like service. Returns catalog data only (id, name,
description, category, supplier, price, tags) — never stock/reserved/available/reorder
quantities; those live exclusively in the Backoffice DB. Supports `simulate_delay_ms` and
`force_error=true` query params on its endpoints for testing integration robustness against a
slow/broken dependency — the Backoffice's handling of this (via `product_client.py`) is a
core design point, not incidental.

### Product MCP server (`product_mcp/`)

Standalone MCP server (Python `mcp` SDK, `FastMCP`, stdio transport) with its own venv,
independent of the Backoffice's Flask/SQLAlchemy stack. Exposes five read-only, stateless
tools to the AI agent:

- `list_products_tool` — search/filter/paginate the catalog, returns a trimmed
  `ProductSummary` per result (no description/tags/supplier — that's `get_product_details`'s
  job, kept separate so listings don't hand the agent data it didn't ask for).
- `get_product_details` — full details for one product by id/SKU.
- `list_branches_tool`, `get_stock_by_branch_tool`, `get_branches_with_product_tool` —
  stock questions, added in `stock_client.py`. These open the Backoffice's SQLite file
  directly in `mode=ro` (never through `backoffice/`'s own SQLAlchemy session) — a write is
  structurally impossible, not just a convention.

`product_client.py` here is deliberately stricter than `backoffice/product_client.py`: it
raises `ProductNotFoundError` / `ProductAPIError` instead of degrading silently, because an
agent tool must be able to tell "no results" apart from "the catalog is down" rather than
getting an empty list either way. `stock_client.py` mirrors this with `BranchNotFoundError` /
`StockAPIError`. Every tool catches these and re-raises as
`mcp.server.fastmcp.exceptions.ToolError`, which FastMCP turns into a
`CallToolResult(isError=True, ...)` carrying the message — never a silent failure or a raw
stack trace. See `product_mcp/README.md` for the full tool contract and manual test evidence.

### AI Query Service (`ai_service/`)

Flask REST API with a single endpoint, `POST /api/ask` (`{"question": ...}` →
`{"answer": ...}`). `agent.py` runs a standard Anthropic tool-use loop (`MAX_TOOL_TURNS = 8`):
it launches `product_mcp/server.py` as an MCP subprocess (`mcp_client.py`,
`PRODUCT_API_URL`/`DATABASE_URL` forwarded from its own environment), converts the MCP tool
list to Anthropic's `input_schema` format, and lets Claude call tools until it produces a
final text answer. The system prompt (in `agent.py`) is the enforcement point for "never
invent data, say plainly when something is unavailable" (§1.3 of the architecture doc).
Missing `ANTHROPIC_API_KEY`, an LLM API failure, or the MCP subprocess failing to start all
become `AgentError` → HTTP 503 `agent_unavailable`; anything unexpected is caught by a
Flask-wide error handler → 500 `internal_error` (never a raw HTML stack trace). See
`ai_service/README.md` for the full contract.

### Client web interface (`client_web/`)

Plain static page (`index.html` + `app.js` + `style.css`, no framework, no build step, same
approach as `backoffice/static/`), unauthenticated. Calls `ai_service` at
`http://127.0.0.1:5002` by default; override with `?api=http://host:port`. Shows a loading
state while waiting, and on failure shows either the server's `message` (for a reachable but
erroring `ai_service`) or a generic "can't reach the service" message (for a `fetch()`
`TypeError`, i.e. `ai_service` unreachable). See `client_web/README.md` for the documented
example questions.

## Documentation map

- `docs/architecture_and_planning.md` — full system architecture (all 6 services), data flow,
  communication strategy, MVP scope.
- `docs/database_design.md` — relational schema and rationale for `backoffice/models.py`,
  `database.py`, `seed.py`, `validation.py`, `stock_service.py`.
- `docs/authentication_and_authorization.md` — auth/authorization strategy behind
  `backoffice/app.py`, `auth.py`, `security.py`, `user_service.py`.
- `docs/backoffice_ui.md` — rationale for the REST + plain HTML/JS/CSS frontend approach and
  its features.
- `product_api/docs/api_contract.md` / `product_api/docs/openapi.yaml` — full Product API
  contract (endpoints, `simulate_delay_ms`, `force_error`).
- `docs/demo_script.md` — suggested walkthrough for the final presentation/demo (Task 7),
  using the data seeded by `backoffice/seed.py`.
