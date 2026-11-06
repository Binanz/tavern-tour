// Assemblage des contrôleurs. Les callbacks relient les modules sans imports circulaires.
import { app, E } from './src/runtime.js';
import { createLobby } from './src/lobby.js';
import { createConnection } from './src/connection.js';
import { createSession } from './src/session.js';
import { createBoard } from './src/ui/board.js';
import { createAnimations } from './src/ui/animations.js';
import { createActions } from './src/ui/actions.js';
import { createDialogs } from './src/ui/dialogs.js';
import { createGameView } from './src/ui/game.js';

const lobby = createLobby({
  hostOnMessage: (...args) => connection.hostOnMessage(...args),
  onPeerLeft: (...args) => connection.onPeerLeft(...args),
  clientOnMessage: (...args) => connection.clientOnMessage(...args),
  scheduleHostLost: (...args) => connection.scheduleHostLost(...args),
  startGame: (...args) => session.startGame(...args),
  launch: (...args) => session.launch(...args),
  returnHome: (...args) => session.returnHome(...args),
  positionAllPawns: (...args) => board.positionAllPawns(...args),
  showRules: (...args) => dialogs.showRules(...args),
});
const connection = createConnection({
  setNetStatus: (...args) => lobby.setNetStatus(...args),
  showLobby: (...args) => lobby.showLobby(...args),
  applyLobbyProfile: (...args) => lobby.applyLobbyProfile(...args),
  broadcastLobby: (...args) => lobby.broadcastLobby(...args),
  publicLobby: (...args) => lobby.publicLobby(...args),
  leaveLobby: (...args) => lobby.leaveLobby(...args),
  dispatch: (...args) => session.dispatch(...args),
  afterChange: (...args) => session.afterChange(...args),
  onState: (...args) => game.onState(...args),
});
const session = createSession({
  shuffledBotNames: (...args) => lobby.shuffledBotNames(...args),
  setNetStatus: (...args) => lobby.setNetStatus(...args),
  onState: (...args) => game.onState(...args),
});
const board = createBoard({
  onTileClick: (...args) => actions.onTileClick(...args),
});
const animations = createAnimations({
  positionAllPawns: (...args) => board.positionAllPawns(...args),
  showChanceCard: (...args) => dialogs.showChanceCard(...args),
  showEnd: (...args) => dialogs.showEnd(...args),
});
const actions = createActions({
  act: (...args) => session.act(...args),
  showTileSheet: (...args) => dialogs.showTileSheet(...args),
  showEnd: (...args) => dialogs.showEnd(...args),
});
const dialogs = createDialogs({
  launch: (...args) => session.launch(...args),
  act: (...args) => session.act(...args),
});
const game = createGameView({
  showMoneyDelta: (...args) => animations.showMoneyDelta(...args),
  showTurnOverlay: (...args) => animations.showTurnOverlay(...args),
  processEvents: (...args) => animations.processEvents(...args),
  showGame: (...args) => board.showGame(...args),
  buildPawns: (...args) => board.buildPawns(...args),
  positionAllPawns: (...args) => board.positionAllPawns(...args),
  renderPlayers: (...args) => board.renderPlayers(...args),
  renderTiles: (...args) => board.renderTiles(...args),
  renderLog: (...args) => board.renderLog(...args),
  renderActions: (...args) => actions.renderActions(...args),
  showEnd: (...args) => dialogs.showEnd(...args),
});

lobby.initHome();
connection.startHeartbeat();
game.startDisplayClock();
window.TT_DEBUG = Object.assign(app, { dispatch: session.dispatch, afterChange: session.afterChange, E });
