

const CFG = window.TT_CONFIG;
const E = window.TT_ENGINE;
const { Net, makeCode } = window.TT_NET;
const { BOARD, GROUPS, RULES, TOKENS, BOT_NAMES } = CFG;
const N = BOARD.length;
const $ = (id) => document.getElementById(id);
const fmt = E.fmt;
const STEP_MS = 170;

const app = {
  mode: null, net: null,
  me: { name: '', token: TOKENS[0] },
  myIdx: 0,
  lobby: null,
  state: null,
  botTimer: null, tickTimer: null, actionTimer: null,
  sync: { remainingMs: RULES.defaultDurationMin * 60000, at: Date.now() },
  muted: false,
  displayedPos: [], pawnQueue: [], pawnBusy: [],
  selectMode: null,
  boardBuilt: false,
  gameShown: false,
  lastLogLen: 0,
  lastSeen: {}, lastHostSeen: null,
  prevCash: null, prevCurrent: -1, prevTurnCount: 0, autoEndTimer: null,
  hostLostTimer: null, hostLostShown: false,
  clientPeerId: null,
  pendingClaims: Object.create(null),
  animating: false,
};
const LEVEL_LABELS = ['Sans taverne', 'Taverne 1', 'Taverne 2', 'Taverne 3', 'Taverne 4', 'Serviteur doré'];

export { E, N, $, fmt, STEP_MS, app, LEVEL_LABELS, Net, makeCode, BOARD, GROUPS, RULES, TOKENS, BOT_NAMES };
