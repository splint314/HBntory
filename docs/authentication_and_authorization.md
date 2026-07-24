# HBntory — Authentification et autorisation (Task 2)

> Documente la stratégie d'authentification, le hachage des mots de passe et
> l'application des règles d'autorisation par rôle dans l'API REST du
> Backoffice (`backoffice/app.py`, `auth.py`, `security.py`,
> `user_service.py`).

---

## 1. Authentification : session côté serveur (cookie signé)

### 1.1 Option retenue

Authentification **par session**, via le mécanisme de session intégré à
Flask : après un login réussi, `session["user_id"] = user.id` est écrit
dans un cookie **signé cryptographiquement** (`itsdangerous`, avec
`app.secret_key`). Le navigateur renvoie ce cookie à chaque requête ; le
serveur le valide et recharge l'utilisateur correspondant depuis la base
avant chaque action protégée (`auth.get_current_user()`).

### 1.2 Justification face à l'alternative (token / JWT)

| | Session (cookie signé) | Token (JWT) |
|---|---|---|
| Révocation immédiate | Facile : on relit l'utilisateur en base à chaque requête, un `is_active=False` coupe l'accès instantanément | Difficile : un JWT reste valide jusqu'à expiration, sauf liste de révocation supplémentaire |
| Complexité d'implémentation | Faible, intégrée à Flask | Nécessite une librairie, la gestion de l'expiration/refresh |
| Adapté au projet | Le Backoffice est une appli interne classique, consommée par un frontend HTML/CSS/JS du même système | Plus pertinent pour une API consommée par des clients tiers/mobiles multiples |

Le sujet exige explicitement de **rejeter les utilisateurs supprimés**
(soft-delete) à l'authentification. Avec un JWT signé côté client, un
utilisateur soft-delete garderait un token valide jusqu'à expiration. Avec
notre approche, chaque requête relit `is_active` en base
(`get_current_user()`), donc la révocation est immédiate. C'est la raison
principale du choix.

**Compromis accepté :** un peu plus de charge base de données (une lecture
`User` par requête protégée) contre une révocation immédiate et fiable.
Pour la taille de ce projet, ce coût est négligeable.

### 1.3 Déroulé de l'authentification

1. `POST /api/login` reçoit `{username, password}`.
2. Le serveur cherche l'utilisateur par `username`.
3. Si l'utilisateur n'existe pas, **ou** est soft-delete (`is_active=False`),
   **ou** le mot de passe ne correspond pas → même réponse générique
   `401 {"error": "invalid credentials"}`. On ne distingue jamais ces trois
   cas dans la réponse, pour ne pas donner d'indice à un attaquant sur
   l'existence d'un compte (énumération de comptes).
4. Si tout est correct : `session.clear()` puis `session["user_id"] =
   user.id`. Le cookie signé est renvoyé au client par Flask.
5. Chaque route protégée passe par `get_current_user()`, qui relit
   l'utilisateur en base à partir de `session["user_id"]` et vérifie à
   nouveau `is_active`.
6. `POST /api/logout` appelle `session.clear()` : le cookie est invalidé
   côté serveur (son contenu est vidé, un vieux cookie volé ne référence
   plus rien d'exploitable après un logout+relogin car la session est
   réinitialisée).

### 1.4 Protection des routes

Toutes les routes du Backoffice, sauf `/api/login`, exigent une session
valide. Ceci est implémenté par les décorateurs de `auth.py`
(`login_required`, `admin_required`, `common_required`) posés directement
sur les fonctions Flask — **pas** une vérification faite dans le frontend.
Un appel direct à l'API sans cookie de session valide reçoit
systématiquement `401`.

### 1.5 Durcissement du cookie de session

Le cookie de session Flask est configuré avec `HttpOnly=True` (inaccessible
en JavaScript, limite le vol de session via une éventuelle faille XSS) et
`SameSite="Lax"` (le cookie n'est pas envoyé sur une requête cross-site,
limite le CSRF). Le sujet précise que SSL/TLS n'est pas requis pour ce
projet, donc le flag `Secure` n'est pas activé (il empêcherait l'envoi du
cookie en HTTP simple, utilisé ici en développement).

## 2. Stockage sécurisé des mots de passe

### 2.1 Mécanisme choisi : Argon2id

Le mot de passe est haché avec **Argon2id** (librairie `argon2-cffi`,
`backoffice/security.py`), vainqueur de la Password Hashing Competition et
recommandé par l'OWASP comme premier choix pour le hachage de mots de
passe.

```python
from argon2 import PasswordHasher
_ph = PasswordHasher()
_ph.hash(plain_password)          # hachage
_ph.verify(stored_hash, password) # vérification
```

- Le **sel** est généré automatiquement et aléatoirement à chaque hachage
  par la librairie, et stocké dans le hash lui-même (format
  `$argon2id$v=19$m=...,t=...,p=...$sel$hash`) — pas besoin de gérer un sel
  séparément.
- Argon2id est **volontairement lent et coûteux en mémoire** (paramètres
  `m` = coût mémoire, `t` = coût temps, `p` = parallélisme), ce qui rend les
  attaques par force brute ou par tables précalculées (rainbow tables)
  très coûteuses, y compris sur du matériel spécialisé (GPU/ASIC).
- Une politique minimale complète le hachage : `security.validate_password_strength()`
  refuse tout mot de passe de moins de 8 caractères, aussi bien à la
  création d'un utilisateur commun (`user_service.create_common_user`) qu'au
  changement de mot de passe (`change_password`) et au seed de l'admin
  (`seed.py`). Argon2id protège contre le cassage hors-ligne rapide, mais ne
  compense pas un mot de passe trivialement court : les deux contrôles sont
  complémentaires.

