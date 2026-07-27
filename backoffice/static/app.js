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

document.querySelectorAll(".toggle-password").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.classList.toggle("is-visible", !showing);
    btn.setAttribute("aria-pressed", String(!showing));
    btn.setAttribute("aria-label", showing ? "Afficher le mot de passe" : "Masquer le mot de passe");
  });
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
      <td>${item.product_sku}</td>
      <td>${productName(item.product_sku)}</td>
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
      <td>${user.username}</td>
      <td>${user.role}</td>
      <td>${user.branch_id !== null ? branchName(user.branch_id) : "—"}</td>
      <td>${user.is_active ? "actif" : "supprimé"}</td>
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

async function changePassword(userId) {
  const password = prompt("Nouveau mot de passe (8 caractères minimum) :");
  if (!password) return;
  try {
    await api(`/api/users/${userId}/password`, {
      method: "PATCH",
      body: JSON.stringify({ password }),
    });
    reportAdmin("Mot de passe changé.", true);
  } catch (err) {
    reportAdmin(err.message, false);
  }
}

async function changeBranch(userId, branches) {
  const names = branches.map((b) => `${b.id}=${b.name}`).join(", ");
  const input = prompt(`Nouvel identifiant de branche (${names}) :`);
  const branchId = parseInt(input, 10);
  if (!input || Number.isNaN(branchId)) return;
  try {
    await api(`/api/users/${userId}/branch`, {
      method: "PATCH",
      body: JSON.stringify({ branch_id: branchId }),
    });
    reportAdmin("Branche changée.", true);
    await loadUsers();
  } catch (err) {
    reportAdmin(err.message, false);
  }
}

async function softDeleteUser(userId, username) {
  if (!confirm(`Supprimer (soft-delete) l'utilisateur "${username}" ?`)) return;
  try {
    await api(`/api/users/${userId}`, { method: "DELETE" });
    reportAdmin("Utilisateur supprimé.", true);
    await loadUsers();
  } catch (err) {
    reportAdmin(err.message, false);
  }
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
