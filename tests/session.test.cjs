const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./harness.cjs');
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('rendering accepts a frozen game snapshot without inventing a deadline', async () => {
  const h = createHarness(), app = await h.start();
  app.state = app.E.createGame([{ name: 'A' }, { name: 'B' }], {});
  app.state.ordering = null;
  freeze(app.state);
  const before = JSON.stringify(app.state);
  const { createGameView } = h.load('src/ui/game.js').namespace;
  const names = ['showMoneyDelta', 'showTurnOverlay', 'showGame', 'buildPawns', 'positionAllPawns', 'renderPlayers', 'renderTiles', 'renderLog', 'renderActions', 'showEnd'];
  const deps = Object.fromEntries(names.map(name => [name, () => {}]));
  const view = createGameView({ ...deps, processEvents: () => 0 });
  view.onState();
  h.flush();
  assert.equal(app.state.turnEndsAt, null);
  assert.equal(JSON.stringify(app.state), before);
});

test('guest session accepts snapshots and cannot execute host transitions', async () => {
  const h = createHarness(), app = await h.start();
  const { createSession } = h.load('src/session.js').namespace;
  let renders = 0;
  const session = createSession({ shuffledBotNames() {}, setNetStatus() {}, onState() { renders++; } });
  app.mode = 'client'; app.net = { peer: { id: 'guest' } };
  const state = app.E.createGame([{ name: 'A' }, { name: 'B', peerId: 'guest' }], {});
  freeze(state);
  session.receiveState(state, 0);
  assert.equal(app.state, state);
  assert.equal(app.myIdx, 1);
  const saved = JSON.stringify(state);
  assert.equal(session.dispatch(0, { type: 'orderRoll' }).ok, false);
  assert.equal(session.changeController(1, { type: 'disconnect' }).ok, false);
  session.afterChange();
  assert.equal(renders, 1);
  assert.equal(JSON.stringify(state), saved);
});
