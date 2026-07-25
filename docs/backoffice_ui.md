# HBntory — Interface Backoffice (Task 3)

> Documente les fonctionnalités opérationnelles du Backoffice (stock pour
> les utilisateurs communs, gestion des utilisateurs pour l'admin),
> l'intégration de l'API Produit dans l'interface, et l'approche UI/backend
> retenue.

---

## 1. Approche retenue : REST + HTML/CSS/JS léger

Conformément à la décision prise dans
[architecture_and_planning.md](architecture_and_planning.md) (§2.1) :
l'API REST Flask (`backoffice/app.py`, Task 2) reste inchangée, et une page
statique unique (`backoffice/static/index.html` + `app.js` + `style.css`)
la consomme via `fetch()`, sans framework ni étape de build.

- **Bénéfice principal** : le frontend est trivial à auditer (un seul
  fichier JS, ~300 lignes, aucune dépendance externe) et à faire tourner
  (Flask sert `/` et `/static/*` directement, aucune configuration
  supplémentaire).
- **Compromis principal** : pas de gestion d'état réactive (pas de
  Virtual DOM) — chaque action réécrit manuellement le DOM concerné
  (`innerHTML`). Pour la taille de cette interface (deux vues, quelques
  formulaires), c'est largement suffisant et plus simple à déboguer qu'un
  framework.
- Flask sert la page (`GET /`) et l'API (`/api/*`) **depuis la même
  origine** : pas de CORS à configurer, pas de jeton à transmettre
  manuellement — le cookie de session (Task 2) est envoyé automatiquement
  par le navigateur sur chaque `fetch()` (`credentials: "include"`).

