# HBntory — Script de démonstration (Task 7)

> Déroulé suggéré pour la présentation finale : ~12-15 minutes, couvre
> chaque exigence obligatoire du sujet avec les données déjà seedées
> (`backoffice/seed.py`). Si l'environnement tourne déjà, il ne reste
> qu'à envoyer une question de préchauffe à l'agent IA ~10 min avant de
> commencer (voir §4) — inférence locale sur CPU, sans ça la première
> question en direct peut prendre plusieurs minutes.

## 0. Lancement (avant la présentation, ou en direct si le temps le permet)

```bash
docker compose up --build
docker compose exec ollama ollama pull llama3.2   # une seule fois
```

Vérifier que les 4 services répondent :

```bash
curl http://localhost:5001/health   # Product API
curl http://localhost:5000/api/me   # Backoffice (401 attendu, pas connecté)
curl http://localhost:5002/health   # AI Query Service
curl -I http://localhost:5173/      # Client web
```

## 1. Architecture (1 min, à l'oral, pas de terminal)

Montrer le schéma de [README.md](../README.md) : `client_web → ai_service →
product_mcp → product_api`, et `backoffice → hbntory.db ← product_mcp
(lecture seule)`. Point clé à dire : **aucune donnée produit n'est stockée
dans notre base**, seulement le `sku` — tout le reste vient de l'API
Produit en direct.

## 2. Backoffice — admin (3 min)

Sur `http://localhost:5000/`, login `admin` / `ChangeMe123!`.

1. Lister les utilisateurs (`admin` seul au départ) et les branches (Lyon,
   Paris).
2. Créer un utilisateur commun `alice`, assigné à Lyon.
3. Montrer qu'un appel direct à l'API avec la session admin sur une route
   de stock est refusé (403) :
   ```bash
   curl -b cookies_admin.txt http://localhost:5000/api/stock
   # {"error":"common user role required"}
   ```
   → prouve que l'autorisation est appliquée côté backend, pas seulement
   cachée dans l'UI.
4. (Optionnel) changer la branche ou le mot de passe d'`alice` depuis
   l'écran admin.

## 3. Backoffice — utilisateur commun (3 min)

Se déconnecter, login `alice`.

1. Lister le stock de sa branche (Lyon) : `HB-LAP-1001` (10), `HB-MON-2101`
   (5), `HB-KBD-4102` (25), `HB-SSD-7101` (15).
2. Ajouter du stock valide (ex. +5 `HB-LAP-1001`).
3. Démonstration des refus attendus par le sujet :
   - retirer plus que le stock disponible → `400 Insufficient stock`.
   - quantité négative ou nulle → `400 Quantity must be strictly
     positive`.
   - `sku` inexistant dans le catalogue → `400 ... does not exist in the
     Product API`.
4. Montrer qu'`alice` ne peut pas atteindre `/api/users` (401/403) — pas
   d'accès admin.

## 4. Interface cliente IA (3-5 min)

Sur `http://localhost:5173/`, montrer d'abord le **catalogue** (panneau de
gauche) : chargé instantanément via `GET /api/catalog` (pas de LLM), filtre
par branche (Lyon/Paris), et cliquer une carte produit préremplit la
question de l'assistant avec son SKU — bon moyen de meubler l'attente avant
de lancer la question en direct ci-dessous.

⚠️ **Latence réelle observée : 1 à 3 minutes par question**, même modèle
déjà chargé — inférence CPU locale (voir
[docs/architecture_and_planning.md](architecture_and_planning.md) §2.4).
**Ne pas poser les 5 questions en direct**, ça dépasserait largement le
budget de la présentation. Stratégie recommandée :

- **~10 min avant** de commencer, envoyer une question de préchauffe
  (`curl` ou la page) pour charger le modèle en mémoire — sinon la
  première question en direct cumule chargement + génération (jusqu'à
  4-5 min).
- **En direct, poser une seule question** (ex. la n°1 ci-dessous) sur
  `http://localhost:5173/`, et **pendant l'attente**, montrer dans un
  autre terminal les logs `hbntory.agent` (`docker compose logs -f
  ai-service`) : chaque appel d'outil MCP y est visible (`tool call: ...`
  / `tool result: ...`) — c'est la preuve que la réponse vient des outils,
  pas d'une hallucination, et ça meuble l'attente utilement.
- **Les autres questions** : les avoir déjà exécutées avant la
  présentation et montrer une capture d'écran / le texte de la réponse,
  plutôt que de les relancer en direct.

Questions (déjà listées sur la page et dans
[client_web/README.md](../client_web/README.md#example-questions)) :

1. « Quels sont les détails du produit HB-LAP-1001 ? » — détail produit,
   vient de l'API Produit. *(celle à poser en direct)*
2. « Quelles branches ont du stock du produit HB-KBD-4102 ? » — Lyon
   uniquement.
3. « Quels produits sont disponibles dans la branche Lyon ? » — les 4 SKU
   ci-dessus.
4. « As-tu du stock pour un produit qui n'existe pas, XYZ-0000 ? » — la
   réponse doit dire clairement que l'information est indisponible, **sans
   rien inventer**.
5. (Si le temps le permet) une question hors-scope, ex. « Quelle est la
   météo à Paris ? » — l'agent doit décliner explicitement au lieu
   d'improviser.

## 5. Points à mentionner à l'oral (2 min)

- **Sécurité mots de passe** : Argon2id (`backoffice/security.py`),
  justifié dans
  [docs/authentication_and_authorization.md](authentication_and_authorization.md).
- **Autorisation** : décorateurs backend (`auth.py`), jamais uniquement
  côté frontend ; isolation par branche via `current.branch_id` côté
  serveur, jamais depuis le corps de la requête.
- **Frontière produit/stock** : `Stock` ne stocke que `product_sku` ;
  tout le reste vient de `product_api` à la demande.
- **MCP** : un seul serveur MCP (`product_mcp/`) étendu pour le stock
  plutôt qu'un second serveur ou une API interne — un seul point de
  contrôle en lecture seule pour tout ce que l'agent peut voir.
- **REST partout** (Backoffice et client) plutôt que WebSocket : chaque
  question/action est indépendante, pas d'historique requis — voir
  [docs/architecture_and_planning.md](architecture_and_planning.md) §2
  pour la justification complète.
- **Limitations connues** et **fonctionnalités optionnelles non
  implémentées** : voir les sections dédiées dans
  [README.md](../README.md).

## Filet de sécurité si quelque chose échoue en direct

- `ai_service` répond 503 si Ollama n'a pas encore reçu le modèle —
  vérifier avec `docker compose exec ollama ollama list`, relancer
  `docker compose exec ollama ollama pull llama3.2` si absent.
- Si `docker compose` n'est pas disponible sur la machine de démo, utiliser
  l'Option B (sans Docker) de [README.md](../README.md#installation-et-lancement)
  — chaque service se lance indépendamment avec les mêmes identifiants.
- La suite pytest (`cd backoffice && python -m pytest tests/ -v`) peut être
  lancée en direct comme filet de sécurité si une démonstration manuelle
  échoue : elle couvre les mêmes scénarios (auth, rôles, stock).
