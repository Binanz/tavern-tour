const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

function game() {
  return E.createGame([{ name: 'Host', peerId: 'host' }, { name: 'Guest', peerId: 'guest' }, { name: 'Bot', isBot: true }], {}, () => 0.5, 1000);
}

test('controller transitions keep identity, money and deadlines while replacing transient events', () => {
  const state = game();
  state.events = [{ type: 'dice', player: 1, dice: [2, 3] }];
  const before = JSON.stringify({ cash: state.players[1].cash, pos: state.players[1].pos, deadline: state.turnEndsAt });
  assert.equal(E.changeController(state, 1, { type: 'disconnect' }).ok, true);
  assert.equal(state.players[1].isBot, true);
  assert.equal(state.players[1].connected, false);
  assert.equal(state.players[1].peerId, 'guest');
  assert.equal(state.events.length, 0);
  const logs = state.log.length;
  assert.equal(E.changeController(state, 1, { type: 'disconnect' }).changed, false);
  assert.equal(state.log.length, logs);
  state.events = [{ type: 'buy', tile: 1 }];
  assert.equal(E.changeController(state, 1, { type: 'reconnect', peerId: 'guest' }).ok, true);
  assert.equal(state.players[1].isBot, false);
  assert.equal(state.players[1].connected, true);
  assert.equal(state.events.length, 0, 'reconnection must not replay previous animations');
  assert.equal(JSON.stringify({ cash: state.players[1].cash, pos: state.players[1].pos, deadline: state.turnEndsAt }), before);
});

test('only available bots can be claimed and failed transitions preserve state', () => {
  for (const [idx, command] of [[-1, { type: 'claim', peerId: 'new' }], [0, { type: 'claim', peerId: 'new' }], [1, { type: 'reconnect', peerId: 'stranger' }], [2, { type: 'claim', peerId: 'guest' }], [2, { type: 'claim', peerId: '' }]]) {
    const state = game(), before = JSON.stringify(state);
    assert.equal(E.changeController(state, idx, command).ok, false);
    assert.equal(JSON.stringify(state), before);
  }
  for (const setup of [s => { s.phase = 'ended'; }, s => { s.players[2].bankrupt = true; }]) {
    const state = game(); setup(state);
    const before = JSON.stringify(state);
    assert.equal(E.changeController(state, 2, { type: 'claim', peerId: 'new' }).ok, false);
    assert.equal(JSON.stringify(state), before);
  }
  const state = game();
  assert.equal(E.changeController(state, 2, { type: 'claim', peerId: 'new' }).ok, true);
  assert.equal(state.players[2].peerId, 'new');
  assert.equal(state.players[2].isBot, false);
  assert.equal(E.changeController(state, 2, { type: 'claim', peerId: 'other' }).ok, false);
});

test('clock reads are pure and rejected malformed actions do not erase events', () => {
  const state = game();
  const before = JSON.stringify(state);
  assert.deepEqual(E.readClock(state, 5000), { remainingMs: state.durationMs, turnRemainingMs: 30000, at: 5000 });
  assert.equal(JSON.stringify(state), before);
  state.ordering = null; state.endsAt = 10000; state.turnEndsAt = 6000;
  assert.deepEqual(E.readClock(state, 5000), { remainingMs: 5000, turnRemainingMs: 1000, at: 5000 });
  E.refreshClock(state, 5000);
  assert.equal(state.remainingMs, 5000);
  assert.equal(state.turnEndsAt, 6000);
  state.events = [{ type: 'dice' }];
  for (const action of [null, undefined, [], {}, 'roll']) {
    const saved = JSON.stringify(state);
    assert.equal(E.apply(state, 0, action).ok, false);
    assert.equal(JSON.stringify(state), saved);
  }
  assert.equal(E.apply(state, -1, { type: 'roll' }).ok, false);
  assert.equal(E.apply(state, 0, { type: 'changeController', peerId: 'bad' }, Math.random, 5000).ok, false);
  assert.equal(state.players[1].peerId, 'guest');
});
