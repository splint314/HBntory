/*
 * HBntory Backoffice frontend. Plain fetch() against the REST API in
 * app.py, no build step, no framework: this is a thin view layer, all
 * authorization decisions are re-checked server-side regardless of what
 * this script shows or hides.
 */

const state = {
  me: null,        // current user, from GET /api/me
  products: [],     // catalog cache from the Product API, for the stock grid
  stock: [],        // current branch's stock rows, from GET /api/stock
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const isJson = response.headers.get("content-type")?.includes("json");
  const body = isJson ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    // A 401/403 on anything other than the session check itself usually
    // means the session cookie changed under this tab — e.g. logging into
    // client_web's catalog gate as a different account, which shares the
    // same browser cookie for this origin. Resync so the UI reflects who
    // is actually authenticated instead of just failing against a stale
    // cached role (avoid path === "/api/me" to not recurse into itself).
    if ((response.status === 401 || response.status === 403) && path !== "/api/me") {
      refreshSession();
    }
    const message = body?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body;
}

function show(id) {
  document.getElementById(id).classList.remove("hidden");
}
function hide(id) {
  document.getElementById(id).classList.add("hidden");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Animates a stat-value's digits counting up to its new total instead of
// just snapping to it. Purely cosmetic — reduced-motion users get an
// instant jump since the CSS animation-duration override makes each step
// resolve within a single frame.
function animateCount(el, target) {
  const start = parseInt(el.textContent, 10) || 0;
  if (start === target) { el.textContent = target; return; }
  const duration = 500;
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Theme toggle (defaults to system preference via CSS; a manual pick is
// persisted so it survives a reload, see style.css :root[data-theme]).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Show/hide password
// ---------------------------------------------------------------------------

// Delegated so it also picks up the toggle button the admin modal injects
// dynamically for the "change password" action (see openModal() below).
document.addEventListener("click", (event) => {
  const btn = event.target.closest(".toggle-password");
  if (!btn) return;
  const input = document.getElementById(btn.dataset.target);
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  btn.classList.toggle("is-visible", !showing);
  btn.setAttribute("aria-pressed", String(!showing));
  btn.setAttribute("aria-label", showing ? "Afficher le mot de passe" : "Masquer le mot de passe");
});

// ---------------------------------------------------------------------------
// Modal (replaces native prompt()/confirm() for admin actions, see below)
// ---------------------------------------------------------------------------

const modal = document.getElementById("modal");
const modalForm = document.getElementById("modal-form");
const modalTitle = document.getElementById("modal-title");
const modalBody = document.getElementById("modal-body");
const modalError = document.getElementById("modal-error");
const modalConfirmBtn = document.getElementById("modal-confirm-btn");

function openModal({ title, bodyHtml, confirmLabel = "Confirmer", danger = false, onConfirm }) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalError.textContent = "";
  modalConfirmBtn.textContent = confirmLabel;
  modalConfirmBtn.classList.toggle("danger", danger);
  modal.showModal();
  modalBody.querySelector("input, select")?.focus();

  modalForm.onsubmit = async (event) => {
    event.preventDefault();
    modalConfirmBtn.disabled = true;
    try {
      await onConfirm(modalBody);
      modal.close();
    } catch (err) {
      modalError.textContent = err.message;
    } finally {
      modalConfirmBtn.disabled = false;
    }
  };
}

document.getElementById("modal-cancel").addEventListener("click", () => modal.close());

// A click that lands on the <dialog> element itself (not its content box)
// is a click on the ::backdrop — close on it, like the Escape key already does.
modal.addEventListener("click", (event) => {
  if (event.target === modal) modal.close();
});

// ---------------------------------------------------------------------------
// Login role toggle — purely a UX shortcut, not a real auth mode: the API
// only ever checks username+password (see app.py). Since the subject fixes
// the admin account to a single username ("admin"), picking "Administrateur"
// just locks that in so nobody has to type or mistype it.
// ---------------------------------------------------------------------------

document.querySelectorAll(".role-toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".role-toggle-btn").forEach((b) => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-pressed", String(b === btn));
    });
    const usernameInput = document.getElementById("login-username");
    if (btn.dataset.role === "admin") {
      usernameInput.value = "admin";
      usernameInput.readOnly = true;
      document.getElementById("login-password").focus();
    } else {
      usernameInput.value = "";
      usernameInput.readOnly = false;
      usernameInput.focus();
    }
  });
});

// ---------------------------------------------------------------------------
// Section navigation (dashboard <-> the actual management page), per role.
// ---------------------------------------------------------------------------

