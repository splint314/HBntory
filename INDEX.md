# Index du dépôt HBntory

> À quoi sert chaque fichier. Vue d'ensemble rapide — pour le détail
> technique de chaque service, voir [CLAUDE.md](CLAUDE.md) et les fichiers
> dans [docs/](docs/).

## Racine

| Fichier | Rôle |
|---|---|
| `README.md` | Point d'entrée du dépôt : état du projet, lancement (Docker et sans Docker), variables d'environnement, routes de l'API. |
| `CLAUDE.md` | Guide destiné à un assistant IA (Claude Code) travaillant sur ce dépôt : architecture, conventions, rôle de chaque module. |
| `LANCEMENT.md` | Aide-mémoire personnel pour lancer tous les services (gitignored, pas dans le dépôt partagé). |
| `launch_all.sh` | Lance les 5 services sans Docker (ordre + health-checks), pour quand Docker n'est pas disponible. Voir README.md "Option A bis". |
| `INDEX.md` | Ce fichier. |
| `docker-compose.yml` | Lance l'API Produit externe et le Backoffice ensemble (services `external-products-api` + `backoffice`, volume `backoffice_data` pour la persistance SQLite). |
| `.gitignore` | Exclut `.venv/`, `__pycache__/`, `*.pyc`, `*.db`, `.env`, `LANCEMENT.md`, `run-logs/`. |

## `docs/` — documentation du projet

| Fichier | Rôle |
|---|---|
| `architecture_and_planning.md` | Task 0 : architecture des 6 services, flux de données, stratégies de communication (REST vs WebSocket, HTML/CSS/JS vs SSR), définition du MVP. |
| `database_design.md` | Task 1 : schéma relationnel (`Branch`, `User`, `Stock`), diagramme ER, règles de validation du stock et où elles sont appliquées. |
| `authentication_and_authorization.md` | Task 2 : authentification par session (cookie signé), hachage Argon2id des mots de passe, application des rôles admin/commun côté backend. |
| `backoffice_ui.md` | Task 3 : approche REST + HTML/CSS/JS léger pour l'interface, intégration de l'API Produit dans le Backoffice, vérifications effectuées. |

## `backoffice/` — API REST + interface web (Flask)

