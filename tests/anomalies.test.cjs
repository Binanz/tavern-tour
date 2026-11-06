const test=require('node:test'),assert=require('node:assert/strict');
const {E,rng,started}=require('./game-helpers.cjs');
const CFG=require('../config.js');
test('anomalies are opt-in, seeded and serializable',()=>{
 assert.equal(started().anomaly,null);
 for(const anomaly of ['festival','cursed','destiny','random']) {
  const a=started({anomaly}),b=started({anomaly});
  assert.deepEqual(a,b);
  assert.ok(CFG.ANOMALIES[a.anomaly.id]);
  assert.deepEqual(JSON.parse(JSON.stringify(a)),a);
 }
});
test('cursed land discounts base price, doubles rent and preserves consistent resale/buyout value',()=>{
 const s=started({anomaly:'cursed'}),i=s.anomaly.cursedTiles[0],p=s.current;
 assert.equal(new Set(s.anomaly.cursedTiles).size,3);
 assert.ok(s.anomaly.cursedTiles.every(i=>CFG.BOARD[i].type==='property'));
 const base=CFG.BOARD[i].price*.75;
 assert.equal(E.buyOptions(s,p,i)[0].cost,base+E.houseCost(i));
 s.turn.step='buy';s.turn.offer=i;
 assert.equal(E.apply(s,p,{type:'buy',houses:1},rng(),1000).ok,true);
 assert.equal(E.tileValue(s,i),base+E.houseCost(i));
 assert.equal(E.computeRent(s,i,7),CFG.BOARD[i].rents[1]*2*(s.festivalTiles.includes(i)?2:1));
 assert.equal(E.sellValue(s,i),Math.floor(E.tileValue(s,i)*.75));
});
test('festival moves only when play wraps around and survives snapshot round-trip',()=>{
 const s=started({anomaly:'festival'}),randomState=s.anomaly.randomState;
 s.turn.step='done';E.apply(s,s.current,{type:'endTurn'},rng(),1000);
 assert.equal(s.anomaly.randomState,randomState);
 while(s.turnOrder.indexOf(s.current)!==s.turnOrder.length-1){s.turn.step='done';E.apply(s,s.current,{type:'endTurn'},rng(),1000);}
 const clone=JSON.parse(JSON.stringify(s));
 for(const state of [s,clone]){state.turn.step='done';E.apply(state,state.current,{type:'endTurn'},rng(),1000);}
 assert.deepEqual(s,clone);assert.notEqual(s.anomaly.randomState,randomState);
 assert.equal(new Set(s.festivalTiles.map(i=>CFG.BOARD[i].group||'station')).size,3);
});
test('destiny validates chosen indices and counts only kept dice for doubles, including timeout',()=>{
 const s=started({anomaly:'destiny'});let n=0;
 E.apply(s,s.current,{type:'roll'},()=>[0,.99,0][n++],1000);
 assert.deepEqual(s.turn.rollChoices,[1,6,1]);assert.equal(s.turn.step,'diceChoice');
 for(const indices of [[0,0],[-1,2],[0,3],[0],['0',2]])assert.equal(E.apply(s,s.current,{type:'chooseDice',indices},rng(),1000).ok,false);
 E.apply(s,s.current,{type:'chooseDice',indices:[0,2]},rng(),1000);
 assert.equal(s.turn.doubles,1);assert.deepEqual(s.turn.dice,[1,1]);
 const timed=started({anomaly:'destiny'});E.apply(timed,timed.current,{type:'roll'},()=>.5,1000);
 assert.equal(E.tick(timed,timed.turnEndsAt),true);assert.notEqual(timed.turn.step,'diceChoice');assert.equal(timed.turn.rolledThisTurn,true);
});
test('complete bot games terminate across all anomaly choices',()=>{
 for(const anomaly of ['none','festival','cursed','destiny'])for(let seed=1;seed<=20;seed++){
  const s=started({anomaly,durationMin:10}),random=rng(seed);let now=1000;
  for(let n=0;n<3000&&s.phase==='playing';n++){
   now+=2000;if(E.tick(s,now))continue;
   const a=E.botAction(s,s.current);assert.ok(a,anomaly+' '+s.turn.step);
   assert.equal(E.apply(s,s.current,a,random,now).ok,true);
   assert.ok(s.players.every(p=>Number.isFinite(p.cash)&&p.cash>=0));
  }
  assert.equal(s.phase,'ended',anomaly);
 }
});

test('local launch forwards selected anomaly and shows its rule', async () => {
 const {createHarness}=require('./harness.cjs');const h=createHarness(),app=await h.start();
 h.get('anomalySelect').value='destiny';h.get('localBots').value='1';h.get('durationSelect').value='10';h.get('btnLocal').onclick();
 assert.equal(app.state.anomaly.id,'destiny');assert.match(h.get('modeNote').textContent,/Dé du destin/);
});
