# HBntory — Interface client web (Task 6)

> Documente la page publique où un visiteur anonyme pose des questions en
> langage naturel sur les produits et le stock. Détail complet et preuves
> de test dans [client_web/README.md](../client_web/README.md) — ce
> document reprend la structure de la Task 6 du sujet.

---

## 1. Interface de base

Page statique (`client_web/index.html` + `app.js` + `style.css`, aucun
framework, aucune étape de build — même approche que le Backoffice, voir
[backoffice_ui.md](backoffice_ui.md) §1), avec :

- un champ texte pour la question ;
- un bouton d'envoi ;
- une zone de réponse.

Présentée en style recherche/formulaire plutôt qu'en chat (les deux étaient
valides selon le sujet) : chaque question est indépendante, sans historique
de conversation, donc un fil de discussion n'apportait rien de plus qu'un
simple formulaire question → réponse.

**Aucune authentification requise** pour poser une question — exigence
explicite du sujet, qui reste vraie quelle que soit l'évolution du reste de
la page (voir point bonus ci-dessous).

**Point bonus, hors périmètre obligatoire** : un panneau catalogue a été
ajouté, mais réservé aux comptes Backoffice (connexion cross-origin réelle
contre le Backoffice, pas un simple lien) — voir
[architecture_and_planning.md](architecture_and_planning.md) §2.2 addendum
pour la justification et le mécanisme CORS/cookie. Ce panneau ne remplace
jamais l'assistant anonyme, qui reste accessible sans connexion.

## 2. Connexion au Service IA

`app.js` envoie `POST /api/ask` à `ai_service` (REST, voir
[ai_query_service.md](ai_query_service.md) §5 pour la justification REST
plutôt que WebSocket) :

- pendant l'attente : bouton désactivé, message « Recherche en cours… » ;
- au succès : le texte de la réponse remplace le message de chargement ;
- en cas d'échec : un message d'erreur clair remplace le chargement (voir
  détail des cas en section 3).

L'URL du service est configurable (`?api=http://host:port`) pour ne pas
coder en dur l'adresse si le service tourne ailleurs.

## 3. Validation de l'expérience utilisateur

Testé avec les questions représentatives des 4 catégories obligatoires,
plus le cas d'erreur :

| Catégorie | Exemple |
|---|---|
| Détail produit | Quels sont les détails du produit HB-LAP-1001 ? |
| Disponibilité par branche | Quels produits sont disponibles dans la branche Lyon ? |
| Disponibilité d'un produit entre branches | Quelles branches ont du stock du produit HB-KBD-4102 ? |
| Recommandation liste de courses | Je veux équiper un poste de travail complet, que recommandes-tu ? |
| Produit inconnu (chemin d'erreur) | As-tu du stock pour un produit qui n'existe pas, XYZ-0000 ? |

Affichées directement sur la page comme exemples cliquables (remplissent
le champ sans envoyer automatiquement, pour ne pas surprendre l'utilisateur
avec un appel déclenché sans qu'il l'ait explicitement demandé).

**Gestion d'erreur**, testée pour chaque cas :
- Service IA joignable mais qui répond une erreur (400/503/500) : le
  message de `ai_service` est affiché tel quel (déjà lisible par un
  humain, ex. « Ollama is not reachable at ... »).
- Service IA injoignable (mauvaise URL, service arrêté) : `fetch()` échoue
  avec un `TypeError`, remplacé par un message générique plutôt qu'une
  exception brute.

**Limite honnête** : le clic-par-clic complet dans un vrai navigateur
(rendu visuel, focus, défilement) n'a pas été exécuté dans cet
environnement de développement (pas d'affichage/navigateur disponible ici,
voir [client_web/README.md](../client_web/README.md#manual-test-evidence)).
La logique requête/réponse a été vérifiée directement contre l'API réelle
d'`ai_service` en ligne de commande. Un passage manuel en navigateur reste
recommandé avant la démonstration finale.

---

## Récapitulatif des livrables Task 6

- Page publique fonctionnelle : `client_web/index.html`, `app.js`,
  `style.css`.
- Connexion au Service IA : section 2, `POST /api/ask`.
- Gestion d'erreur basique : section 3.
- Questions d'exemple documentées : section 3, et affichées sur la page.