**Conséquence pratique** : `app.js` appelle des chemins relatifs
(`/api/login`, ...), donc cette page ne peut **pas** être ouverte via un
serveur statique séparé (l'extension VS Code "Live Server", `python -m
http.server` sur un autre port, etc.) — elle doit être servie par Flask
lui-même, à `http://localhost:5000/`. Voir
[LANCEMENT.md](../LANCEMENT.md#problèmes-courants) pour ce cas précis.

## 2. Opérations de stock (utilisateur commun)

Implémentées dans `static/app.js` (`loadStock`, `submitStockChange`,
formulaire `#check-form`), branchées sur les routes REST déjà existantes
(Task 2) :

| Action du sujet | UI | Route appelée |
|---|---|---|
| Ajouter du stock | Formulaire « Ajouter / retirer du stock », bouton *Ajouter* | `POST /api/stock/add` |
| Retirer du stock | Même formulaire, bouton *Retirer* | `POST /api/stock/remove` |
| Lister le stock de sa branche | Tableau affiché au chargement de la page | `GET /api/stock` |
| Vérifier la quantité d'un produit | Formulaire « Vérifier la quantité d'un produit » | `GET /api/stock/<sku>` |

**Clarté de la branche opérée** : un bandeau (`#branch-banner`, en haut de
la vue utilisateur commun) affiche en permanence « Branche : <nom> »,
alimenté par le champ `branch_name` de `GET /api/me` (ajouté dans
`app.py` pour cet usage — auparavant l'endpoint ne renvoyait que
`branch_id`).

**La branche n'est jamais un champ modifiable côté frontend.** Le
`product_sku` et la `quantity` sont les seuls champs envoyés par le
formulaire de stock ; le `branch_id` utilisé par le backend vient
exclusivement de `current.branch_id` (la session serveur), comme déjà
implémenté et testé en Task 2. Même en modifiant le JavaScript ou en
rejouant la requête à la main, un utilisateur commun ne peut agir que sur
sa propre branche — l'autorisation est vérifiée côté backend, pas dans
l'interface.

## 3. Gestion des utilisateurs (admin)

Implémentée dans `loadUsers`, `changePassword`, `changeBranch`,
`softDeleteUser`, et le formulaire `#create-user-form` :

| Action du sujet | UI | Route appelée |
|---|---|---|
| Lister les utilisateurs | Tableau, chargé à la connexion | `GET /api/users` |
| Créer un utilisateur commun | Formulaire « Créer un utilisateur commun » | `POST /api/users` |
| Assigner une branche | Sélecteur de branche dans le formulaire de création, ou bouton « Changer branche » par ligne | `POST /api/users` / `PATCH /api/users/<id>/branch` |
| Soft-delete un utilisateur | Bouton « Supprimer » (confirmation demandée) | `DELETE /api/users/<id>` |
| Changer le mot de passe | Bouton « Mot de passe » (invite de saisie) | `PATCH /api/users/<id>/password` |
| Changer la branche assignée | Bouton « Changer branche » | `PATCH /api/users/<id>/branch` |

Les boutons d'action ne sont affichés que pour les utilisateurs
`role === "common"` **et** actifs : un compte déjà soft-delete n'affiche
plus aucune action (il ne peut plus se connecter, cf. Task 2), et l'admin
lui-même n'a pas de ligne d'actions (il n'a pas de branche à gérer).

**Conséquence du soft-delete vérifiée** (rejoue exactement la démonstration
de Task 2, reconfirmée ici avec l'API Produit branchée) :
- l'utilisateur ne peut plus se connecter (`401 invalid credentials`) ;
- une session déjà ouverte perd l'accès à la requête suivante (`401
  authentication required`) ;
- les lignes de `stock` de son ancienne branche restent intactes (le
  soft-delete ne touche que `users.is_active`, jamais `stock`).

## 4. Intégration de l'API Produit dans le Backoffice

Le sujet exige que les détails produit (nom, description, prix…)
proviennent de l'API externe, jamais de la base locale. Deux nouvelles
routes proxy, strictement en lecture, ont été ajoutées (`app.py`) :

- `GET /api/products?q=&limit=` → liste/recherche du catalogue.
- `GET /api/products/<sku>` → détail d'un produit.

Elles appellent `product_client.py` (nouveau module, extrait de la logique
HTTP déjà présente dans `validation.py` pour éviter la duplication — voir
§5) qui interroge l'API Produit externe à chaque requête. **Rien n'est mis
en cache ni écrit dans la base locale** : à chaque chargement de la vue
utilisateur commun, le catalogue est refetché depuis l'API.

Choix retenu : un **sélecteur de produit** (`<select>` peuplé par
`GET /api/products?limit=100`, affichant `SKU — Nom`) pour le formulaire
d'ajout/retrait de stock, et une **résolution du nom** pour chaque ligne du
tableau de stock (`productName(sku)`, qui cherche dans le même catalogue
déjà chargé plutôt que de refaire un appel par ligne). Ce choix a été
préféré à une recherche par identifiant en texte libre : il évite les
fautes de frappe sur le SKU et rend explicite, avant l'action, à quel
produit correspond l'identifiant technique.

Ces routes exigent une session valide (`@login_required`) mais aucun rôle
précis : consulter le catalogue n'est pas une opération sensible, à la
différence de la modification du stock ou des utilisateurs.

## 5. Réutilisation : `product_client.py`

Avant cette tâche, l'appel HTTP vers l'API Produit externe n'existait que
dans `validation.py::product_exists()` (Task 1), pour vérifier qu'un sku
existe avant une opération de stock. Le Backoffice a maintenant un second
besoin (afficher les détails produit), avec les mêmes exigences de
robustesse (API lente, indisponible, 404). Plutôt que dupliquer le code
`urllib`, toute la logique d'accès à l'API Produit a été extraite dans
`product_client.py` :

- `get_product(sku)` → un produit ou `None`.
- `list_products(q, limit, offset)` → résultat paginé, ou une liste vide si
  l'API est injoignable (dégradation silencieuse : parcourir le catalogue
  ne doit jamais faire planter le Backoffice).

`validation.py::product_exists()` devient un simple
`get_product(sku) is not None`. Un seul endroit gère désormais les
timeouts, les 404 et les erreurs réseau vers l'API Produit.

## 6. Vérification effectuée

Le frontend a été vérifié en rejouant, via `curl`, exactement la séquence
d'appels que `app.js` effectue (connexion admin, lecture de `/api/me`,
création d'un utilisateur commun, connexion de cet utilisateur, lecture du
catalogue et du stock, ajout/retrait de stock, vérification d'un sku
absent, changement de mot de passe/branche par l'admin, soft-delete, rejet
de l'ancienne session et de la reconnexion) : chaque réponse JSON
correspond exactement à ce que le JavaScript attend (mêmes noms de champs,
mêmes codes HTTP).

**Limite connue de cette vérification** : l'environnement de développement
utilisé ici (sandbox WSL sans bibliothèques système graphiques) n'a pas
permis un rendu réel dans un navigateur (Chromium headless disponible via
Playwright, mais bloqué par une dépendance système manquante,
`libnspr4.so`, nécessitant une installation via `sudo apt-get` non
effectuée ici). Le contrat API a été vérifié de bout en bout, mais le rendu
visuel (mise en page, alignement, responsive) doit encore être confirmé en
ouvrant `http://127.0.0.1:5000/` dans un vrai navigateur avant de
considérer l'interface définitivement validée.

---

## Récapitulatif des livrables Task 3

- Opérations de stock utilisateur commun : fonctionnelles, voir §2.
- Opérations de gestion des utilisateurs admin : fonctionnelles, voir §3.
- Intégration de l'API Produit : `GET /api/products`, `GET
  /api/products/<sku>`, voir §4.
- Interface Backoffice fonctionnelle : `backoffice/static/` (REST +
  HTML/CSS/JS léger), voir §1.
- Explication de l'approche UI/backend : ce document.
