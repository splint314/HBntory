# HBntory — Service IA (Task 5)

> Documente le service IA (`ai_service/`) qui reçoit les questions en
> langage naturel du client web et y répond via un agent outillé sur le
> serveur MCP Produit. Détail complet, contrat REST, logs de test et
> historique des corrections dans
> [ai_service/README.md](../ai_service/README.md) — ce document reprend la
> structure de la Task 5 du sujet.

---

## 1. Types de questions supportés (Task 5.1)

Le prompt système de l'agent (`ai_service/agent.py`) restreint
volontairement l'agent à 4 catégories — tout le reste, il doit dire
explicitement que c'est hors de son périmètre plutôt que d'improviser :

1. **Détails d'un produit** — « Quels sont les détails du produit
   HB-LAP-1001 ? »
2. **Quelle(s) branche(s) ont un produit** — « Quelles branches ont du
   stock du produit HB-KBD-4102 ? »
3. **Quels produits sont disponibles dans une branche** — « Quels produits
   sont disponibles dans la branche Lyon ? »
4. **Faisabilité d'une liste de courses** — « J'ai besoin de 5 claviers et
   2 écrans, une branche peut-elle tout fournir ? » — l'agent doit
   comparer la *quantité* demandée à la quantité réelle par branche, pas
   seulement vérifier que la branche a le produit.

Une question hors de ces 4 catégories (ex. « Quelle est la météo à
Paris ? ») est explicitement déclinée par l'agent plutôt que traitée.

## 2. Connexion de l'agent aux outils Produit + observabilité (Task 5.2)

`ai_service/mcp_client.py` lance `product_mcp/server.py` en sous-processus
(protocole MCP, transport stdio) et ouvre une session MCP standard.
`agent.py` convertit la liste d'outils MCP au format attendu par Ollama
(`tools=[...]` dans `/api/chat`), puis boucle (`MAX_TOOL_TURNS=8`) : à
chaque tour, si le modèle demande un appel d'outil, l'agent l'exécute via
la session MCP et renvoie le résultat au modèle ; sinon la réponse texte
du modèle est le résultat final.

Chaque appel d'outil (nom, arguments) et son résultat (`isError`, contenu
tronqué) est loggé au niveau `INFO` sous le logger `hbntory.agent` — donc
observable/débuggable en direct sur la sortie standard du service pendant
qu'il tourne, sans avoir à instrumenter quoi que ce soit de plus :

```
hbntory.agent: tool call: get_branches_with_product_tool({'product_sku': 'HB-KBD-4102'})
hbntory.agent: tool result: get_branches_with_product_tool -> isError=False {...}
```

C'est ce logging qui a permis de diagnostiquer précisément les deux
défaillances de raisonnement documentées en section 4.

## 3. Stratégie d'accès au stock (Task 5.3)

Décision : **étendre le serveur MCP Produit existant** avec des outils de
stock (`list_branches_tool`, `get_stock_by_branch_tool`,
`get_branches_with_product_tool`, ajoutés dans `product_mcp/stock_client.py`),
plutôt que :

- un second serveur MCP dédié à la base de données — rejeté : deux
  connexions MCP à gérer côté agent, deux points de défaillance, pour un
  gain de séparation qui n'apporte rien ici (le stock est aussi peu
  sensible à exposer en lecture seule que le catalogue) ;
- un outil MCP de base de données tiers (ex. MCP Toolbox for Databases) —
  rejeté : ajoute une dépendance et une configuration supplémentaires pour
  un besoin très simple (3 requêtes SQL en lecture seule), alors qu'un
  script Python de 100 lignes (`stock_client.py`) suffit et reste sous
  contrôle total de l'équipe.

Une seule connexion MCP donne donc à l'agent le catalogue **et** le stock.
La frontière de sécurité est appliquée à la même couche que les outils
produit : `stock_client.py` ouvre le fichier SQLite du Backoffice avec
`mode=ro` — une écriture y est donc structurellement impossible, pas
seulement empêchée par convention. Voir
[product_mcp_server.md](product_mcp_server.md) pour le détail des 5
outils.

## 4. Réponses fondées, jamais inventées (Task 5.4)

Le prompt système interdit explicitement d'inventer un produit, un prix,
une description ou une quantité de stock ; si un outil signale « non
trouvé » ou est indisponible, l'agent doit le dire plutôt que deviner.

**Deux défaillances réelles ont été trouvées et documentées** en testant
le système en conditions réelles (voir
[ai_service/README.md](../ai_service/README.md#tool-selection-reliability-why-the-default-model-changed-2026-07-27)
pour les logs complets) :

1. Avec le petit modèle (`llama3.2`, 3B) : mauvais choix d'outil pour une
   question de stock par branche (`list_products_tool` — tout le
   catalogue — au lieu de `get_stock_by_branch_tool`), présentant le
   catalogue entier comme le stock d'une branche. Un correctif (docstrings
   d'outils plus explicites) a partiellement aidé, mais pas de façon
   fiable à 100 % — d'où le passage à `llama3.1:8b` par défaut.
2. Avec le modèle plus gros (`llama3.1:8b`) : les bons outils sont
   appelés et les bonnes données récupérées, mais une question de liste de
   courses multi-produits a révélé une erreur de comparaison arithmétique
   (quantité disponible vs demandée) — deux tentatives de renforcement du
   prompt n'ont pas corrigé ça de façon fiable. Documenté comme limitation
   connue non résolue plutôt que caché (voir
   [README.md](../README.md#limitations-connues) à la racine).

Ces deux cas restent des erreurs de *raisonnement* du modèle sur des
données réelles — jamais un cas où l'agent a inventé un produit, un prix
ou une branche qui n'existe pas.

## 5. Point d'accès pour le client (Task 5.5)

`POST /api/ask` (`{"question": "..."}` → `{"answer": "..."}`), REST (voir
[architecture_and_planning.md](architecture_and_planning.md) §2.2 pour la
justification REST plutôt que WebSocket). Chaque requête est indépendante,
aucun historique de conversation n'est conservé — conforme au sujet, qui
ne l'exige pas.

Codes d'erreur, tous au format `{"error": "<code>", "message": "..."}` :

| Statut | `error` | Quand |
|---|---|---|
| 400 | `bad_request` | `question` manquante ou vide |
| 503 | `agent_unavailable` | Ollama injoignable, échec du LLM, serveur MCP Produit qui ne démarre pas, ou trop d'allers-retours d'outils sans réponse |
| 500 | `internal_error` | Imprévu — capturé par un handler Flask global, jamais de stack trace brute |

`GET /health` pour un contrôle de vie simple. Un second endpoint,
`GET /api/catalog`, a été ajouté en bonus pour alimenter la grille de
catalogue de `client_web/` — lecture seule via les outils MCP, sans appel
au LLM (voir [ai_service/README.md](../ai_service/README.md#get-apicatalog)).

---

## Récapitulatif des livrables Task 5

- Service IA indépendant : `ai_service/app.py`.
- Intégration agent ↔ outils Produit : section 2, `ai_service/agent.py`,
  `mcp_client.py`.
- Stratégie d'accès au stock : section 3.
- Point d'accès pour le client : `POST /api/ask`, section 5.
- Documentation des types de questions supportés : section 1.
