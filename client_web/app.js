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

// Delegated show/hide password toggle (used by the catalog login gate).
document.addEventListener("click", (event) => {
  const btn = event.target.closest(".toggle-password");
  if (!btn) return;
  const passwordInput = document.getElementById(btn.dataset.target);
  const showing = passwordInput.type === "text";
  passwordInput.type = showing ? "password" : "text";
  btn.classList.toggle("is-visible", !showing);
  btn.setAttribute("aria-pressed", String(!showing));
  btn.setAttribute("aria-label", showing ? "Afficher le mot de passe" : "Masquer le mot de passe");
});

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
const questionCountEl = document.getElementById("question-count");
const threadEl = document.getElementById("chat-thread");

input.addEventListener("input", () => {
  questionCountEl.textContent = `${input.value.length}/500`;
  questionCountEl.classList.toggle("warn", input.value.length > 450);
});

// A real question against the local LLM takes 1-3 minutes (see
// ai_service/README.md) — this cycles through the sentence so the wait
// reads as "working" rather than "frozen", and the elapsed-time counter
// gives an honest sense of how long it's actually been.
const PENDING_MESSAGES = [
  "Consultation du catalogue…",
  "Vérification de la disponibilité en stock…",
  "Réflexion en cours…",
  "Rédaction de la réponse…",
];

let turnSeq = 0;
const turns = [];

function turnById(id) { return turns.find((t) => t.id === id); }

function renderThread() {
  threadEl.innerHTML = turns.map(renderTurn).join("");
}

function renderTurn(turn) {
  const userMsg = `
    <div class="chat-msg user">
      <div class="chat-bubble">${escapeHtml(turn.question)}</div>
    </div>`;

  let assistantMsg;
  if (turn.status === "pending") {
    assistantMsg = `
      <div class="chat-msg assistant" data-turn="${turn.id}" data-status="pending">
        <span class="chat-avatar" aria-hidden="true"></span>
        <div class="chat-bubble chat-pending">
          <span class="status-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="chat-pending-text">${escapeHtml(turn.pendingText)}</span>
        </div>
        <div class="chat-meta">
          <span class="chat-elapsed">${turn.elapsed}s</span>
          <button type="button" class="chat-action-btn chat-cancel-btn" data-turn="${turn.id}">Annuler</button>
        </div>
      </div>`;
  } else if (turn.status === "error") {
    assistantMsg = `
      <div class="chat-msg assistant" data-turn="${turn.id}" data-status="error">
        <span class="chat-avatar" aria-hidden="true"></span>
        <div class="chat-bubble chat-error" role="alert">${escapeHtml(turn.error)}</div>
        <div class="chat-meta">
          <button type="button" class="chat-action-btn chat-retry-btn" data-turn="${turn.id}">Réessayer</button>
        </div>
      </div>`;
  } else {
    assistantMsg = `
      <div class="chat-msg assistant" data-turn="${turn.id}" data-status="done">
        <span class="chat-avatar" aria-hidden="true"></span>
        <div class="chat-bubble">${escapeHtml(turn.answer)}</div>
        <div class="chat-meta">
          <span>Répondu en ${turn.duration}s</span>
          <button type="button" class="chat-action-btn chat-copy-btn" data-turn="${turn.id}">Copier</button>
        </div>
      </div>`;
  }
  return userMsg + assistantMsg;
}

