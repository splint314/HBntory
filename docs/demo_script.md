# HBntory — Script de démonstration (Task 7)

> Déroulé suggéré pour la présentation finale : ~10-12 minutes, couvre
> chaque exigence obligatoire du sujet avec les données déjà seedées
> (`backoffice/seed.py`). Rien à préparer en plus si l'environnement tourne
> déjà (voir [LANCEMENT.md](../LANCEMENT.md)).

## 0. Lancement (avant la présentation, ou en direct si le temps le permet)

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
docker compose up --build
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

## 4. Interface cliente IA (3 min)

Sur `http://localhost:5173/`, poser dans l'ordre (questions déjà listées
sur la page et dans
[client_web/README.md](../client_web/README.md#example-questions)) :

1. « Quels sont les détails du produit HB-LAP-1001 ? » — détail produit,
   vient de l'API Produit.
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

Pendant ce temps, montrer dans le terminal les logs `hbntory.agent` du
conteneur `ai-service` (`docker compose logs -f ai-service`) : chaque appel
d'outil MCP est visible (`tool call: ...` / `tool result: ...`) — preuve
que la réponse vient bien des outils et non d'une hallucination.

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

- `ai_service` répond 503 sans `ANTHROPIC_API_KEY` — vérifier le `.env`
  avant de démarrer, ou relancer `docker compose up ai-service`.
- Si `docker compose` n'est pas disponible sur la machine de démo, utiliser
  l'Option 2 (sans Docker) de [LANCEMENT.md](../LANCEMENT.md) — chaque
  service se lance indépendamment avec les mêmes identifiants.
- La suite pytest (`cd backoffice && python -m pytest tests/ -v`) peut être
  lancée en direct comme filet de sécurité si une démonstration manuelle
  échoue : elle couvre les mêmes scénarios (auth, rôles, stock).
