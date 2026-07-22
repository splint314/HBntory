# HBntory

Système de gestion de stock multi-branches pour une entreprise de vente au
détail fictive (projet Holberton).

Voir [docs/architecture_and_planning.md](docs/architecture_and_planning.md)
pour l'architecture complète du système (services, flux de données,
stratégies de communication, MVP).

## État du projet

| Composant | État |
|---|---|
| `backoffice/` | Task 0-3 : modèles, base de données, API REST, authentification/autorisation, interface web (stock + gestion utilisateurs) |
| `product_api/` | API Produit externe fournie (vendored depuis [hbntory-products-api](https://github.com/hbtn-edu/hbntory-products-api)), lecture seule, non modifiée |
| Serveur MCP Produit, Service IA, Interface client (public) | Pas encore commencés |

## Tout lancer avec Docker Compose

```bash
docker compose up --build
```

Démarre l'API Produit externe (`http://localhost:5001`) puis le Backoffice
(`http://localhost:5000`), avec un admin déjà seedé
(`admin` / `ChangeMe123!`, à changer via la variable `ADMIN_PASSWORD` du
`docker-compose.yml`). Les données du Backoffice sont persistées dans le
volume nommé `backoffice_data`.

## Backoffice — démarrage rapide (sans Docker)

```bash
cd backoffice

# 1. Environnement virtuel + dépendances
python3 -m venv ../.venv
../.venv/bin/pip install -r requirements.txt

# 2. Initialiser la base de données (admin, 2 branches, stock d'exemple)
ADMIN_PASSWORD="unMotDePasseSolide" ../.venv/bin/python seed.py

# 3. Lancer l'API
SECRET_KEY="change-me-in-production" ../.venv/bin/python app.py
```

L'interface web est servie sur `http://127.0.0.1:5000/` (identifiants de
démo : `admin` / le mot de passe passé à `seed.py`). Elle consomme l'API
REST du même service — voir
[docs/database_design.md](docs/database_design.md),
[docs/authentication_and_authorization.md](docs/authentication_and_authorization.md)
et [docs/backoffice_ui.md](docs/backoffice_ui.md) pour le détail du schéma,
de la stratégie d'authentification et de l'approche UI/backend.

### API Produit externe — sans Docker

`product_api/app.py` ne dépend d'aucune librairie tierce (uniquement la
stdlib Python), donc si Docker n'est pas disponible elle peut tourner
directement :

```bash
cd product_api
HBN_PRODUCTS_PORT=5001 python3 app.py
```

Puis lancer le Backoffice avec `PRODUCT_API_URL=http://127.0.0.1:5001` (au
lieu du nom de service Docker `external-products-api`). Voir
[product_api/README.md](product_api/README.md) et
[product_api/docs/api_contract.md](product_api/docs/api_contract.md) pour le
contrat complet (endpoints, `simulate_delay_ms`, `force_error`).

### Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `DATABASE_URL` | URL de connexion SQLAlchemy | `sqlite:///hbntory.db` |
| `ADMIN_PASSWORD` | Mot de passe en clair de l'admin, utilisé une seule fois par `seed.py` pour générer le hash Argon2id | *(obligatoire, aucun défaut)* |
| `SECRET_KEY` | Clé de signature des cookies de session Flask | valeur aléatoire (dev uniquement) |
| `PRODUCT_API_URL` | URL de l'API Produit externe (conteneur Docker) | `http://localhost:5001` |

### Principales routes de l'API

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
