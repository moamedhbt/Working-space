# Inventaire Complet des Fonctionnalités — Atelier Manager Pro

| Page / Rôle | Fonctionnalité | Route API appelée | Composant actuel |
| :--- | :--- | :--- | :--- |
| **Auth (Tous)** | Connexion (identifiant + mot de passe) | `POST /api/login` | `Login.jsx` |
| **Auth (Tous)** | Connexion rapide (4 boutons rôles, mdp 1234) | `POST /api/login` | `Login.jsx` |
| **Auth (Tous)** | Déconnexion (suppression token) | — (localStorage) | `App.jsx` |
| **Navigation** | Sidebar desktop repliable + barre mobile + recherche `Ctrl+K` + horloge | `GET /api/state` (auto 10s) | `App.jsx` |
| **Direction — Vue d'ensemble** | 4 KPIs (Total, En fabrication, Achats, Clôturés) + Sparklines | `GET /api/state` | `DirectionView.jsx` |
| **Direction — Vue d'ensemble** | Gantt horaire (`08h-17h`, ligne maintenant, badge `LIVE`) | `GET /api/state` | `DirectionView.jsx` |
| **Direction — Vue d'ensemble** | Synthèse IA Direction + bouton `Valider & Publier Planning` | `POST /api/planning/validate` | `DirectionView.jsx` |
| **Direction — Vue d'ensemble** | Tableau Ordres de fabrication (avancement, temps, statut) | `GET /api/state` | `DirectionView.jsx` |
| **Direction — Vue d'ensemble** | Bouton `Nouvelle pièce` (création OF) | `POST /api/pieces` | `DirectionView.jsx` |
| **Direction — Planning** | Tableau de Planning Général + Export PDF + Export Excel (`.csv`) + Valider TV | `POST /api/planning/validate` | `DirectionView.jsx` |
| **Direction — Simulateur** | Simulateur What-If (infos manquantes, charge, verdict) + `Valider & Créer` | `POST /api/planning/simulate`, `POST /api/pieces` | `DirectionView.jsx` |
| **Direction — Dossiers** | Télécharger Dossier `.ZIP` (Fiche PDF + infos BE) | — (client `JSZip` + `jsPDF`) | `DirectionView.jsx` |
| **Direction — Dossiers** | Bouton `Valider Achat` (si statut `À acheter`) | `POST /api/pieces/:id/buy` | `DirectionView.jsx` |
| **Direction — Dossiers** | `Calculer Prix IA` + champ Prix final + `Clôturer` (si statut `À clôturer`) | `POST /api/pieces/:id/close` | `DirectionView.jsx` |
| **Direction — Admin** | Création compte utilisateur (Nom, Identifiant, Mdp, Rôle) + liste | `POST /api/users` | `DirectionView.jsx` |
| **Direction — Admin** | Journal d'Audit (qui a fait quoi + date/heure) | `GET /api/state` (`auditLogs`) | `DirectionView.jsx` |
| **Chef d'atelier** | `Proposer Planning IA` (tri + alertes blocage matière/outils + charge) | `POST /api/planning/optimize` | `ChefView.jsx` |
| **Chef d'atelier** | `Valider & Envoyer TV` | `POST /api/planning/validate` | `ChefView.jsx` |
| **Chef d'atelier** | Calculateur Matière Première (Rond/Plat/Tube, densités, SVG 2D, kg) | — (calcul local) | `MaterialCalculator.jsx` |
| **Chef d'atelier** | Panel Machines (ajout machine + liste active) | `POST /api/machines` | `ChefView.jsx` |
| **Chef d'atelier** | Affectation par pièce (Machine, Opérateur, Matière, Outils, Chute en stock, `Valider & Planifier`) | `POST /api/pieces/:id/chef` | `ChefView.jsx` |
| **Bureau d'études** | Calculateur Matière Première | — (calcul local) | `MaterialCalculator.jsx` |
| **Bureau d'études** | Studio IA 2D → STL 3D (upload photo 2D, cotes, case `Cotes vérifiées` obligatoire, aperçu 3D, prompt modif, téléchargement `.STL`) | — (calcul local) | `BeView.jsx` |
| **Bureau d'études** | Dossiers Pièces BE (`Nom fichier`, `Programme CNC`, `Dessin 3D / Plan`, `Enregistrer`) | `POST /api/pieces/:id/be` | `BeView.jsx` |
| **Opérateur** | Liste des pièces validées affectées à l'opérateur | `GET /api/state` | `OperateurView.jsx` |
| **Opérateur** | `Prendre Photo Début & Démarrer` (caméra mobile + upload) | `POST /api/upload`, `POST /api/pieces/:id/op-start` | `OperateurView.jsx` |
| **Opérateur** | Saisie `Qté réalisée` + Photo Fin + `Terminer + Photo Fin` | `POST /api/upload`, `POST /api/pieces/:id/op-finish` | `OperateurView.jsx` |
| **Écran TV** | Tableau en direct des pièces validées non clôturées + horloge | `GET /api/state` / `GET /api/tv` | `TvView.jsx` |

---

## Ajouts & Règles Strictes Validées

1. **Tableau de planning** : Colonnes `Ordre`, `OF/pièce`, `Client`, `Machine`, `Opérateur`, `Délai`, `Statut / Priorité` (`Critique` / `Urgent` / `Normal` ; `En cours`, `À acheter`, `À clôturer`, `Clôturé`).
2. **Suivi par OF** : `Temps prévu vs réel` et `Quantité réalisée / prévue` visibles sur chaque OF.
3. **Matrice des permissions par rôle** :
   - **Directeur** : Tout voir, créer OF, valider achats, calculer prix IA, clôturer, gérer comptes, voir audit, valider planning.
   - **Chef d'atelier** : Gérer machines, affecter machine/opérateur/matière/outils/chutes, optimiser & valider planning, voir TV.
   - **Bureau d'études** : Calculateur matière, Studio 3D (STL + STEP), enregistrer nom fichier/programme/3D.
   - **Opérateur** : Voir ses OF validés, prendre photo début/fin, saisir quantité réalisée, démarrer/terminer, voir TV.
4. **Auto-refresh 10s non intrusif** : Ne jamais écraser un champ `<input>` / `<select>` en cours de saisie.
5. **Viewer 3D (Three.js + `occt-import-js`)** : Orbite, zoom, transparence, couleurs, fil de fer, arêtes, plan de coupe, mesure, vues `Iso/Face/Dessus/Droite`, import `STL` et `STEP` (arbre d'assemblage + vue éclatée).
