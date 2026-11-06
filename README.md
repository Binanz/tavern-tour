# Tavern Tour

Jeu de plateau statique entre amis : partie locale contre les bots ou multijoueur PeerJS/WebRTC, avec un navigateur hôte qui fait autorité.

## Lancer le jeu

Servir ce dossier avec un serveur HTTP statique et ouvrir `index.html`. Les modules JavaScript natifs nécessitent HTTP : ouvrir directement le fichier via `file://` ne suffit plus. Aucun build ni paquet npm à installer. L'hébergeur doit publier aussi le dossier `src/` et servir les `.js` avec un type MIME JavaScript.

PeerJS et les polices sont chargés depuis des CDN. Le multijoueur nécessite une connexion et l'hôte doit rester présent.

## Vérifier les changements

Avec Node.js 22 ou plus :

```sh
npm test
```

Les tests d'intégration chargent les vrais modules avec un DOM et des timers simulés : démarrage, partie locale, classement, retour à l'accueil et routage des messages réseau. Ils ne remplacent pas une vérification du rendu ou une partie WebRTC dans deux navigateurs. `sim.js` exécute ensuite 100 parties et les tests de règles existants. Le chargeur de modules de test utilise l'API VM expérimentale de Node ; le jeu utilise les modules standard du navigateur.

## Organisation

- `app.js` : composition des contrôleurs, branchement des callbacks et démarrage.
- `src/runtime.js` : références de configuration et état partagé de l'application.
- `src/lobby.js` : accueil, profils, création et arrivée dans une salle.
- `src/connection.js` : messages hôte/invité, reconnexion et heartbeat.
- `src/session.js` : lancement, actions, boucle hôte et programmation des bots.
- `src/audio.js` : sons Web Audio.
- `src/ui/board.js` : plateau, pions, joueurs et journal.
- `src/ui/game.js` : coordination du rendu et horloges d'affichage.
- `src/ui/actions.js` : actions proposées et sélection sur le plateau.
- `src/ui/dialogs.js` : propriétés, cartes, classement et règles.
- `src/ui/animations.js` : mouvements, dés et effets visuels.
- `src/ui/helpers.js` : modales, toasts et formatage partagé.
- `engine.js` : règles, transitions et décisions des bots ; utilisable dans Node.
- `config.js` : règles et contenu ; `net.js` : transport PeerJS.

Les contrôleurs exposent des fonctions via une factory. Leurs interactions sont injectées par `app.js` : les modules ne s'importent pas mutuellement. Les factories n'appellent pas leurs callbacks à la création ; le démarrage a lieu après leur assemblage.

Pour ajouter une règle, modifier le moteur et ses tests dans `sim.js`, puis l'action ou la vue concernée. Pour ajouter un écran, créer son module UI et le brancher dans `app.js`. Garder les détails PeerJS dans `net.js` et le traitement des messages dans `src/connection.js`.

Le découpage conserve encore les mutations historiques de l'état partagé ; la centralisation des écritures de partie fait l'objet d'un changement séparé.