function switchView(navId, pages, view) {
  const nav = document.getElementById(navId);
  for (const btn of nav.querySelectorAll(".nav-btn")) {
    btn.classList.toggle("active", btn.dataset.view === view);
  }
  for (const [key, el] of Object.entries(pages)) {
    el.classList.toggle("hidden", key !== view);
  }
}

function setupViewNav(navId, pages) {
  document.getElementById(navId).addEventListener("click", (event) => {
    const btn = event.target.closest(".nav-btn");
    if (!btn) return;
    switchView(navId, pages, btn.dataset.view);
  });
}

const commonPages = {
  dashboard: document.getElementById("common-page-dashboard"),
  stock: document.getElementById("common-page-stock"),
  assistant: document.getElementById("common-page-assistant"),
};
const adminPages = {
  dashboard: document.getElementById("admin-page-dashboard"),
  users: document.getElementById("admin-page-users"),
};
setupViewNav("common-nav", commonPages);
setupViewNav("admin-nav", adminPages);
document.getElementById("go-to-stock-btn").addEventListener("click", () => {
  switchView("common-nav", commonPages, "stock");
});
document.getElementById("go-to-assistant-btn").addEventListener("click", () => {
  switchView("common-nav", commonPages, "assistant");
});
document.getElementById("go-to-users-btn").addEventListener("click", () => {
  switchView("admin-nav", adminPages, "users");
});

// ---------------------------------------------------------------------------
// Session / login
// ---------------------------------------------------------------------------

async function refreshSession() {
  try {
    state.me = await api("/api/me");
  } catch {
    state.me = null;
  }
  render();
}

async function render() {
  if (!state.me) {
    hide("common-view");
    hide("admin-view");
    hide("user-info");
    hide("role-banner");
    show("login-view");
    document.getElementById("login-username").focus();
    return;
  }

  hide("login-view");
  show("user-info");
  show("role-banner");
  document.getElementById("user-label").textContent =
    `${state.me.username} (${state.me.role})`;

  const banner = document.getElementById("role-banner");
  banner.dataset.role = state.me.role;
  document.getElementById("role-banner-text").textContent =
    state.me.role === "admin"
      ? "Connecté en tant qu'Administrateur"
      : `Connecté en tant qu'Utilisateur — Branche ${state.me.branch_name ?? "?"}`;

  if (state.me.role === "admin") {
    hide("common-view");
    show("admin-view");
    switchView("admin-nav", adminPages, "dashboard");
    await loadUsers();
    await loadBranchesIntoSelect("new-branch");
  } else {
    hide("admin-view");
    show("common-view");
    switchView("common-nav", commonPages, "dashboard");
    await loadStockCatalog();
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  const submitBtn = e.target.querySelector("button[type=submit]");
  errorEl.textContent = "";
  submitBtn.disabled = true;
  submitBtn.textContent = "Connexion…";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
    document.getElementById("login-password").value = "";
    await refreshSession();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Se connecter";
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  state.me = null;
  render();
});

// ---------------------------------------------------------------------------
// Common user: product catalog + stock (search, add/remove per card)
// ---------------------------------------------------------------------------

async function loadProducts() {
  const data = await api("/api/products?limit=100");
  state.products = data.results || [];
}

// Same thresholds as client_web's catalog stock badges — a quick read on
// branch stock health without adding a formal level to the API.
function stockLevel(quantity) {
  if (quantity <= 5) return "low";
  if (quantity <= 15) return "medium";
  return "high";
}

function skeletonCards(count = 8) {
  document.getElementById("stock-grid").innerHTML = Array.from(
    { length: count },
    () => `
      <div class="stock-card" aria-hidden="true">
        <span class="skeleton" style="width:40%"></span>
        <span class="skeleton" style="width:80%"></span>
        <span class="skeleton" style="width:55%"></span>
      </div>
    `,
  ).join("");
}

function quantityForSku(sku) {
  return state.stock.find((s) => s.product_sku === sku)?.quantity ?? 0;
}

function updateCommonStats() {
  const items = state.stock;
  animateCount(document.getElementById("stat-common-skus"), items.length);
  animateCount(
    document.getElementById("stat-common-units"),
    items.reduce((sum, item) => sum + item.quantity, 0),
  );
  animateCount(
    document.getElementById("stat-common-low"),
    items.filter((item) => stockLevel(item.quantity) === "low").length,
  );
}

function formatProductPrice(product) {
  if (product.unit_price == null) return null;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: product.currency || "USD",
  }).format(product.unit_price);
}

