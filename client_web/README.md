# HBntory Client Web Interface (Task 6)

Public, unauthenticated static page with two panels: a product **catalog**
(grouped by branch, Lyon/Paris) and the natural-language **assistant** — a
text input, a submit button, and a response area (see
[docs/architecture_and_planning.md](../docs/architecture_and_planning.md)
§2.2 — plain REST, one question per request, no conversation history). No
framework, no build step — `index.html` + `app.js` + `style.css`, same
approach as the Backoffice frontend. Monochrome (black & white) design,
follows the system light/dark theme via `prefers-color-scheme`, with a
restrained indigo/violet/teal accent lifted from the logo
(`docs/assets/hbntory-logo.svg`) applied only to primary actions, focus
rings, and the stock-level dots — the same accent tokens (`--brand-1`,
`--brand-2`, `--brand-teal`) are duplicated in `backoffice/static/style.css`
for a consistent look across both frontends.

## Run

Any static file server works, e.g.:

```bash
cd client_web
python3 -m http.server 5173
```

Open `http://127.0.0.1:5173/`. The page calls the AI Query Service at
`http://127.0.0.1:5002` by default; override with `?api=http://host:port` in
the URL if the service runs elsewhere. The header's "Se connecter" button
links to the Backoffice at `http://127.0.0.1:5000` by default; override
with `?backoffice=http://host:port`.

Requires the AI Query Service (`ai_service/`) running — see
[ai_service/README.md](../ai_service/README.md).

## Behavior

### Header

- Theme toggle (sun/moon icon button) flips between light and dark
  regardless of the system preference, persisted in `localStorage`
  (`hbntory-theme`) so it survives a reload. Without a manual pick, the
  page follows `prefers-color-scheme` automatically.
- "Se connecter" is a plain link to the Backoffice — `client_web` has no
  authentication of its own (see
  [docs/architecture_and_planning.md](../docs/architecture_and_planning.md)
  §2.2), the Backoffice is where admin/common accounts actually log in.

### Catalog panel

- On page load, fetches `GET /api/catalog` and renders one card per
  product, grouped by branch (Lyon, Paris).
- A pill filter bar ("Toutes les branches" + one pill per branch) switches
  between a merged view (same SKU across branches shown once, with one
  stock badge per branch) and a single-branch view.
- Clicking a product card fills the assistant's question input with
  "Quels sont les détails du produit `<sku>` ?", scrolls the assistant
  panel into view, and focuses the input — it does **not** auto-submit,
  since a real answer from the local Ollama model can take 1-3 minutes
  (see [ai_service/README.md](../ai_service/README.md)).

### Assistant panel

- Submitting the form disables the button, shows a "Recherche en cours…"
  loading message, and clears any previous answer/error.
- On success, the answer text replaces the loading message.
- On failure, a clear error message is shown instead (see below) — the
  loading state always clears, in both the success and failure paths.
- Clicking an example question fills the input (also without
  auto-submitting) for the same reason.

## Error handling

- **AI Query Service reachable but returns an error** (400/503/500) — the
  response body's `message` field is shown to the user as-is (already a
  human-readable message from `ai_service`, e.g. "Ollama is not reachable
  at ..." or a Product MCP failure). The catalog panel shows its own
  `GET /api/catalog` error the same way, in place of the grid.
- **AI Query Service unreachable** (wrong URL, service down, CORS/network
  failure) — `fetch()` rejects with a `TypeError`, which is caught and
  replaced with a generic "Impossible de joindre le service. Vérifiez qu'il
  est bien démarré." rather than a raw exception message. Applies to both
  the catalog load and the ask form.

## Example questions

Covers the four categories asked for: product detail, branch availability,
cross-branch availability, and a recommendation question. Shown directly on
the page as clickable examples for discoverability.

| Category | Example |
|---|---|
| Product detail | Quels sont les détails du produit HB-LAP-1001 ? |
| Branch availability | Quels produits sont disponibles dans la branche Lyon ? |
| Product availability across branches | Quelles branches ont du stock du produit HB-KBD-4102 ? |
| Shopping-list recommendation | Je veux équiper un poste de travail complet, que recommandes-tu ? |
| Not found (error path) | As-tu du stock pour un produit qui n'existe pas, XYZ-0000 ? |

## Manual test evidence

Static assets verified served correctly:

```
GET /            -> 200
GET /app.js      -> 200
GET /style.css   -> 200
```

`GET /api/catalog`, the data the catalog panel renders, verified directly
against `ai_service` (2026-07-27, see
[ai_service/README.md](../ai_service/README.md) for the full response) —
Lyon (4 products) and Paris (2 products), both with correct per-branch
quantities.

Header controls verified (2026-07-27): `app.js`/`index.html`/`style.css`
pass a syntax check (`node --check app.js`) and every id/class the
scripts and stylesheet reference (`header-inner`, `header-actions`,
`icon-btn`, `theme-toggle`, `login-link`, `btn-login`, `status-dots`,
`input-row`) exists in the markup. The Backoffice (`http://127.0.0.1:5000`)
was confirmed reachable so the "Se connecter" link resolves.

Full-page manual click-through in a real browser (loading state, answer
rendering, error rendering, catalog filters, card-to-question interaction)
has **not** been performed in this environment (no display/browser
available here) — the request/response logic for both panels was verified
against the live `ai_service` REST API with `curl` instead. Recommend a
manual browser pass once Ollama has pulled a model (`ollama pull
llama3.1:8b`).
