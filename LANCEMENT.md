# Guide rapide — Lancer HBntory

## Option 1 — Docker Compose (le plus simple)

```bash
docker compose up --build
```

- API Produit externe : http://localhost:5001
- Backoffice : http://localhost:5000
- Identifiants : `admin` / `ChangeMe123!`

## Option 2 — Sans Docker

### 1. API Produit (stdlib only, aucune dépendance)

```bash
cd product_api
HBN_PRODUCTS_PORT=5001 python3 app.py
```

Vérifier : `curl http://127.0.0.1:5001/health`

### 2. Backoffice

```bash
cd backoffice
python3 -m venv ../.venv
../.venv/bin/pip install -r requirements.txt

# Initialiser la base (admin, branches, stock d'exemple)
ADMIN_PASSWORD="ChangeMe123!" ../.venv/bin/python seed.py

# Lancer le serveur
SECRET_KEY="change-me-in-production" PRODUCT_API_URL="http://127.0.0.1:5001" ../.venv/bin/python app.py
```

- Interface web : http://127.0.0.1:5000/
- Identifiants : `admin` / le mot de passe passé à `seed.py`

## Serveur MCP Produit + Stock (`product_mcp/`)

Ne se lance pas seul (pas de port HTTP) : c'est un serveur MCP en stdio, démarré par un
client MCP (agent IA, ou le script de test). Pour le tester manuellement sans agent :

```bash
cd product_mcp
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Nécessite l'API Produit sur :5001 et la DB Backoffice seedée (voir ci-dessus)
PRODUCT_API_URL=http://127.0.0.1:5001 \
DATABASE_URL="sqlite:///../backoffice/hbntory.db" \
.venv/bin/python manual_test.py
```

## Service IA + Interface cliente (`ai_service/`, `client_web/`)

```bash
cd ai_service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # renseigner ANTHROPIC_API_KEY

PRODUCT_API_URL=http://127.0.0.1:5001 \
DATABASE_URL="sqlite:///../backoffice/hbntory.db" \
.venv/bin/python app.py   # http://localhost:5002

# dans un autre terminal
cd ../client_web
python3 -m http.server 5173   # http://localhost:5173
```

Sans `ANTHROPIC_API_KEY`, `ai_service` répond `503 agent_unavailable` de façon propre (pas de
crash) — utile pour vérifier la connectivité MCP et le contrat REST avant d'avoir une clé.

## Variables d'environnement utiles

| Variable | Service | Rôle | Défaut |
|---|---|---|---|
| `ADMIN_PASSWORD` | Backoffice | Mot de passe admin (obligatoire pour `seed.py`) | *(aucun)* |
| `SECRET_KEY` | Backoffice | Clé de signature des sessions | aléatoire (dev) |
| `PRODUCT_API_URL` | Backoffice, product_mcp, ai_service | URL de l'API Produit | `http://localhost:5001` |
| `DATABASE_URL` | Backoffice, product_mcp, ai_service | URL de la DB SQLite (stock) | `sqlite:///hbntory.db` |
| `HBN_PRODUCTS_PORT` | product_api | Port d'écoute | `5000` |
| `ANTHROPIC_API_KEY` | ai_service | Clé API pour l'agent LLM | *(aucun, obligatoire)* |

## Problèmes courants

- **"invalid credentials" dans l'UI alors que l'API répond OK en curl** : autofill du
  navigateur avec un mauvais mot de passe — vider le champ et le retaper.
- **Docker introuvable sous WSL** : activer l'intégration WSL dans Docker Desktop, ou
  utiliser l'Option 2 (sans Docker).
- **`.venv` corrompu (permission denied sur `pip`/`python`)** : le recréer (`rm -rf .venv &&
  python3 -m venv .venv && ...`), il n'est pas versionné.

Détails complets : [README.md](README.md), [CLAUDE.md](CLAUDE.md),
[product_mcp/README.md](product_mcp/README.md), [ai_service/README.md](ai_service/README.md),
[client_web/README.md](client_web/README.md).