function renderStockGrid() {
  const grid = document.getElementById("stock-grid");
  const query = stockSearchEl.value.trim().toLowerCase();
  const products = state.products.filter(
    (p) =>
      !query ||
      p.name.toLowerCase().includes(query) ||
      p.sku.toLowerCase().includes(query),
  );

  document.getElementById("stock-empty").classList.toggle("hidden", products.length > 0);
  if (products.length === 0) {
    grid.innerHTML = "";
    return;
  }

  grid.innerHTML = products.map((product, index) => {
    const sku = escapeHtml(product.sku);
    const name = escapeHtml(product.name);
    const quantity = quantityForSku(product.sku);
    const price = formatProductPrice(product);
    return `
      <div class="stock-card" data-sku="${sku}" style="--i:${index}">
        <span class="category">${escapeHtml(product.category || product.brand || "")}</span>
        <span class="name">${name}</span>
        <span class="sku">${sku}</span>
        <span class="card-footer">
          ${price ? `<span class="price">${escapeHtml(price)}</span>` : "<span></span>"}
          <span class="quantity-cell" data-level="${stockLevel(quantity)}">${quantity}</span>
        </span>
        <div class="stock-card-controls">
          <div class="quantity-stepper">
            <button type="button" class="stepper-btn" data-action="dec" aria-label="Diminuer la quantité — ${name}">−</button>
            <input type="number" class="stock-card-qty" min="1" step="1" value="1" aria-label="Quantité — ${name}">
            <button type="button" class="stepper-btn" data-action="inc" aria-label="Augmenter la quantité — ${name}">+</button>
          </div>
          <div class="button-row">
            <button type="button" class="stock-card-add">Ajouter</button>
            <button type="button" class="stock-card-remove secondary">Retirer</button>
          </div>
        </div>
        <p class="card-message" aria-live="polite"></p>
      </div>
    `;
  }).join("");
}

async function loadStock() {
  skeletonCards();
  state.stock = await api("/api/stock");
  updateCommonStats();
  renderStockGrid();
}

const stockSearchEl = document.getElementById("stock-search");
stockSearchEl.addEventListener("input", renderStockGrid);

async function submitCardStockChange(card, endpoint) {
  const sku = card.dataset.sku;
  const quantityInput = card.querySelector(".stock-card-qty");
  const quantity = parseInt(quantityInput.value, 10);
  const addBtn = card.querySelector(".stock-card-add");
  const removeBtn = card.querySelector(".stock-card-remove");
  const messageEl = card.querySelector(".card-message");

  addBtn.disabled = true;
  removeBtn.disabled = true;
  try {
    const result = await api(endpoint, {
      method: "POST",
      body: JSON.stringify({ product_sku: sku, quantity }),
    });

    const existing = state.stock.find((s) => s.product_sku === sku);
    if (existing) {
      existing.quantity = result.quantity;
    } else {
      state.stock.push({
        branch_id: result.branch_id,
        product_sku: sku,
        quantity: result.quantity,
      });
    }
    const badge = card.querySelector(".quantity-cell");
    badge.textContent = result.quantity;
    badge.dataset.level = stockLevel(result.quantity);
    updateCommonStats();

    messageEl.textContent = "Stock mis à jour.";
    messageEl.className = "card-message success";
  } catch (err) {
    messageEl.textContent = err.message;
    messageEl.className = "card-message error";
  } finally {
    addBtn.disabled = false;
    removeBtn.disabled = false;
  }
}

document.getElementById("stock-grid").addEventListener("click", (event) => {
  const card = event.target.closest(".stock-card");
  if (!card) return;
  const qtyInput = card.querySelector(".stock-card-qty");

  const stepBtn = event.target.closest(".stepper-btn");
  if (stepBtn) {
    const current = parseInt(qtyInput.value, 10) || 1;
    qtyInput.value = stepBtn.dataset.action === "dec" ? Math.max(1, current - 1) : current + 1;
    return;
  }
  if (event.target.closest(".stock-card-add")) {
    submitCardStockChange(card, "/api/stock/add");
    return;
  }
  if (event.target.closest(".stock-card-remove")) {
    submitCardStockChange(card, "/api/stock/remove");
  }
});

// ---------------------------------------------------------------------------
// Common user: product assistant (same ai_service /api/ask contract as
// client_web — no separate account, just the Service IA REST API).
// ---------------------------------------------------------------------------

const AI_SERVICE_URL =
  new URLSearchParams(window.location.search).get("api") ||
  "http://127.0.0.1:5002";

