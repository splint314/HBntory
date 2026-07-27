# HBntory — Architecture et planification (Task 0)

> **Task 0 — Architecture and Planning**
> Ce document réunit les trois exercices de la tâche : l'architecture du système, les
> stratégies de communication et la définition du MVP. Il est rédigé pour être compris
> par une autre équipe et ne contient aucun code d'implémentation.

---

# Exercice 1 — Architecture du système

## 1.1 Services du système

Le système HBntory est composé de six services indépendants :

1. **Backoffice** — application web interne authentifiée.
2. **Base de données relationnelle** — stockage des données locales du système.
3. **API Produit externe** — catalogue fournisseur fourni en conteneur Docker (lecture seule).
4. **Serveur MCP Produit** — pont entre l'agent IA et l'API Produit.
5. **Service IA (AI Query Service)** — backend contenant l'agent IA.
6. **Interface client web** — page publique pour les utilisateurs anonymes.

## 1.2 Responsabilité de chaque service

| Service | Responsabilité |
|---|---|
| **Backoffice** | Gérer les utilisateurs (admin) et le stock des branches (utilisateurs communs). Applique l'authentification et les rôles côté backend. |
| **Base de données relationnelle** | Persister les utilisateurs, les branches et les quantités de stock. Ne stocke aucune donnée descriptive de produit. |
| **API Produit externe** | Fournir les informations produit (nom, description, prix, catégorie, marque, fournisseur, tags). Lecture seule, non modifiable par notre système. |
| **Serveur MCP Produit** | Exposer à l'agent IA des outils (lister les produits, obtenir le détail d'un produit) qui interrogent l'API Produit. Il ne touche pas à la base de données. |
| **Service IA** | Recevoir les questions en langage naturel, les transmettre à l'agent, et renvoyer une réponse. Indépendant du backoffice. |
| **Interface client web** | Permettre à un utilisateur anonyme de poser une question et d'afficher la réponse. |

## 1.3 Communication entre les services

- Le **backoffice** lit et écrit directement dans la **base de données relationnelle**,
  après authentification et vérification du rôle.
- L'**interface client web** envoie chaque question au **service IA**.
- Le **service IA** transmet la question à l'agent, qui :
  - appelle le **serveur MCP Produit** (protocole MCP) pour toute information produit ;
  - lit la **base de données** pour les quantités de stock par branche.
- Le **serveur MCP Produit** appelle l'**API Produit externe** en HTTP (lecture seule)
  et ne communique jamais avec la base de données.
- Si les outils disponibles ne fournissent pas assez d'information, l'agent indique
  explicitement que l'information est indisponible, au lieu de l'inventer.

## 1.4 Données stockées localement

La base de données relationnelle stocke uniquement les données locales du système :

- les utilisateurs (identifiant, nom d'utilisateur, rôle, branche assignée, état de
  soft-delete) ;
