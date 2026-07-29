# HBntory — Serveur MCP Produit (Task 4)

> Documente le serveur MCP qui sert de pont entre l'agent IA et l'API
> Produit externe (+ le stock du Backoffice, ajouté en Task 5). Détail
> complet, code et logs de test dans
> [product_mcp/README.md](../product_mcp/README.md) — ce document reprend
> la structure de la Task 4 du sujet et explique les décisions.

---

## 1. Définition des outils MCP

Le serveur (`product_mcp/server.py`, SDK Python `mcp`, `FastMCP`, transport
stdio) expose 5 outils en lecture seule, chacun avec un schéma
d'entrée/sortie explicite via des modèles Pydantic (`ProductSummary`,
`ProductDetails`, `BranchStockResult`, `ProductAvailabilityResult`) :

| Outil | Entrée | Sortie |
|---|---|---|
| `list_products_tool` | `query`, `category`, `min_price`/`max_price`, `include_discontinued`, `limit` (1-100), `offset` | Liste paginée de `ProductSummary` (résumé : pas de description/tags/fournisseur) |
| `get_product_details` | `identifier` (id ou SKU) | `ProductDetails` complet |
| `list_branches_tool` | *(aucune)* | Liste des noms de branches |
| `get_stock_by_branch_tool` | `branch_name` (exact) | Stock de cette branche (`product_sku` + `quantity`, uniquement > 0) |
| `get_branches_with_product_tool` | `product_sku` | Branches ayant ce produit en stock (> 0) |

Les deux premiers outils sont le minimum exigé par le sujet (« lister les
produits », « détails d'un produit ») ; les trois derniers sont
l'extension Task 5 pour donner à l'agent l'accès au stock (voir
[ai_query_service.md](ai_query_service.md) §3 pour la justification de ce
choix plutôt qu'un outil MCP de base de données tiers).

**Pourquoi `list_products_tool` renvoie un résumé et pas le détail
complet** : une liste ne doit pas donner à l'agent des données qu'il n'a
pas demandées (description, tags, fournisseur) — cette séparation évite
que l'agent cite des détails d'un produit qu'il n'a fait que parcourir,
sans jamais avoir appelé `get_product_details` dessus.

## 2. Communication avec l'API Produit

`product_client.py` (dans `product_mcp/`) appelle l'API Produit externe en
HTTP. Contrairement à l'équivalent côté Backoffice
(`backoffice/product_client.py`, qui dégrade silencieusement — une liste
vide plutôt qu'un crash, acceptable pour une fonctionnalité de navigation),
celui-ci **lève des exceptions typées** :

- `ProductNotFoundError` — 404 sur un id/SKU précis (résultat normal d'une
  recherche).
- `ProductAPIError` — tout le reste : hôte injoignable, timeout, statut
  HTTP inattendu (y compris le `force_error=true` simulé par l'API), corps
  de réponse qui n'est pas du JSON valide.

Justification : un agent IA ne peut pas se permettre le compromis « liste
vide » du Backoffice — s'il recevait silencieusement une liste vide, il ne
pourrait pas distinguer « ce produit n'existe pas » de « le catalogue est
en panne », et risquerait d'affirmer une réponse fausse avec assurance.
`stock_client.py` applique le même principe côté stock
(`BranchNotFoundError` / `StockAPIError`).

Chacun des 5 outils dans `server.py` capture ces exceptions et les
relève en `mcp.server.fastmcp.exceptions.ToolError`, que FastMCP transforme
en `CallToolResult(isError=True, ...)` portant le message d'erreur comme
contenu texte — jamais un échec silencieux, une stack trace brute, ou une
requête qui reste bloquée. Les arguments invalides (ex. `limit` hors
bornes) sont rejetés de la même façon, avant même l'appel HTTP.

## 3. Tests manuels

`product_mcp/manual_test.py` appelle les outils via le chemin `call_tool`
propre de FastMCP — exactement celui qu'emprunterait un vrai client MCP —
et couvre les 4 cas requis par le sujet, plus un cas bonus :

```bash
cd product_mcp
PRODUCT_API_URL=http://127.0.0.1:5001 .venv/bin/python manual_test.py
```

Résultats observés (voir [product_mcp/README.md](../product_mcp/README.md#manual-test-evidence)
pour le détail complet) :

1. **Listing réussi** — `list_products_tool(query="laptop", limit=3)` →
   5 résultats au total, 3 renvoyés, correctement filtrés.
2. **Détail produit** — `get_product_details("HB-LAP-1001")` → fiche
   complète (description, fournisseur, tags).
3. **Produit introuvable** — `get_product_details("does-not-exist")` →
   `ToolError: No product found for id/SKU 'does-not-exist'.`
4. **Entrée invalide** — `list_products_tool(limit=0)` → `ToolError: limit
   must be between 1 and 100.` (rejeté avant tout appel HTTP).
5. **API Produit injoignable** — `PRODUCT_API_URL` pointé sur un port
   fermé → `ToolError: Product catalog is currently unavailable: ...
   Connection refused` sur les deux outils produit.

Vérifié en plus directement contre la simulation `force_error=true` de
l'API Produit (backend joignable mais qui répond une erreur, différent du
cas 5 qui est une vraie panne réseau) :
`ProductAPIError: Product API returned HTTP 503 ...`.

Les outils de stock ont été vérifiés contre la base seedée
(`backoffice/seed.py`, branches Lyon/Paris) : `list_branches_tool()` →
`['Lyon', 'Paris']` ; `get_stock_by_branch_tool('Lyon')` → 4 lignes ;
`get_branches_with_product_tool('HB-KBD-4102')` → Lyon, 25 ;
`get_stock_by_branch_tool('Nowhere')` → `ToolError: No branch named
'Nowhere'.`

---

## Récapitulatif des livrables Task 4

- Implémentation du serveur MCP Produit : `product_mcp/server.py`.
- Définitions des outils : section 1 ci-dessus, détail dans
  [product_mcp/README.md](../product_mcp/README.md#tools).
- Preuve de tests manuels : section 3 ci-dessus et
  `product_mcp/manual_test.py`.
- Explication de la gestion d'erreurs : section 2 ci-dessus.