const assistantForm = document.getElementById("assistant-form");
const assistantInput = document.getElementById("assistant-question");
const assistantSubmitBtn = document.getElementById("assistant-submit-btn");
const assistantCountEl = document.getElementById("assistant-question-count");
const assistantThreadEl = document.getElementById("assistant-thread");

assistantInput.addEventListener("input", () => {
  assistantCountEl.textContent = `${assistantInput.value.length}/500`;
  assistantCountEl.classList.toggle("warn", assistantInput.value.length > 450);
});

// A real question against the local LLM takes 1-3 minutes (see
// ai_service/README.md) — cycling this reassures the user the request is
// progressing rather than stuck, and the elapsed counter is an honest
// read on how long it's actually been.
const ASSISTANT_PENDING_MESSAGES = [
  "Consultation du catalogue…",
  "Vérification de la disponibilité en stock…",
  "Réflexion en cours…",
  "Rédaction de la réponse…",
];

let assistantTurnSeq = 0;
const assistantTurns = [];

function assistantTurnById(id) { return assistantTurns.find((t) => t.id === id); }

function renderAssistantThread() {
  assistantThreadEl.innerHTML = assistantTurns.map(renderAssistantTurn).join("");
}

function renderAssistantTurn(turn) {
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

async function runAssistantTurn(turn) {
  const controller = new AbortController();
  turn.controller = controller;
  const startedAt = performance.now();
  let messageIndex = 0;

  const tick = () => {
    turn.elapsed = Math.floor((performance.now() - startedAt) / 1000);
    const el = assistantThreadEl.querySelector(`[data-turn="${turn.id}"]`);
    if (!el) return;
    const elapsedEl = el.querySelector(".chat-elapsed");
    if (elapsedEl) elapsedEl.textContent = `${turn.elapsed}s`;
    if (turn.elapsed > 0 && turn.elapsed % 8 === 0) {
      messageIndex = (messageIndex + 1) % ASSISTANT_PENDING_MESSAGES.length;
      turn.pendingText = ASSISTANT_PENDING_MESSAGES[messageIndex];
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
        ? "Impossible de joindre le Service IA. Vérifiez qu'il est bien démarré."
        : err.message;
    }
  } finally {
    clearInterval(turn.timer);
    assistantSubmitBtn.disabled = assistantTurns.some((t) => t.status === "pending");
    renderAssistantThread();
  }
}

function submitAssistantQuestion(question) {
  const turn = {
    id: ++assistantTurnSeq,
    question,
    status: "pending",
    pendingText: ASSISTANT_PENDING_MESSAGES[0],
    elapsed: 0,
  };
  assistantTurns.push(turn);
  assistantSubmitBtn.disabled = true;
  renderAssistantThread();
  assistantThreadEl.querySelector(`[data-turn="${turn.id}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
  runAssistantTurn(turn);
}

assistantForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const question = assistantInput.value.trim();
  if (!question) return;
  assistantInput.value = "";
  assistantCountEl.textContent = "0/500";
  submitAssistantQuestion(question);
});

assistantThreadEl.addEventListener("click", (event) => {
  const cancelBtn = event.target.closest(".chat-cancel-btn");
  if (cancelBtn) {
    assistantTurnById(Number(cancelBtn.dataset.turn))?.controller.abort();
    return;
  }
  const retryBtn = event.target.closest(".chat-retry-btn");
  if (retryBtn) {
    const turn = assistantTurnById(Number(retryBtn.dataset.turn));
    if (turn) submitAssistantQuestion(turn.question);
    return;
  }
  const copyBtn = event.target.closest(".chat-copy-btn");
  if (copyBtn) {
    const turn = assistantTurnById(Number(copyBtn.dataset.turn));
    if (!turn) return;
    navigator.clipboard?.writeText(turn.answer).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copié !";
      setTimeout(() => { copyBtn.textContent = original; }, 1500);
    });
  }
});

// ---------------------------------------------------------------------------
// Admin: users
// ---------------------------------------------------------------------------

async function loadBranchesIntoSelect(selectId, selectedId = null) {
  const branches = await api("/api/branches");
  const select = document.getElementById(selectId);
  select.innerHTML = "";
  for (const branch of branches) {
    const option = document.createElement("option");
    option.value = branch.id;
    option.textContent = branch.name;
    if (selectedId !== null && branch.id === selectedId) option.selected = true;
    select.appendChild(option);
  }
  return branches;
}

async function loadUsers() {
  const tbody = document.querySelector("#users-table tbody");
  skeletonRows(tbody, 5);
  const [users, branches] = await Promise.all([api("/api/users"), api("/api/branches")]);
  const branchName = (id) => branches.find((b) => b.id === id)?.name ?? "—";

  tbody.innerHTML = "";
  users.forEach((user, index) => {
    const tr = document.createElement("tr");
    tr.style.setProperty("--i", index);
    const actionsTd = document.createElement("td");
    actionsTd.className = "actions";

    if (user.role === "common" && user.is_active) {
      const pwBtn = document.createElement("button");
      pwBtn.textContent = "Mot de passe";
      pwBtn.className = "secondary";
      pwBtn.addEventListener("click", () => changePassword(user.id));
      actionsTd.appendChild(pwBtn);

      const branchBtn = document.createElement("button");
      branchBtn.textContent = "Changer branche";
      branchBtn.className = "secondary";
      branchBtn.addEventListener("click", () => changeBranch(user.id, branches));
      actionsTd.appendChild(branchBtn);

      const delBtn = document.createElement("button");
      delBtn.textContent = "Supprimer";
      delBtn.className = "danger";
      delBtn.addEventListener("click", () => softDeleteUser(user.id, user.username));
      actionsTd.appendChild(delBtn);
    }

    tr.innerHTML = `
      <td>${escapeHtml(user.username)}</td>
      <td><span class="role-badge" data-role="${user.role}">${user.role}</span></td>
      <td>${user.branch_id !== null ? escapeHtml(branchName(user.branch_id)) : "—"}</td>
      <td><span class="status-badge" data-active="${user.is_active}">${user.is_active ? "actif" : "supprimé"}</span></td>
    `;
    tr.appendChild(actionsTd);
    tbody.appendChild(tr);
  });

  animateCount(
    document.getElementById("stat-admin-users"),
    users.filter((u) => u.is_active).length,
  );
  animateCount(document.getElementById("stat-admin-branches"), branches.length);
}

function reportAdmin(message, ok) {
  const el = document.getElementById("admin-message");
  el.textContent = message;
  el.className = ok ? "success" : "error";
}

function changePassword(userId) {
  openModal({
    title: "Changer le mot de passe",
    confirmLabel: "Changer",
    bodyHtml: `
      <label>Nouveau mot de passe
        <div class="password-field">
          <input type="password" id="modal-password" minlength="8" required>
          <button type="button" class="toggle-password" data-target="modal-password" aria-label="Afficher le mot de passe" aria-pressed="false">
            <svg class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <svg class="icon-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.6 21.6 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a21.6 21.6 0 0 1-2.16 3.19M1 1l22 22"/>
            </svg>
          </button>
        </div>
      </label>
    `,
    onConfirm: async (body) => {
      const password = body.querySelector("#modal-password").value;
      await api(`/api/users/${userId}/password`, {
        method: "PATCH",
        body: JSON.stringify({ password }),
      });
      reportAdmin("Mot de passe changé.", true);
    },
  });
}

function changeBranch(userId, branches) {
  const options = branches
    .map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`)
    .join("");
  openModal({
    title: "Changer de branche",
    confirmLabel: "Changer",
    bodyHtml: `<label>Nouvelle branche <select id="modal-branch">${options}</select></label>`,
    onConfirm: async (body) => {
      const branchId = parseInt(body.querySelector("#modal-branch").value, 10);
      await api(`/api/users/${userId}/branch`, {
        method: "PATCH",
        body: JSON.stringify({ branch_id: branchId }),
      });
      reportAdmin("Branche changée.", true);
      await loadUsers();
    },
  });
}

function softDeleteUser(userId, username) {
  openModal({
    title: "Supprimer l'utilisateur",
    confirmLabel: "Supprimer",
    danger: true,
    bodyHtml: `<p>Confirmer la suppression (soft-delete) de « <strong>${escapeHtml(username)}</strong> » ?
      Ce compte sera désactivé mais conservé pour l'historique.</p>`,
    onConfirm: async () => {
      await api(`/api/users/${userId}`, { method: "DELETE" });
      reportAdmin("Utilisateur supprimé.", true);
      await loadUsers();
    },
  });
}

document.getElementById("create-user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("new-username").value;
  const password = document.getElementById("new-password").value;
  const branchId = parseInt(document.getElementById("new-branch").value, 10);
  const messageEl = document.getElementById("create-user-message");
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({ username, password, branch_id: branchId }),
    });
    messageEl.textContent = `Utilisateur "${username}" créé.`;
    messageEl.className = "success";
    document.getElementById("create-user-form").reset();
    await loadUsers();
  } catch (err) {
    messageEl.textContent = err.message;
    messageEl.className = "error";
  }
});

refreshSession();
