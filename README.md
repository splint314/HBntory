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
| `ai_service/` | Service IA : reçoit une question, l'agent (LLM local via Ollama, tool-use) appelle le serveur MCP, renvoie une réponse | Task 5, fait |
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

Détail complet ci-dessous ; dépannage rapide dans
[Problèmes courants](#problèmes-courants).

### Option A — Docker Compose (les cinq services)

```bash
docker compose up --build
```

Démarre, dans l'ordre des dépendances (`depends_on` + `healthcheck`, chaque
service attend que le précédent soit réellement prêt, pas juste démarré) :
l'API Produit externe (`http://localhost:5001`), le Backoffice
(`http://localhost:5000`, admin déjà seedé `admin` / `ChangeMe123!`, à
changer via `ADMIN_PASSWORD` dans `docker-compose.yml`), **Ollama**
(`http://localhost:11434`, le LLM local qui sert l'agent — voir §2.4 de
[docs/architecture_and_planning.md](docs/architecture_and_planning.md)
pour la justification de ce choix plutôt qu'une API payante), le Service
IA (`http://localhost:5002`) et l'interface cliente
(`http://localhost:5173`). Les données du Backoffice sont persistées dans
le volume nommé `backoffice_data`, monté en lecture seule dans le
conteneur `ai-service` pour les outils de stock du serveur MCP (celui-ci
n'a pas de conteneur propre : il n'a pas de port HTTP, il est lancé comme
sous-processus par `ai_service`, voir
[product_mcp/README.md](product_mcp/README.md)).

`ai-service` télécharge automatiquement le modèle (`ensure_model.py`, au
démarrage du conteneur) s'il n'est pas déjà présent dans le volume
`ollama_data` — aucune étape manuelle requise, mais le tout premier
démarrage peut prendre plusieurs minutes le temps du téléchargement
(~4.7 Go pour `llama3.1:8b`) ; le healthcheck d'`ai-service` tolère ce délai
(`start_period: 600s`) avant de considérer le conteneur en échec.

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
| `FLASK_DEBUG` | Active le débogueur interactif Werkzeug si mis à `1` (**ne jamais l'activer en production** : exécution de code arbitraire si le débogueur est atteignable) | désactivé |
| `PORT` | Port d'écoute (usage local via `python app.py`, ignoré par `gunicorn` en conteneur) | `5000` |

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

Nécessite [Ollama](https://ollama.com/download) installé sur la machine
(pas requis avec l'Option A Docker, où il tourne dans son propre
conteneur).

```bash
ollama pull llama3.1:8b   # une seule fois — LLM local, gratuit, voir ai_service/README.md

cd ai_service
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/python app.py   # http://localhost:5002
```

Contrat REST (`POST /api/ask`), types de questions supportés, gestion
d'erreurs, observabilité des appels d'outils :
[ai_service/README.md](ai_service/README.md).

#### Variables d'environnement (Service IA)

| Variable | Rôle | Défaut |
|---|---|---|
| `OLLAMA_HOST` | URL du serveur Ollama local | `http://localhost:11434` |
| `AI_MODEL` | Modèle Ollama utilisé par l'agent (`llama3.2` : 3B, plus rapide mais moins fiable pour choisir le bon outil — voir §2.4) | `llama3.1:8b` |
| `AI_SERVICE_PORT` | Port d'écoute du service | `5002` |
| `PRODUCT_API_URL` | URL de l'API Produit (transmise au serveur MCP) | `http://localhost:5001` |
| `DATABASE_URL` | URL de la DB SQLite (transmise au serveur MCP, lecture seule) | `sqlite:///../backoffice/hbntory.db` |

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
| L'IA répond où un produit est disponible | `ai_service/README.md` (vérifié en direct, réponse correcte) |
| L'IA répond quels produits sont disponibles dans une branche | `ai_service/README.md` (vérifié en direct ; a révélé un vrai problème de choix d'outil avec le petit modèle, corrigé partiellement puis résolu en passant à `llama3.1:8b` par défaut — voir "Tool-selection reliability" dans `ai_service/README.md`) |
| L'IA répond clairement pour un produit inconnu | `ai_service/README.md` (vérifié en direct, réponse correcte) |
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
- **LLM local (Ollama) plutôt qu'une API payante** : projet étudiant sans
  budget récurrent — voir
  [docs/architecture_and_planning.md](docs/architecture_and_planning.md)
  §2.4 pour le compromis accepté (un petit modèle local suit les
  instructions de manière moins fiable qu'un modèle frontière payant).
- **Frontend sans framework** (Backoffice et client) : HTML/CSS/JS simple,
  cohérent avec la simplicité demandée par le sujet, pas de build step.

## Problèmes courants

- **`/api/ask` répond 503 "agent_unavailable"** : Ollama n'a pas encore le
  modèle — `ollama pull llama3.1:8b` en lancement manuel (Option B). En
  Docker (Option A), `ai-service` le télécharge automatiquement au premier
  démarrage (`ensure_model.py`) ; si ça persiste après plusieurs minutes,
  vérifier `docker compose logs ai-service`. Voir §2.4 de
  [docs/architecture_and_planning.md](docs/architecture_and_planning.md).
- **"invalid credentials" dans l'UI du Backoffice alors que l'API répond
  OK en `curl`** : autofill du navigateur avec un mauvais mot de passe —
  vider le champ et le retaper.
- **Backoffice ouvert avec l'extension VS Code "Live Server" (ou tout
  autre serveur statique) sur `backoffice/static/index.html` : rien ne
  fonctionne (login, stock...)** : attendu, voir
  [docs/backoffice_ui.md](docs/backoffice_ui.md) §1 — ouvrir directement
  `http://localhost:5000/`, jamais le fichier via Live Server.
  `client_web/` n'a pas cette contrainte (URL absolue, CORS ouvert).
- **Docker introuvable sous WSL** : activer l'intégration WSL dans Docker
  Desktop, ou utiliser l'Option B (sans Docker) ci-dessus.
- **`.venv` corrompu (permission denied sur `pip`/`python`)** : le
  recréer (`rm -rf .venv && python3 -m venv .venv && ...`), il n'est pas
  versionné.

## Limitations connues

- Le lien Backoffice ↔ `product_mcp` se fait via le fichier SQLite partagé
  (chemin relatif) plutôt qu'un vrai contrat d'API interne — fonctionne en
  local, fragile si les deux services tournent sur des machines séparées.
- **Latence de l'agent IA** : de quelques secondes à plusieurs minutes par
  question selon la machine (inférence CPU locale via Ollama, modèle déjà
  chargé) — acceptable pour une démonstration mais pas pour de la
  production. Voir [docs/architecture_and_planning.md](docs/architecture_and_planning.md)
  §2.4 et [ai_service/README.md](ai_service/README.md) pour le détail des
  tests effectués (boucle complète vérifiée de bout en bout, réponses
  correctement fondées sur les données réelles de l'API Produit et du
  stock).
- **Choix d'outil peu fiable avec le petit modèle (`llama3.2`, 3B)** :
  observé en train de répondre à une question sur le stock d'une branche
  en listant tout le catalogue au lieu d'interroger cette branche
  précisément. Un correctif (descriptions d'outils plus explicites dans
  `product_mcp/server.py`) aide mais ne garantit rien à 100 % avec ce
  modèle — d'où le passage à `llama3.1:8b` par défaut, nettement plus
  fiable sur ce point dans nos tests. Détail complet :
  [ai_service/README.md](ai_service/README.md#tool-selection-reliability-why-the-default-model-changed-2026-07-27).
- **Comparaison de quantités pas toujours fiable, même avec `llama3.1:8b`** :
  sur une question de type liste de courses multi-produits, le modèle a
  appelé les bons outils et obtenu les bonnes quantités, mais a mal
  comparé quantité demandée vs quantité disponible et conclu à tort
  qu'une branche pouvait tout fournir. Les données restaient réelles (pas
  d'invention), l'erreur est arithmétique/logique, pas un cas d'hallucination
  de données. **Deux tentatives de renforcement du prompt système ont
  échoué à corriger ça de façon fiable** (la deuxième a même vu le modèle
  appeler un outil avec un placeholder de template au lieu d'une vraie
  valeur) — décision d'arrêter d'itérer sur le prompt et de documenter la
  limite plutôt que de continuer à la chasser. La vraie correction
  probable serait de faire calculer la comparaison de quantités par du
  code Python dans `agent.py` une fois les données d'outils récupérées,
  plutôt que de la confier au LLM — pas implémenté, laissé comme piste.
  Détail complet et logs :
  [ai_service/README.md](ai_service/README.md#follow-up-retest-with-llama31-8b-2026-07-27-later).
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
