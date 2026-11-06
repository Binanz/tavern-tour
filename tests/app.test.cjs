const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./harness.cjs');

test('module composition starts the home screen and a complete local game', async () => {
  const h = createHarness();
  const app = await h.start();
  assert.equal(h.get('tokenPicker').children.length, h.context.TT_CONFIG.TOKENS.length);
  assert.equal(h.intervals.size, 2, 'only heartbeat and display clock start at boot');
  assert.equal(typeof h.get('btnHost').onclick, 'function');
  assert.equal(typeof h.get('btnJoin').onclick, 'function');
  h.get('btnRules').onclick();
  assert.match(h.get('modalCard').innerHTML, /Victoires immédiates/);
  h.get('nameInput').value = 'Test';
  h.get('localBots').value = '3';
  h.get('durationSelect').value = '10';
  h.get('btnLocal').onclick();
  assert.equal(app.state.players.length, 4);
  assert.equal(h.get('screen-home').hidden, true);
  assert.equal(h.get('screen-game').hidden, false);
  assert.equal(h.get('board').querySelectorAll('.tile').length, h.context.TT_CONFIG.BOARD.length);
  // Finish ordering with distinct, controlled dice, then play via the real session.
  while (app.state.ordering) {
    const value = app.state.current / 4;
    h.context.Math.random = () => value;
    app.dispatch(app.state.current, { type: 'orderRoll' });
  }
  let seed = 42;
  h.context.Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 2000 && app.state.phase === 'playing'; i++) {
    const action = app.E.botAction(app.state, app.state.current);
    assert.ok(action);
    app.dispatch(app.state.current, action);
    h.flush();
  }
  assert.equal(app.state.phase, 'ended');
  h.flush();
  assert.match(h.get('modalCard').innerHTML, /remporte la taverne/);
  h.get('brandHome').onclick();
  assert.equal(app.state, null);
  assert.equal(h.get('screen-home').hidden, false);
  assert.equal(h.get('screen-game').hidden, true);
});
