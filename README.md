# HBntory

Système de gestion de stock multi-branches pour une entreprise de vente au
détail fictive (projet Holberton), avec un agent IA capable de répondre à
des questions sur le catalogue produit et la disponibilité en stock.

## Équipe

- Kevin Rigal — krigal323@gmail.com
- Panaki Gillot — gillotpanaki@gmail.com

## Vue d'ensemble du projet

Le système est composé de six services indépendants (voir
[docs/architecture_and_planning.md](docs/architecture_and_planning.md) pour
le détail complet — architecture, flux de données, stratégies de
communication, MVP) :

| Service | Rôle | État |
|---|---|---|
| `backoffice/` | API REST + interface web interne : gestion des utilisateurs (admin) et du stock (utilisateurs communs) | Task 0-3, fait |
| `product_api/` | Catalogue fournisseur externe, vendored, lecture seule, non modifié | fourni |
| `product_mcp/` | Serveur MCP : outils produit (catalogue) + stock (lecture seule de la DB Backoffice) pour l'agent IA | Task 4-5, fait |
| `ai_service/` | Service IA : reçoit une question, l'agent (Claude, tool-use) appelle le serveur MCP, renvoie une réponse | Task 5, fait |
| `client_web/` | Page publique statique, sans authentification, qui pose des questions au Service IA | Task 6, fait |
| Base de données relationnelle | SQLite (fichier partagé, lu en écriture par le Backoffice et en lecture seule par `product_mcp`) | fait |