- les mots de passe hachés (jamais en clair) ;
- les branches (magasins physiques de l'entreprise) ;
- le stock : identifiant produit (le `sku`, ex. `HB-LAP-1001`) associé à une branche et à
  une quantité disponible.

## 1.5 Données provenant de l'API Produit externe

Toutes les informations descriptives des produits proviennent exclusivement de l'API
Produit externe et ne sont **jamais dupliquées** dans la base locale :

- nom du produit ;
- description ;
- prix ;
- catégorie, marque, fournisseur ;
- tags et autres métadonnées.

La base locale ne conserve que le `sku` pour faire le lien entre une quantité de stock et
un produit du catalogue. Les détails sont récupérés à la demande depuis l'API.

## 1.6 Accès de l'agent IA aux données produit et stock

- **Données produit** → l'agent passe par le **serveur MCP Produit**, qui expose des
  outils tels que `list_products` et `get_product_details`. Ces outils interrogent l'API
  Produit externe et renvoient le résultat à l'agent.
- **Données de stock** → l'agent accède aux quantités via la **base de données
  relationnelle**, à travers des outils de stock contrôlés exposés par le serveur MCP
  (ex. `get_stock_by_branch`, `get_branches_with_product`).

Ainsi, l'agent combine les deux sources : le catalogue (API Produit, via MCP) et les
quantités (base locale, via MCP) pour répondre à des questions comme « quelle branche a du
stock du produit X ? » ou « quels produits sont disponibles dans la branche Y ? ».

---

# Exercice 2 — Stratégies de communication

## 2.1 Backoffice — REST + HTML/CSS/JS

- **Option retenue :** une API REST côté backend, consommée par un frontend en
  HTML/CSS/JS (plutôt qu'un rendu côté serveur / Server-Side Rendering).
- **Bénéfice principal :** séparation claire entre la logique métier (l'API) et la
  présentation (le frontend). Les deux couches peuvent être développées, testées et
  modifiées indépendamment, et l'API peut être réutilisée par d'autres clients si besoin.
- **Compromis principal :** il y a plus de code à écrire au départ qu'avec un simple
  rendu côté serveur — deux couches à construire et maintenir au lieu d'une.

## 2.2 Interface client web — REST

- **Option retenue :** communication REST. Chaque question est envoyée dans une requête
  indépendante et reçoit une réponse.
- **Bénéfice principal :** cela correspond exactement au besoin. Le sujet précise que
  chaque question est traitée indépendamment et qu'aucun historique de conversation n'est
  requis. REST est plus simple à implémenter et à déboguer, ce qui convient à la capacité
  de l'équipe.
- **Compromis principal :** pas de streaming de la réponse token par token ni
  d'expérience « chat en temps réel ». Une réponse longue de l'agent arrive d'un seul
  bloc, après un temps d'attente.

## 2.3 Service IA ↔ outils MCP — client MCP standard

- **Option retenue :** le service IA embarque l'agent, qui se connecte au serveur MCP
  comme un client MCP standard, via le protocole MCP. L'agent découvre et appelle les
  outils exposés par le serveur (produit et stock).
- **Bénéfice principal :** découplage total entre l'agent et les sources de données. Le
  serveur MCP peut évoluer, ajouter des outils ou être remplacé sans modifier la logique
  de l'agent.
- **Compromis principal :** une couche d'indirection supplémentaire (agent → MCP → API
  externe ou base de données), qui ajoute un peu de latence et un point de défaillance de
  plus à surveiller.

## 2.4 Modèle LLM de l'agent — Ollama local plutôt qu'une API payante

- **Option retenue :** l'agent appelle un modèle exécuté localement via
  [Ollama](https://ollama.com) (`llama3.1:8b` par défaut, capable de tool-calling), plutôt
  qu'une API LLM payante (Claude, GPT, etc.). `AI_MODEL=llama3.2` (3B) reste disponible comme
  alternative plus rapide mais moins fiable — voir plus bas pourquoi ce n'est pas le choix par
  défaut.
- **Bénéfice principal :** coût nul. C'est un projet étudiant sans budget récurrent — Ollama
  tourne en local (ou dans son propre conteneur via `docker-compose.yml`), sans clé API ni
  facturation à l'usage.
- **Compromis accepté :** un modèle local suit les instructions (rester dans les 4 types de
  questions supportés, ne jamais inventer de donnée, choisir le bon outil) de façon moins
  fiable qu'un modèle frontière payant. Ce compromis est jugé acceptable pour un projet de
  démonstration : le mécanisme de *grounding* (l'agent ne peut répondre qu'avec ce que les
  outils MCP lui renvoient) reste identique quel que soit le modèle qui l'applique — voir
  §1.3 et §1.6. L'inférence CPU locale est aussi plus lente qu'une API hébergée — observé
  entre quelques secondes et plusieurs minutes par question selon la machine, même modèle
  déjà chargé en mémoire. Acceptable pour une démonstration (l'interface cliente affiche un
  indicateur de chargement pendant l'attente), mais pas pour un usage en production à fort
  trafic.
- **Deux défaillances concrètes observées** (détail et logs dans
  [ai_service/README.md](../ai_service/README.md)), qui ont motivé le choix du modèle par
  défaut plutôt que de rester purement théorique sur le compromis :
  1. Avec `llama3.2` (3B) : pour « quels produits sont disponibles dans la branche Lyon ? »,
     l'agent a appelé `list_products_tool` (tout le catalogue, sans filtre de branche) au lieu
     de `get_stock_by_branch_tool`, puis présenté le catalogue entier comme le stock de cette
     branche — une vraie erreur de *grounding* (donnée réelle, mais mauvais outil). Un
     correctif (descriptions d'outils plus explicites dans `product_mcp/server.py`) a corrigé
     le cas testé, mais pas de façon garantie : un nouveau test sur une autre branche a encore
     échoué différemment.
  2. Avec `llama3.1:8b` : le choix d'outil est resté correct dans tous nos essais, mais une
     question de type liste de courses multi-produits a révélé une erreur de comparaison de
     quantités (le modèle a lu la bonne donnée — 5 unités disponibles pour 10 demandées — mais
     a conclu à tort que la branche pouvait tout fournir).
  Aucun des deux modèles n'élimine complètement le risque d'erreur ; `llama3.1:8b` a été
  retenu par défaut car nettement plus fiable sur le choix d'outil (le problème le plus
  visible et le plus proche d'une invention de donnée), au prix d'un téléchargement plus
  lourd et d'une latence un peu plus élevée sur du matériel modeste.

## 2.5 Justification globale

Ces choix privilégient la **simplicité et l'adéquation au besoin** plutôt que la
complexité. Le sujet indique explicitement qu'il ne s'agit pas de choisir l'option la plus
complexe, mais celle qui convient aux exigences du projet et à la capacité de l'équipe.
REST pour le backoffice et le client couvre tous les besoins obligatoires, le protocole MCP
standard assure un couplage faible entre l'agent et ses sources de données, et un LLM local
gratuit couvre le besoin sans engager de coût récurrent pour l'équipe.

---

# Exercice 3 — Produit minimum viable (MVP)

Le MVP couvre **tous les besoins obligatoires** du sujet, sans fonctionnalité superflue.

## 3.1 Implémenté en premier (obligatoire)

- Authentification du backoffice + gestion des rôles (admin / utilisateur commun).
- **Admin :** lister, créer, modifier et soft-delete des utilisateurs ; assigner une
  branche ; changer un mot de passe ; changer la branche d'un utilisateur.
- **Utilisateur commun :** ajouter, retirer et consulter le stock de sa branche ; lister
  les produits en stock dans sa branche.
- Modèle de stock (branche, identifiant produit, quantité), avec quantité jamais négative
  et validation de la quantité demandée.
- Intégration de l'API Produit externe en lecture.
- Serveur MCP Produit avec les outils « lister les produits » et « détails d'un produit ».
- Accès au stock pour l'agent (extension du serveur MCP), fonctionnel.
- Service IA avec un agent répondant aux types de questions donnés en exemple dans le
  sujet.
- Interface client web simple (une page, communication REST).

## 3.2 Laissé pour plus tard

- Amélioration de l'ergonomie et de la mise en forme du backoffice et du client.
- Gestion fine des erreurs et messages utilisateur détaillés.
- Logs et monitoring des appels MCP et API.

## 3.3 Optionnel, si le temps le permet

- Passage du client web en WebSocket pour du streaming de réponse.
- Historique de conversation côté client (non requis par le sujet).
- Agent multi-étapes plus sophistiqué (plusieurs agents spécialisés).
- Tests automatisés de bout en bout complets.

---