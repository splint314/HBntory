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
    show("login-view");
    document.getElementById("login-username").focus();
    return;
  }

  hide("login-view");
  show("user-info");
  document.getElementById("user-label").textContent =
    `${state.me.username} (${state.me.role})`;

  if (state.me.role === "admin") {
    hide("common-view");
    show("admin-view");
    await loadUsers();
    await loadBranchesIntoSelect("new-branch");
  } else {
    hide("admin-view");
    show("common-view");
    document.getElementById("branch-banner").textContent =
      `Branche : ${state.me.branch_name ?? "?"}`;
    await loadProducts();
    await loadStock();
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
// Common user: stock
// ---------------------------------------------------------------------------

async function loadProducts() {
  const data = await api("/api/products?limit=100");
  state.products = data.results || [];
  const select = document.getElementById("stock-product");
  select.innerHTML = "";
  for (const product of state.products) {
    const option = document.createElement("option");
    option.value = product.sku;
    option.textContent = `${product.sku} — ${product.name}`;
    select.appendChild(option);
  }
}

function productName(sku) {
  const product = state.products.find((p) => p.sku === sku);
  return product ? product.name : "(nom indisponible)";
}

async function loadStock() {
  const items = await api("/api/stock");
  const tbody = document.querySelector("#stock-table tbody");
  tbody.innerHTML = "";
  for (const item of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.product_sku)}</td>
      <td>${escapeHtml(productName(item.product_sku))}</td>
      <td>${item.quantity}</td>
    `;
    tbody.appendChild(tr);
  }
  document.getElementById("stock-empty").classList.toggle("hidden", items.length > 0);
}

document.getElementById("check-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const sku = document.getElementById("check-sku").value.trim();
  const resultEl = document.getElementById("check-result");
  try {
    const result = await api(`/api/stock/${encodeURIComponent(sku)}`);
    resultEl.textContent = `${result.product_sku} : ${result.quantity} unité(s) dans votre branche.`;
    resultEl.className = "success";
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.className = "error";
  }
});

async function submitStockChange(endpoint) {
  const sku = document.getElementById("stock-product").value;
  const quantity = parseInt(document.getElementById("stock-quantity").value, 10);
  const messageEl = document.getElementById("stock-message");
  try {
    await api(endpoint, {
      method: "POST",
      body: JSON.stringify({ product_sku: sku, quantity }),
    });
    messageEl.textContent = "Stock mis à jour.";
    messageEl.className = "success";
    await loadStock();
  } catch (err) {
    messageEl.textContent = err.message;
    messageEl.className = "error";
  }
}

document.getElementById("stock-add-btn").addEventListener("click", () => {
  submitStockChange("/api/stock/add");
});
document.getElementById("stock-remove-btn").addEventListener("click", () => {
  submitStockChange("/api/stock/remove");
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
  const [users, branches] = await Promise.all([api("/api/users"), api("/api/branches")]);
  const branchName = (id) => branches.find((b) => b.id === id)?.name ?? "—";

  const tbody = document.querySelector("#users-table tbody");
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