Task 7 (vérification finale, tests critiques, conteneurisation complète,
documentation et présentation) est transverse aux six services ci-dessus —
voir les sections [Tests](#tests-task-7) et
[Présentation et démonstration](#présentation-et-démonstration) plus bas.

## Architecture (résumé)

```
client_web  --REST-->  ai_service  --MCP (stdio)-->  product_mcp  --HTTP-->  product_api
                                                            \--SQLite (mode=ro)--> hbntory.db
backoffice  <--SQLAlchemy-->  hbntory.db
backoffice  --HTTP-->  product_api
```

- Le **Backoffice** est la seule voie d'écriture sur la base de données
  (utilisateurs, branches, stock). Il n'y stocke jamais de données produit
  (nom, prix, description) — uniquement le `sku`, tout le reste vient de
  l'API Produit à la demande.
- Le **serveur MCP** est le seul point d'accès de l'agent IA aux données
  produit et stock ; il n'écrit jamais dans la base (connexion SQLite en
  `mode=ro`) et n'a aucune notion d'authentification (il ne fait que lire).
- Le **Service IA** ne connaît ni la base de données ni l'API Produit
  directement : tout passe par le serveur MCP, en client MCP standard.
- L'**interface cliente** est anonyme et ne parle qu'au Service IA, jamais
  directement au Backoffice ni à la base.

Détails par service : [docs/database_design.md](docs/database_design.md),
[docs/authentication_and_authorization.md](docs/authentication_and_authorization.md),
[docs/backoffice_ui.md](docs/backoffice_ui.md),
[product_mcp/README.md](product_mcp/README.md),
[ai_service/README.md](ai_service/README.md),
[client_web/README.md](client_web/README.md).

## Installation et lancement

Guide condensé : [LANCEMENT.md](LANCEMENT.md). Détail complet ci-dessous.

### Option A — Docker Compose (les cinq services)

```bash
# Optionnel : clé pour que l'agent réponde réellement (sinon /api/ask
# renvoie un 503 "agent_unavailable" propre, tout le reste fonctionne).
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

docker compose up --build
```

Démarre, dans l'ordre des dépendances : l'API Produit externe
(`http://localhost:5001`), le Backoffice (`http://localhost:5000`, admin
déjà seedé `admin` / `ChangeMe123!`, à changer via `ADMIN_PASSWORD` dans
`docker-compose.yml`), le Service IA (`http://localhost:5002`) et
l'interface cliente (`http://localhost:5173`). Les données du Backoffice
sont persistées dans le volume nommé `backoffice_data`, monté en lecture
seule dans le conteneur `ai-service` pour les outils de stock du serveur
MCP (celui-ci n'a pas de conteneur propre : il n'a pas de port HTTP, il est
lancé comme sous-processus par `ai_service`, voir
[product_mcp/README.md](product_mcp/README.md)). Sans
`ANTHROPIC_API_KEY`, tout démarre quand même ; seul `/api/ask` répond 503
au lieu de donner une vraie réponse.

### Option B — Chaque service manuellement

#### 1. API Produit externe

```bash
cd product_api
HBN_PRODUCTS_PORT=5001 python3 app.py
```

Aucune dépendance tierce (stdlib uniquement). Vérifier :
`curl http://127.0.0.1:5001/health`. Contrat complet :
[product_api/README.md](product_api/README.md),
[product_api/docs/api_contract.md](product_api/docs/api_contract.md).

#### 2. Backoffice — initialiser la base de données et lancer l'API

```bash
cd backoffice
python3 -m venv ../.venv
../.venv/bin/pip install -r requirements.txt

# Initialise la base : admin, 2 branches (Lyon, Paris), stock d'exemple
ADMIN_PASSWORD="unMotDePasseSolide" ../.venv/bin/python seed.py

SECRET_KEY="change-me-in-production" PRODUCT_API_URL="http://127.0.0.1:5001" ../.venv/bin/python app.py
```

`seed.py` doit tourner avant le premier lancement (il crée la base
`hbntory.db` si elle n'existe pas). Le réexécuter est sans danger tant que
la base n'existe pas déjà — sur une base existante il échouera plutôt que
de dupliquer les données (username unique).

#### Accéder au Backoffice

Interface web : `http://127.0.0.1:5000/` (**toujours via Flask, jamais un
serveur statique séparé type Live Server** — `app.js` utilise des chemins
relatifs et le cookie de session, voir [docs/backoffice_ui.md](docs/backoffice_ui.md)
§1) — identifiants `admin` / le mot de passe passé à `ADMIN_PASSWORD` lors
du `seed.py`. Un admin gère les utilisateurs (créer/modifier/soft-delete un
utilisateur commun, changer sa branche ou son mot de passe) ; un
utilisateur commun gère le stock de sa seule branche assignée
(ajouter/retirer/consulter). Détail des rôles et routes :
[docs/authentication_and_authorization.md](docs/authentication_and_authorization.md),
table des routes ci-dessous.

#### Variables d'environnement (Backoffice)

| Variable | Rôle | Défaut |
|---|---|---|
| `DATABASE_URL` | URL de connexion SQLAlchemy | `sqlite:///hbntory.db` |
| `ADMIN_PASSWORD` | Mot de passe en clair de l'admin, utilisé une seule fois par `seed.py` | *(obligatoire, aucun défaut)* |
| `SECRET_KEY` | Clé de signature des cookies de session Flask | valeur aléatoire (dev uniquement) |
| `PRODUCT_API_URL` | URL de l'API Produit externe | `http://localhost:5001` |

#### Principales routes de l'API Backoffice

| Méthode | Route | Rôle requis | Description |
|---|---|---|---|
| POST | `/api/login` | aucun | Authentification, crée la session |
| POST | `/api/logout` | authentifié | Termine la session |
| GET | `/api/me` | authentifié | Utilisateur courant |
| GET | `/api/branches` | admin | Liste des branches |
| GET | `/api/users` | admin | Liste des utilisateurs |
| POST | `/api/users` | admin | Créer un utilisateur commun |
| PATCH | `/api/users/<id>` | admin | Modifier un utilisateur |
| DELETE | `/api/users/<id>` | admin | Soft-delete un utilisateur |
| PATCH | `/api/users/<id>/password` | admin | Changer le mot de passe |
| PATCH | `/api/users/<id>/branch` | admin | Changer la branche assignée |
| GET | `/api/stock` | common | Stock de la branche de l'utilisateur |
| GET | `/api/stock/<sku>` | common | Stock d'un produit dans sa branche |
| POST | `/api/stock/add` | common | Ajouter du stock à sa branche |
| POST | `/api/stock/remove` | common | Retirer du stock de sa branche |
| GET | `/api/products?q=&limit=` | authentifié | Proxy lecture seule vers l'API Produit (liste/recherche) |
| GET | `/api/products/<sku>` | authentifié | Proxy lecture seule vers l'API Produit (détail) |

#### 3. Serveur MCP Produit + Stock

N'a pas de port HTTP : c'est un serveur MCP en stdio, lancé comme
sous-processus (par `ai_service` ou par son propre script de test).

```bash
cd product_mcp
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
PRODUCT_API_URL=http://127.0.0.1:5001 DATABASE_URL="sqlite:///../backoffice/hbntory.db" .venv/bin/python manual_test.py
```

Liste des outils et tests manuels : [product_mcp/README.md](product_mcp/README.md).

#### 4. Service IA

```bash
cd ai_service
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # renseigner ANTHROPIC_API_KEY
.venv/bin/python app.py   # http://localhost:5002
```

Contrat REST (`POST /api/ask`), types de questions supportés, gestion
d'erreurs, observabilité des appels d'outils :
[ai_service/README.md](ai_service/README.md).

#### 5. Interface cliente (utiliser le Client Web Interface)

```bash
cd client_web
python3 -m http.server 5173   # http://localhost:5173
```

Ouvrir `http://localhost:5173/`, taper une question dans le champ de texte
et cliquer sur "Envoyer" (ou utiliser les exemples affichés sur la page).
Aucune authentification requise. Questions d'exemple documentées :
[client_web/README.md](client_web/README.md).

## Tests (Task 7)

- `backoffice/tests/` — suite automatisée `pytest` (auth, autorisation par
  rôle, règles de stock — voir la liste des scénarios ci-dessous) :

  ```bash
  cd backoffice
  ../.venv/bin/pip install -r requirements-dev.txt
  ../.venv/bin/python -m pytest tests/ -v
  ```

- `backoffice/manual_test.py`, `product_mcp/manual_test.py`,
  `ai_service/manual_test.py` — scripts de vérification manuelle par
  service (voir leurs README respectifs).

### Scénarios critiques couverts (Task 7.2)

| Scénario | Où |
|---|---|
| Utilisateur commun ajoute du stock valide | `tests/test_api_stock.py` |
| Utilisateur commun retire du stock valide | `tests/test_api_stock.py` |
| Ne peut pas retirer plus que le stock disponible | `tests/test_api_stock.py`, `tests/test_stock_rules.py` |
| Ne peut pas opérer sur une autre branche | `tests/test_api_stock.py` |
| Admin peut créer un utilisateur commun | `tests/test_api_auth.py` |
| Admin peut soft-delete un utilisateur | `tests/test_api_auth.py` |
| Utilisateur supprimé ne peut plus se connecter | `tests/test_api_auth.py` |
| Admin ne peut pas gérer le stock | `tests/test_api_stock.py` |
| Détails produit obtenus depuis l'API externe | `product_mcp/README.md` (test manuel) |
| L'IA répond où un produit est disponible | `ai_service/README.md` (test manuel, nécessite une clé API) |
| L'IA répond quels produits sont disponibles dans une branche | idem |
| L'IA répond clairement pour un produit inconnu | idem |
| L'IA répond clairement quand l'information est indisponible | idem |

## Principales décisions techniques

- **REST** pour le Backoffice et l'interface cliente (pas de SSR, pas de
  WebSocket) : chaque question/action est indépendante, pas d'historique de
  conversation requis — REST est suffisant et plus simple à déboguer.
- **MCP standard** entre le Service IA et les données produit/stock plutôt
  qu'un accès direct : découple totalement l'agent de ses sources de
  données (l'un peut évoluer sans l'autre).
- **Extension du serveur MCP existant pour le stock** plutôt qu'un second
  serveur MCP ou une API interne dédiée : un seul point d'accès en lecture
  seule (`mode=ro` SQLite) pour tout ce que l'agent peut voir.
- **SQLite partagé** entre le Backoffice (lecture/écriture via SQLAlchemy)
  et `product_mcp` (lecture seule via `sqlite3`, `mode=ro`) : évite de
  dupliquer les données de stock, au prix d'un couplage sur le format du
  fichier plutôt qu'une vraie API interne.
- **Système de prompt restrictif** dans l'agent (4 types de questions
  supportés, tout le reste explicitement refusé) plutôt qu'un agent
  généraliste : réponses prévisibles, jamais de données inventées.
