/*
 * HBntory public client interface. Plain fetch() against the AI Query
 * Service's REST API, no build step, no framework, no authentication
 * (see docs/architecture_and_planning.md §2.2).
 */

// Override at runtime with ?api=http://host:port if the service isn't on
// the default port on the same host the page was opened from.
const AI_SERVICE_URL =
  new URLSearchParams(window.location.search).get("api") ||
  "http://127.0.0.1:5002";

// Backoffice handles all authentication (client_web has none of its own,
// see docs/architecture_and_planning.md §2.2) — the header button just
// links there. Override with ?backoffice=http://host:port.
const BACKOFFICE_URL =
  new URLSearchParams(window.location.search).get("backoffice") ||
  "http://127.0.0.1:5000";
document.getElementById("login-link").href = BACKOFFICE_URL;

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

// Catalog data comes from the external Product API (see catalog.js) —
// escape before injecting into innerHTML so a name/SKU containing " or <
// can't break the markup (e.g. a data-sku attribute) or inject a tag.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* -----------------------------------------------------------------------
 * Theme toggle (defaults to system preference via CSS; a manual pick is
 * persisted so it survives a reload, see style.css :root[data-theme]).
 * --------------------------------------------------------------------- */

const themeToggle = document.getElementById("theme-toggle");
const storedTheme = localStorage.getItem("hbntory-theme");
if (storedTheme) document.documentElement.dataset.theme = storedTheme;

themeToggle.addEventListener("click", () => {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const current = document.documentElement.dataset.theme || (prefersDark ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("hbntory-theme", next);
});

/* -----------------------------------------------------------------------
 * Ask form (Task 5/6 REST contract: POST /api/ask -> {answer})
 * --------------------------------------------------------------------- */

const form = document.getElementById("ask-form");
const input = document.getElementById("question");
const submitBtn = document.getElementById("submit-btn");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const answerEl = document.getElementById("answer");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = input.value.trim();
  if (!question) return;

  hide(errorEl);
  hide(answerEl);
  show(loadingEl);
  submitBtn.disabled = true;

  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });

    const isJson = response.headers.get("content-type")?.includes("json");
    const body = isJson ? await response.json().catch(() => null) : null;

    if (!response.ok) {
      const message = body?.message || `La requête a échoué (${response.status}).`;
      throw new Error(message);
    }

    answerEl.textContent = body.answer;
    show(answerEl);
  } catch (err) {
    const message = err instanceof TypeError
      ? "Impossible de joindre le service. Vérifiez qu'il est bien démarré."
      : err.message;
    errorEl.textContent = message;
    show(errorEl);
  } finally {
    hide(loadingEl);
    submitBtn.disabled = false;
  }
});

// Clicking an example question fills the input instead of just being a
// static list — small affordance, doesn't auto-submit (a real question
// against the local LLM can take 1-3 minutes, see ai_service/README.md).
document.getElementById("example-list").addEventListener("click", (event) => {
  const li = event.target.closest("li");
  if (!li) return;
  input.value = li.textContent.trim();
  input.focus();
});

function askAbout(sku) {
  input.value = `Quels sont les détails du produit ${sku} ?`;
  document.getElementById("assistant-heading")
    .scrollIntoView({ behavior: "smooth", block: "start" });
  input.focus();
}

/* -----------------------------------------------------------------------
 * Catalog (GET /api/catalog -> {branches: [{name, items: [...]}]})
 * --------------------------------------------------------------------- */

const catalogStatusEl = document.getElementById("catalog-status");
const catalogGridEl = document.getElementById("catalog-grid");
const branchFilterEl = document.getElementById("branch-filter");

let catalogBranches = [];
let activeBranch = "all";

function formatPrice(item) {
  if (item.unit_price == null) return null;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: item.currency || "USD",
  }).format(item.unit_price);
}

