# HBntory — Intégration, tests et documentation (Task 7)

> Documente la vérification du flux complet, les scénarios critiques
> testés, et pointe vers les livrables README/présentation. Détail complet
> et logs dans [README.md](../README.md) (sections « Tests », «
> Limitations connues ») et [docs/demo_script.md](demo_script.md).

---

## 1. Intégration du flux complet

Vérifié en conditions réelles, tous les services lancés ensemble (via
`docker compose up --build`, ou `./launch_all.sh` en alternative sans
Docker — voir [README.md](../README.md#installation-et-lancement)) :

- [x] API Produit externe démarrée et joignable (`/health`).
- [x] Base de données Backoffice initialisée (`seed.py` : admin, 2
  branches, stock d'exemple).
- [x] Les utilisateurs du Backoffice peuvent s'authentifier (session,
  cookie signé — voir
  [authentication_and_authorization.md](authentication_and_authorization.md)).
- [x] Les utilisateurs communs gèrent le stock de leur branche
  (ajout/retrait/consultation, isolation par branche vérifiée côté
  backend — voir [backoffice_ui.md](backoffice_ui.md) §2).
- [x] L'admin gère les utilisateurs (créer, soft-delete, changer
  mot de passe/branche — voir [backoffice_ui.md](backoffice_ui.md) §3).
- [x] Le serveur MCP Produit accède aux données produit **et** stock
  (voir [product_mcp_server.md](product_mcp_server.md)).
- [x] Le Service IA répond aux questions en utilisant produit et stock via
  le serveur MCP (voir [ai_query_service.md](ai_query_service.md)).
- [x] L'interface client affiche les réponses (voir
  [client_web_interface.md](client_web_interface.md)).

Cette intégration a été vérifiée au fil du projet, pas laissée pour le
dernier jour : chaque service a été testé contre les précédents dès son
implémentation (ex. le serveur MCP contre l'API Produit et la base seedée
en Task 4, l'agent contre le serveur MCP en Task 5, le client contre le
Service IA en Task 6), puis rejoué de bout en bout à plusieurs reprises
lors de l'intégration du modèle Ollama et de la conteneurisation.

## 2. Scénarios critiques testés

Suite automatisée `pytest` pour le Backoffice (20 tests, `backoffice/tests/`) :

```bash
cd backoffice
../.venv/bin/pip install -r requirements-dev.txt
../.venv/bin/python -m pytest tests/ -v
```

Plus les scripts de vérification manuelle par service
(`backoffice/manual_test.py`, `product_mcp/manual_test.py`,
`ai_service/manual_test.py` — voir leurs README respectifs).

| Scénario exigé par le sujet | Couverture |
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
| L'IA répond où un produit est disponible | `ai_service/README.md` (vérifié en direct) |
| L'IA répond quels produits sont disponibles dans une branche | `ai_service/README.md` (a révélé une vraie limite du petit modèle, documentée et partiellement corrigée — voir §4 de [ai_query_service.md](ai_query_service.md)) |
| L'IA répond clairement pour un produit inconnu | `ai_service/README.md` (vérifié en direct) |
| L'IA répond clairement quand l'information est indisponible | idem |

Ce tableau documente aussi honnêtement les cas qui ont révélé de vraies
limites (raisonnement du LLM local) plutôt que de ne lister que les
succès — voir [README.md](../README.md#limitations-connues) pour le détail
complet des limitations connues et pourquoi elles n'ont pas été cachées.

## 3. README

Le [README.md](../README.md) à la racine couvre, comme demandé par le
sujet : aperçu du projet, membres de l'équipe, résumé de l'architecture,
instructions d'installation (Docker et sans Docker), comment lancer chaque
service, comment initialiser la base, comment accéder au Backoffice et à
l'interface client, les principales décisions techniques, les limitations
connues, et les fonctionnalités optionnelles implémentées (aucune, choix
assumé de rester sur le MVP — voir
[architecture_and_planning.md](architecture_and_planning.md) §3.3).

## 4. Présentation finale

Déroulé suggéré pour la soutenance (architecture, démonstration Backoffice
admin/commun, démonstration IA, points techniques à mentionner, filet de
sécurité si quelque chose échoue en direct) : voir
[docs/demo_script.md](demo_script.md).

---

## Récapitulatif des livrables Task 7

- Application intégrée : section 1 ci-dessus.
- README : section 3, [README.md](../README.md).
- Preuve de tests : section 2, `backoffice/tests/`, scripts manuels par
  service.
- Présentation finale : section 4, [docs/demo_script.md](demo_script.md).
