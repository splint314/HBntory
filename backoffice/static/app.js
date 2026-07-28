/*
 * HBntory Backoffice frontend. Plain fetch() against the REST API in
 * app.py, no build step, no framework: this is a thin view layer, all
 * authorization decisions are re-checked server-side regardless of what
 * this script shows or hides.
 */

const state = {
  me: null,        // current user, from GET /api/me
  products: [],     // catalog cache from the Product API, for the SKU dropdown
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

// Same thresholds as client_web's catalog stock badges — a quick read on
// branch stock health without adding a formal level to the API.
function stockLevel(quantity) {
  if (quantity <= 5) return "low";
  if (quantity <= 15) return "medium";
  return "high";
}

function skeletonRows(tbody, colCount, rowCount = 3) {
  const cell = '<td><span class="skeleton"></span></td>';
  tbody.innerHTML = Array.from(
    { length: rowCount },
    () => `<tr aria-hidden="true">${cell.repeat(colCount)}</tr>`,
  ).join("");
}

let stockBySku = new Map(); // product_sku -> quantity in the user's branch
let catalogSearchTerm = "";

function formatPrice(product) {
  if (product.unit_price == null) return null;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: product.currency || "USD",
  }).format(product.unit_price);
}

function updateCommonStats() {
  const quantities = [...stockBySku.values()];
  document.getElementById("stat-common-skus").textContent = quantities.length;
  document.getElementById("stat-common-units").textContent =
    quantities.reduce((sum, q) => sum + q, 0);
  document.getElementById("stat-common-low").textContent =
    quantities.filter((q) => stockLevel(q) === "low").length;
}

function filteredCatalogProducts() {
  const term = catalogSearchTerm.trim().toLowerCase();
  if (!term) return state.products;
  return state.products.filter((p) =>
    p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)
  );
}

function renderCatalogSkeleton(count = 6) {
  const grid = document.getElementById("stock-catalog-grid");
  hide("stock-catalog-empty");
  grid.innerHTML = Array.from({ length: count }, () => `
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
}

function renderCatalogGrid() {
  const grid = document.getElementById("stock-catalog-grid");
  const products = filteredCatalogProducts();

  document.getElementById("stock-catalog-empty").classList.toggle("hidden", products.length > 0);
  if (products.length === 0) {
    grid.innerHTML = "";
    return;
  }

  grid.innerHTML = products.map((product, index) => {
    const quantity = stockBySku.get(product.sku) ?? 0;
    const price = formatPrice(product);
    const sku = escapeHtml(product.sku);
    const name = escapeHtml(product.name);
    return `
      <div class="product-card" data-sku="${sku}" style="--i:${index}">
        <span class="category">${escapeHtml(product.category || product.brand || "")}</span>
        <span class="name">${name}</span>
        <span class="sku">${sku}</span>
        <span class="card-footer">
          ${price ? `<span class="price">${escapeHtml(price)}</span>` : "<span></span>"}
          <span class="quantity-cell" data-level="${stockLevel(quantity)}">${quantity}</span>
        </span>
        <div class="card-controls">
          <div class="quantity-stepper">
            <button type="button" class="stepper-btn" data-action="dec" aria-label="Diminuer la quantité">−</button>
            <input type="number" class="card-qty-input" min="1" step="1" value="1" aria-label="Quantité pour ${name}">
            <button type="button" class="stepper-btn" data-action="inc" aria-label="Augmenter la quantité">+</button>
          </div>
          <div class="button-row">
            <button type="button" class="card-add-btn">Ajouter</button>
            <button type="button" class="card-remove-btn secondary">Retirer</button>
          </div>
        </div>
        <p class="card-message" aria-live="polite"></p>
      </div>
    `;
  }).join("");
}

async function loadStockCatalog() {
  renderCatalogSkeleton();
  const [productsData, stockItems] = await Promise.all([
    api("/api/products?limit=100"),
    api("/api/stock"),
  ]);
  state.products = productsData.results || [];
  stockBySku = new Map(stockItems.map((item) => [item.product_sku, item.quantity]));
  updateCommonStats();
  renderCatalogGrid();
}

document.getElementById("stock-catalog-search").addEventListener("input", (e) => {
  catalogSearchTerm = e.target.value;
  renderCatalogGrid();
});

async function submitCardStockChange(card, endpoint) {
  const sku = card.dataset.sku;
  const quantity = parseInt(card.querySelector(".card-qty-input").value, 10);
  const messageEl = card.querySelector(".card-message");
  const buttons = card.querySelectorAll("button");

  messageEl.textContent = "";
  delete messageEl.dataset.tone;
  buttons.forEach((b) => { b.disabled = true; });

  try {
    const result = await api(endpoint, {
      method: "POST",
      body: JSON.stringify({ product_sku: sku, quantity }),
    });
    stockBySku.set(sku, result.quantity);
    const badge = card.querySelector(".quantity-cell");
    badge.textContent = result.quantity;
    badge.dataset.level = stockLevel(result.quantity);
    messageEl.textContent = "Stock mis à jour.";
    messageEl.dataset.tone = "success";
    updateCommonStats();
  } catch (err) {
    messageEl.textContent = err.message;
    messageEl.dataset.tone = "error";
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

document.getElementById("stock-catalog-grid").addEventListener("click", (event) => {
  const card = event.target.closest(".product-card");
  if (!card || card.classList.contains("skeleton-card")) return;

  const stepBtn = event.target.closest(".stepper-btn");
  if (stepBtn) {
    const input = card.querySelector(".card-qty-input");
    const current = parseInt(input.value, 10) || 1;
    input.value = stepBtn.dataset.action === "inc" ? current + 1 : Math.max(1, current - 1);
    return;
  }

  if (event.target.closest(".card-add-btn")) {
    submitCardStockChange(card, "/api/stock/add");
  } else if (event.target.closest(".card-remove-btn")) {
    submitCardStockChange(card, "/api/stock/remove");
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
  for (const user of users) {
    const tr = document.createElement("tr");
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
  }

  document.getElementById("stat-admin-users").textContent =
    users.filter((u) => u.is_active).length;
  document.getElementById("stat-admin-branches").textContent = branches.length;
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