// Merge the same SKU appearing in several branches into one card with a
// stock badge per branch, so "Toutes les branches" doesn't show duplicates.
function mergedProducts() {
  const bySku = new Map();
  for (const branch of catalogBranches) {
    for (const item of branch.items) {
      if (!bySku.has(item.sku)) {
        bySku.set(item.sku, { ...item, stocks: [] });
      }
      bySku.get(item.sku).stocks.push({
        branch: branch.name,
        quantity: item.quantity,
      });
    }
  }
  return [...bySku.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function productsForActiveBranch() {
  if (activeBranch === "all") return mergedProducts();
  const branch = catalogBranches.find((b) => b.name === activeBranch);
  if (!branch) return [];
  return branch.items
    .map((item) => ({ ...item, stocks: [{ branch: branch.name, quantity: item.quantity }] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderFilters() {
  const branchButtons = catalogBranches
    .map((b) => {
      const name = escapeHtml(b.name);
      return `<button type="button" class="filter-btn" data-branch="${name}" aria-pressed="false">${name}</button>`;
    })
    .join("");
  branchFilterEl.innerHTML =
    `<button type="button" class="filter-btn active" data-branch="all" aria-pressed="true">Toutes les branches</button>${branchButtons}`;
}

function renderGrid() {
  const products = productsForActiveBranch();

  if (products.length === 0) {
    catalogGridEl.innerHTML = "";
    catalogStatusEl.textContent = "Aucun produit en stock pour cette sélection.";
    catalogStatusEl.classList.remove("is-error");
    show(catalogStatusEl);
    hide(catalogGridEl);
    return;
  }

  catalogGridEl.innerHTML = products.map((item, index) => {
    const price = formatPrice(item);
    const sku = escapeHtml(item.sku);
    const badges = item.stocks
      .map((s) => `<span class="stock-badge" data-level="${stockLevel(s.quantity)}">${escapeHtml(s.branch)} · ${s.quantity}</span>`)
      .join("");
    return `
      <button type="button" class="product-card" data-sku="${sku}" style="--i:${index}">
        <span class="category">${escapeHtml(item.category || item.brand || "")}</span>
        <span class="name">${escapeHtml(item.name)}</span>
        <span class="sku">${sku}</span>
        <span class="card-footer">
          ${price ? `<span class="price">${escapeHtml(price)}</span>` : "<span></span>"}
          <span class="stock-badges">${badges}</span>
        </span>
      </button>
    `;
  }).join("");

  hide(catalogStatusEl);
  show(catalogGridEl);
}

// Purely visual (still monochrome — dot fill, not color) — a quick read on
// how healthy a branch's stock is without adding raw thresholds to the API.
function stockLevel(quantity) {
  if (quantity <= 5) return "low";
  if (quantity <= 15) return "medium";
  return "high";
}

function renderSkeletonGrid(count = 6) {
  catalogGridEl.innerHTML = Array.from({ length: count }, () => `
    <div class="product-card skeleton-card" aria-hidden="true">
      <span class="skeleton" style="width:35%"></span>
      <span class="skeleton" style="width:80%"></span>
      <span class="skeleton" style="width:50%"></span>
      <span class="card-footer">
        <span class="skeleton" style="width:30%"></span>
        <span class="skeleton" style="width:35%"></span>
      </span>
    </div>
  `).join("");
  hide(catalogStatusEl);
  show(catalogGridEl);
}

branchFilterEl.addEventListener("click", (event) => {
  const btn = event.target.closest(".filter-btn");
  if (!btn) return;
  activeBranch = btn.dataset.branch;
  for (const b of branchFilterEl.querySelectorAll(".filter-btn")) {
    b.classList.toggle("active", b === btn);
    b.setAttribute("aria-pressed", String(b === btn));
  }
  renderGrid();
});

catalogGridEl.addEventListener("click", (event) => {
  const card = event.target.closest(".product-card");
  if (!card || card.classList.contains("skeleton-card")) return;
  askAbout(card.dataset.sku);
});

async function loadCatalog() {
  renderSkeletonGrid();
  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/catalog`);
    const isJson = response.headers.get("content-type")?.includes("json");
    const body = isJson ? await response.json().catch(() => null) : null;

    if (!response.ok) {
      throw new Error(body?.message || `Le catalogue n'a pas pu être chargé (${response.status}).`);
    }

    catalogBranches = body.branches || [];
    renderFilters();
    renderGrid();
  } catch (err) {
    const message = err instanceof TypeError
      ? "Impossible de joindre le service. Vérifiez qu'il est bien démarré."
      : err.message;
    catalogStatusEl.textContent = message;
    catalogStatusEl.classList.add("is-error");
    show(catalogStatusEl);
    hide(catalogGridEl);
  }
}

loadCatalog();