- **Frontend sans framework** (Backoffice et client) : HTML/CSS/JS simple,
  cohérent avec la simplicité demandée par le sujet, pas de build step.

## Limitations connues

- Le lien Backoffice ↔ `product_mcp` se fait via le fichier SQLite partagé
  (chemin relatif) plutôt qu'un vrai contrat d'API interne — fonctionne en
  local, fragile si les deux services tournent sur des machines séparées.
- L'agent IA n'a été testé de bout en bout qu'avec les outils MCP (sans
  appel LLM réel) dans cet environnement de développement, faute de clé
  `ANTHROPIC_API_KEY` disponible — voir
  [ai_service/README.md](ai_service/README.md) pour le détail de ce qui a
  été vérifié.
- Pas de test automatisé du rendu visuel de `client_web` dans un vrai
  navigateur (logique JS vérifiée contre l'API réelle via `curl`).
- Une seule langue de réponse suivie (celle de la question), pas de
  détection de langue robuste au-delà de l'instruction donnée au modèle.

## Présentation et démonstration

Déroulé suggéré pour la soutenance, avec les données seedées :
[docs/demo_script.md](docs/demo_script.md).

## Fonctionnalités optionnelles implémentées

Aucune des fonctionnalités listées comme optionnelles dans le sujet
(streaming WebSocket, historique de conversation, agent multi-étapes,
tests de bout en bout complets) n'a été implémentée — voir
[docs/architecture_and_planning.md](docs/architecture_and_planning.md)
§3.3 pour la liste et la justification du choix de rester sur le MVP.