| Fichier | Rôle |
|---|---|
| `app.py` | Point d'entrée Flask : toutes les routes (`/api/login`, `/api/users*`, `/api/stock*`, `/api/products*`) et le service de la page `/`. |
| `models.py` | Modèles SQLAlchemy : `Branch`, `User` (rôle admin/commun), `Stock` (branche + sku externe + quantité). |
| `database.py` | Configuration du moteur SQLAlchemy (`SessionLocal`, `Base`), activation des clés étrangères SQLite. |
| `auth.py` | Authentification par session : `get_current_user()`, décorateurs `login_required`/`admin_required`/`common_required`. |
| `security.py` | Hachage et vérification des mots de passe (Argon2id), politique de longueur minimale. |
| `user_service.py` | Logique métier de gestion des utilisateurs (créer, soft-delete, changer mot de passe/branche) — utilisée par les routes admin. |
| `stock_service.py` | Seul point d'entrée pour modifier le stock (`add_stock`/`remove_stock`), applique toutes les validations avant d'écrire en base. |
| `validation.py` | Règles de validation du stock (quantité entière positive, existence du produit dans l'API externe). |
| `product_client.py` | Client HTTP vers l'API Produit externe (liste, détail) ; ne lève jamais d'exception, dégrade proprement si l'API est indisponible. |
| `seed.py` | Initialise la base : admin (mot de passe via `ADMIN_PASSWORD`), 2 branches, stock d'exemple. Idempotent. |
| `manual_test.py` | Script manuel de vérification des règles de validation du stock (pas un vrai test automatisé). |
| `requirements.txt` | Dépendances Python (`Flask`, `SQLAlchemy`, `argon2-cffi`). |
| `Dockerfile` | Image Docker du Backoffice (seed puis lancement de `app.py`). |
| `hbntory.db` | Base SQLite locale (gitignored), créée par `seed.py`. |
| `static/index.html` | Page unique de l'interface : vue connexion, vue utilisateur commun (stock), vue admin (utilisateurs). |
| `static/app.js` | Logique frontend (vanilla JS, `fetch()` vers l'API REST ci-dessus, pas de framework). |
| `static/style.css` | Style de l'interface (clair/sombre via `prefers-color-scheme`). |

## `product_api/` — API Produit externe (fournie, vendored)

> Lecture seule, ne doit pas être modifiée (asset fourni par l'école, depuis
> [hbtn-edu/hbntory-products-api](https://github.com/hbtn-edu/hbntory-products-api)).

| Fichier | Rôle |
|---|---|
| `app.py` | Serveur HTTP stdlib-only (aucune dépendance) exposant le catalogue produits (`/api/v1/products`, `/health`, etc.), avec `simulate_delay_ms`/`force_error` pour tester la robustesse. |
| `data/products.json` | Catalogue de 40 produits (skus, prix, descriptions, fournisseurs...). |
| `Dockerfile`, `docker-compose.yml` | Conteneurisation du service seul (le `docker-compose.yml` racine l'intègre déjà avec le Backoffice). |
| `docs/api_contract.md`, `docs/openapi.yaml` | Contrat complet de l'API (endpoints, paramètres, format des erreurs). |
| `examples/curl_examples.sh`, `examples/requests.http` | Exemples de requêtes prêts à l'emploi. |
| `scripts/smoke_test.py` | Test de fumée de l'API (`python3 scripts/smoke_test.py http://localhost:5001`). |

## `product_mcp/` — Serveur MCP Produit + Stock

| Fichier | Rôle |
|---|---|
| `server.py` | Serveur MCP (FastMCP, transport stdio) exposant 5 outils à l'agent IA : `list_products_tool`, `get_product_details`, `list_branches_tool`, `get_stock_by_branch_tool`, `get_branches_with_product_tool`. |
| `product_client.py` | Client HTTP vers l'API Produit externe — lève des exceptions typées (`ProductNotFoundError`, `ProductAPIError`) plutôt que de dégrader silencieusement, pour que l'agent distingue "n'existe pas" de "service indisponible". |
| `stock_client.py` | Accès **lecture seule** à la base SQLite du Backoffice (`mode=ro`, jamais via SQLAlchemy) pour les questions de stock. |
| `manual_test.py` | Exerce les 5 outils MCP directement via le SDK (`call_tool`), sans agent IA. |
| `requirements.txt` | Dépendances (SDK `mcp`, `pydantic`). |

## `ai_service/` — Service IA (agent Claude)

| Fichier | Rôle |
|---|---|
| `app.py` | API REST Flask, un seul endpoint `POST /api/ask` (`{"question"} → {"answer"}`), CORS ouvert pour `client_web/`. |
| `agent.py` | Boucle d'agent (tool-use Anthropic, `MAX_TOOL_TURNS=8`) : appelle les outils du serveur MCP jusqu'à obtenir une réponse finale. Prompt système : ne jamais inventer de donnée. |
| `mcp_client.py` | Lance `product_mcp/server.py` en sous-processus et gère la session MCP (stdio). |
| `manual_test.py` | Vérifie la connectivité MCP, et si `ANTHROPIC_API_KEY` est défini, fait tourner l'agent sur des questions d'exemple. |
| `requirements.txt` | Dépendances (`Flask`, SDK `anthropic`, `mcp`). |
| `.env.example` / `.env` | Modèle et valeurs locales pour `ANTHROPIC_API_KEY` (`.env` est gitignored). |

## `client_web/` — interface publique

| Fichier | Rôle |
|---|---|
| `index.html` | Page unique : formulaire de question, zone de réponse, indicateur de chargement. |
| `app.js` | Appelle `POST /api/ask` sur `ai_service` (`?api=` pour surcharger l'URL), gère les 3 états (chargement, erreur, réponse). |
| `style.css` | Style de la page. |
| `README.md` | Questions d'exemple documentées, comportement attendu de l'interface. |