function scrollToTurn(id) {
  threadEl.querySelector(`[data-turn="${id}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function runTurn(turn) {
  const controller = new AbortController();
  turn.controller = controller;
  const startedAt = performance.now();
  let messageIndex = 0;

  const tick = () => {
    turn.elapsed = Math.floor((performance.now() - startedAt) / 1000);
    const el = threadEl.querySelector(`[data-turn="${turn.id}"]`);
    if (!el) return;
    const elapsedEl = el.querySelector(".chat-elapsed");
    if (elapsedEl) elapsedEl.textContent = `${turn.elapsed}s`;
    if (turn.elapsed > 0 && turn.elapsed % 8 === 0) {
      messageIndex = (messageIndex + 1) % PENDING_MESSAGES.length;
      turn.pendingText = PENDING_MESSAGES[messageIndex];
      const textEl = el.querySelector(".chat-pending-text");
      if (textEl) textEl.textContent = turn.pendingText;
    }
  };
  turn.timer = setInterval(tick, 1000);

  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: turn.question }),
      signal: controller.signal,
    });

    const isJson = response.headers.get("content-type")?.includes("json");
    const body = isJson ? await response.json().catch(() => null) : null;

    if (!response.ok) {
      throw new Error(body?.message || `La requête a échoué (${response.status}).`);
    }

    turn.status = "done";
    turn.answer = body.answer;
    turn.duration = Math.round((performance.now() - startedAt) / 1000);
  } catch (err) {
    if (err.name === "AbortError") {
      turn.status = "error";
      turn.error = "Question annulée.";
    } else {
      turn.status = "error";
      turn.error = err instanceof TypeError
        ? "Impossible de joindre le service. Vérifiez qu'il est bien démarré."
        : err.message;
    }
  } finally {
    clearInterval(turn.timer);
    submitBtn.disabled = turns.some((t) => t.status === "pending");
    renderThread();
  }
}

function submitQuestion(question) {
  const turn = {
    id: ++turnSeq,
    question,
    status: "pending",
    pendingText: PENDING_MESSAGES[0],
    elapsed: 0,
  };
  turns.push(turn);
  submitBtn.disabled = true;
  renderThread();
  scrollToTurn(turn.id);
  runTurn(turn);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  questionCountEl.textContent = "0/500";
  submitQuestion(question);
});

threadEl.addEventListener("click", (event) => {
  const cancelBtn = event.target.closest(".chat-cancel-btn");
  if (cancelBtn) {
    turnById(Number(cancelBtn.dataset.turn))?.controller.abort();
    return;
  }
  const retryBtn = event.target.closest(".chat-retry-btn");
  if (retryBtn) {
    const turn = turnById(Number(retryBtn.dataset.turn));
    if (turn) submitQuestion(turn.question);
    return;
  }
  const copyBtn = event.target.closest(".chat-copy-btn");
  if (copyBtn) {
    const turn = turnById(Number(copyBtn.dataset.turn));
    if (!turn) return;
    navigator.clipboard?.writeText(turn.answer).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copié !";
      setTimeout(() => { copyBtn.textContent = original; }, 1500);
    });
  }
});

// Clicking an example question fills the input instead of just being a
// static list — small affordance, doesn't auto-submit (a real question
// against the local LLM can take 1-3 minutes, see ai_service/README.md).
document.getElementById("example-list").addEventListener("click", (event) => {
  const li = event.target.closest("li");
  if (!li) return;
  input.value = li.textContent.trim();
  input.dispatchEvent(new Event("input"));
  input.focus();
});

function askAbout(sku) {
  input.value = `Quels sont les détails du produit ${sku} ?`;
  input.dispatchEvent(new Event("input"));
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

/* -----------------------------------------------------------------------
 * Catalog login gate — the catalog is reserved to Backoffice accounts.
 * client_web has no accounts of its own, so this calls the Backoffice's
 * own /api/login and /api/me cross-origin, with the session cookie
 * (credentials: "include"). See backoffice/app.py's CORS allowlist
 * (_CORS_ORIGINS/_CORS_PATHS) — only these two routes plus /api/logout
 * accept cross-origin credentialed requests, scoped to the client_web
 * origin(s). The assistant above stays fully anonymous either way, per
 * the subject's requirement that anonymous users can always ask questions.
 * --------------------------------------------------------------------- */

const catalogGateEl = document.getElementById("catalog-gate");
const catalogSessionEl = document.getElementById("catalog-session");
const catalogSessionLabelEl = document.getElementById("catalog-session-label");
const catalogLoginForm = document.getElementById("catalog-login-form");
const catalogLoginBtn = document.getElementById("catalog-login-btn");
const catalogLoginErrorEl = document.getElementById("catalog-login-error");

function showCatalogGate() {
  hide(catalogSessionEl);
  hide(branchFilterEl);
  hide(catalogGridEl);
  hide(catalogStatusEl);
  show(catalogGateEl);
}

function showCatalogUnlocked(me) {
  hide(catalogGateEl);
  hide(catalogLoginErrorEl);
  catalogSessionEl.dataset.role = me.role;
  catalogSessionLabelEl.textContent = me.role === "admin"
    ? `Connecté : ${me.username} (Administrateur)`
    : `Connecté : ${me.username} — ${me.branch_name ?? "?"}`;
  show(catalogSessionEl);
  show(branchFilterEl);
  loadCatalog();
}

async function fetchBackofficeMe() {
  try {
    const response = await fetch(`${BACKOFFICE_URL}/api/me`, { credentials: "include" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

catalogLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = document.getElementById("catalog-username").value.trim();
  const password = document.getElementById("catalog-password").value;

  hide(catalogLoginErrorEl);
  catalogLoginBtn.disabled = true;
  try {
    const response = await fetch(`${BACKOFFICE_URL}/api/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const isJson = response.headers.get("content-type")?.includes("json");
    const body = isJson ? await response.json().catch(() => null) : null;

    if (!response.ok) {
      throw new Error(body?.error || `Connexion refusée (${response.status}).`);
    }

    document.getElementById("catalog-password").value = "";
    const me = await fetchBackofficeMe();
    showCatalogUnlocked(me || body);
  } catch (err) {
    const message = err instanceof TypeError
      ? "Impossible de joindre le Backoffice. Vérifiez qu'il est bien démarré."
      : err.message;
    catalogLoginErrorEl.textContent = message;
    show(catalogLoginErrorEl);
  } finally {
    catalogLoginBtn.disabled = false;
  }
});

document.getElementById("catalog-logout-btn").addEventListener("click", async () => {
  try {
    await fetch(`${BACKOFFICE_URL}/api/logout`, { method: "POST", credentials: "include" });
  } catch {
    // Best-effort: even if the request fails, drop the local catalog view.
  }
  showCatalogGate();
});

(async () => {
  const me = await fetchBackofficeMe();
  if (me) {
    showCatalogUnlocked(me);
  } else {
    showCatalogGate();
  }
})();