### 2.2 Pourquoi pas un simple SHA256 ?

SHA256 (ou MD5, SHA1) est un hash **cryptographique généraliste**, conçu
pour être **rapide** — exactement l'inverse de ce qu'il faut pour un mot de
passe :

- **Vitesse = faiblesse ici.** Un GPU moderne calcule des milliards de
  SHA256 par seconde. Un attaquant qui vole la base peut tester
  l'intégralité d'un dictionnaire de mots de passe courants en quelques
  minutes.
- **Pas de sel intégré.** Sans sel, deux utilisateurs avec le même mot de
  passe ont le même hash, immédiatement repérable, et vulnérable aux
  rainbow tables précalculées.
- **Pas de facteur de coût réglable.** SHA256 ne peut pas être « ralenti »
  au fil du temps pour suivre l'augmentation de puissance de calcul des
  attaquants, contrairement à Argon2id (paramètres `m`/`t` ajustables).

Un simple `sha256(password)`, même salé manuellement, reste bien plus
faible qu'Argon2id car il manque le coût mémoire/temps délibéré qui rend
les attaques hors-ligne à grande échelle impraticables.

### 2.3 Vérification

`security.verify_password(stored_hash, plain_password)` appelle
`_ph.verify()` et capture `VerifyMismatchError` / `InvalidHashError` pour
renvoyer `False` plutôt que de laisser remonter une exception — la route de
login traite alors ce cas exactement comme "invalid credentials".

Le mot de passe en clair ne transite **jamais** vers la base de données :
`user_service.create_common_user()` et `change_password()` appellent
systématiquement `hash_password()` avant `session.add()` /
l'affectation à `password_hash`.

## 3. Autorisation par rôle

### 3.1 Rôles et règles

| Rôle | Peut | Ne peut pas |
|---|---|---|
| `admin` | Lister/créer/modifier/soft-delete les utilisateurs ; changer mot de passe et branche d'un utilisateur | Gérer le stock (aucune route stock ne lui est ouverte) |
| `common` | Ajouter/retirer/consulter le stock de **sa propre branche** ; lister les produits en stock de sa branche | Gérer les utilisateurs ; agir sur une autre branche que la sienne |

### 3.2 Application côté backend

Trois décorateurs (`backoffice/auth.py`) :

- `login_required` : exige une session valide (401 sinon).
- `admin_required` : exige en plus `role == "admin"` (403 sinon).
- `common_required` : exige en plus `role == "common"` (403 sinon).

Ils sont posés sur **chaque route** Flask concernée
(`backoffice/app.py`) :

- Toutes les routes `/api/users*` et `/api/branches` → `@admin_required`.
- Toutes les routes `/api/stock*` → `@common_required`.

Aucune vérification de rôle n'existe côté frontend uniquement : même si un
bouton était caché dans l'interface, un appel direct à l'API avec la
session d'un utilisateur `common` sur une route `/api/users` renvoie `403`
(vérifié manuellement, voir section 4).

### 3.3 Isolation par branche (au-delà du rôle)

La règle « un utilisateur commun ne peut agir que sur sa branche » ne
suffit pas à être un simple rôle : elle doit lier l'action à la branche
*assignée à cet utilisateur précis*. Implémentation dans `app.py` :

```python
current = get_current_user()
stock = add_stock(db, current.branch_id, product_sku, quantity)
```

Le `branch_id` **n'est jamais lu depuis le corps de la requête envoyée par
le client** pour les routes de stock : il est toujours dérivé de
`current.branch_id`, c'est-à-dire de la session serveur. Un utilisateur
`common` ne peut donc physiquement pas fournir un `branch_id` différent
dans le JSON pour agir sur une autre branche — le serveur l'ignorerait de
toute façon.

### 3.4 Vérification manuelle effectuée

Testé avec `curl` sur une instance locale (voir historique de la session) :

1. Login admin → `me` renvoie `role: admin`, `branch_id: null`.
2. Admin appelle `/api/stock` → `403 {"error": "common user role
   required"}`.
3. Admin crée un utilisateur `common` assigné à la branche Lyon.
4. Login de ce nouvel utilisateur → `/api/users` → `403 {"error": "admin
   role required"}`.
5. Il consulte/ajoute/retire du stock de sa branche ; un retrait excessif
   et une quantité négative sont refusés (`400`), conformément aux règles
   de validation de la Task 1.
6. Une tentative d'injecter un `branch_id` d'une autre branche dans le
   corps de la requête est silencieusement ignorée : l'opération reste
   appliquée à sa branche assignée.
7. L'admin soft-delete cet utilisateur (`DELETE /api/users/<id>`) : sa
   session déjà ouverte perd immédiatement l'accès (`401 {"error":
   "authentication required"}`), et toute nouvelle tentative de connexion
   avec ce compte échoue (`401 {"error": "invalid credentials"}`).

---

## Récapitulatif des livrables Task 2

- Authentification : `POST /api/login`, `POST /api/logout`, `GET /api/me`
  (`backoffice/app.py`), stratégie détaillée en section 1.
- Hachage sécurisé des mots de passe : `backoffice/security.py`, détaillé
  en section 2.
- Règles d'autorisation par rôle : `backoffice/auth.py` +
  décorateurs appliqués dans `backoffice/app.py`, détaillé en section 3.
- Documentation de la stratégie : ce document.
