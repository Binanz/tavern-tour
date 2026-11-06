const test=require('node:test'),assert=require('node:assert/strict');
const {E,rng,started}=require('./game-helpers.cjs');
const CFG=require('../config.js');
function act(s,a,random=rng(),now=1000){const r=E.apply(s,s.current,a,random,now);assert.equal(r.ok,true,r.error);}
function cross(s,random=()=>.5,exact=false){s.turn={step:'roll',doubles:0,isDouble:false};s.players[s.current].pos=exact?30:31;act(s,{type:'roll'},exact?()=>0:random);assert.equal(s.turn.step,'tavernChoice');}
function own(s,i,owner,houses=1){s.tiles[i]={owner,houses};}

test('powers are optional, salary is replaced, and exact Start keeps its extra salary',()=>{
 assert.equal(started().powers,null);
 const s=started({powers:true}),p=s.players[s.current],cash=p.cash;
 cross(s);assert.equal(p.cash,cash);assert.equal(p.laps,1);
 act(s,{type:'chooseTavern',reward:'cash'});assert.equal(p.cash,cash+200000);
 const t=started({powers:true}),q=t.players[t.current],before=q.cash;
 cross(t,()=>.5,true);assert.equal(t.turn.tavernChoice.salary,400000);
 const id=t.turn.tavernChoice.offers[0];act(t,{type:'chooseTavern',reward:id});
 assert.equal(q.cash,before+200000);assert.deepEqual(q.inventory,[id]);
});
test('rare powers are offered once globally, even declined; invalid/full choices are rejected',()=>{
 const s=started({powers:true}),seen=[];
 for(let i=0;i<8;i++){
  cross(s,()=>0);const rares=s.turn.tavernChoice.offers.filter(id=>CFG.POWERS[id].rare);
  for(const id of rares){assert.ok(!seen.includes(id));seen.push(id);}
  act(s,{type:'chooseTavern',reward:'cash'});
 }
 assert.equal(seen.length,3);assert.equal(s.powers.rareSeen.length,3);
 cross(s);assert.equal(E.apply(s,s.current,{type:'chooseTavern',reward:'fake'},rng(),1000).ok,false);
 s.players[s.current].inventory=['shield','step'];
 assert.equal(E.apply(s,s.current,{type:'chooseTavern',reward:s.turn.tavernChoice.offers[0]},rng(),1000).ok,false);
 assert.equal(s.turn.step,'tavernChoice');
});
test('reward timeout takes cash and resumes landing, including a rent debt',()=>{
 const s=started({powers:true}),p=s.players[s.current],opponent=(s.current+1)%3;
 p.cash=0;own(s,5,opponent);s.turn.step='roll';p.pos=31;
 act(s,{type:'roll'},()=>.5);assert.equal(p.pos,7); // Landing is deferred until the reward choice.
 assert.equal(s.turn.step,'tavernChoice');
 E.tick(s,s.turnEndsAt,()=>.5);assert.notEqual(s.turn.step,'tavernChoice');assert.equal(p.cash>=0,true);
 const debt=started({powers:true}),d=debt.players[debt.current],other=(debt.current+1)%3;
 own(debt,2,other,E.HOTEL);d.cash=0;d.pos=31;debt.turn.step='roll';let n=0;
 act(debt,{type:'roll'},()=>[0,.2][n++]); // 1+2 -> property 2
 assert.equal(d.pos,2);assert.equal(debt.turn.step,'tavernChoice');
 E.tick(debt,debt.turnEndsAt,()=>.5);assert.equal(debt.turn.step,'debt');assert.ok(debt.turn.debt.amount>d.cash);
});
test('shield and legendary insurance compensate owner while consuming protection once',()=>{
 for(const [id,cap] of [['shield',200000],['rentSkip',Number.MAX_SAFE_INTEGER]]){
  const s=started({powers:true}),p=s.players[s.current],other=(s.current+1)%3;
  p.inventory=[id];act(s,{type:'usePower',index:0});own(s,3,other,3);p.pos=0;
  const rent=E.computeRent(s,3,3),cash=p.cash,ownerCash=s.players[other].cash;let n=0;
  act(s,{type:'roll'},()=>[0,.2][n++]);
  assert.equal(s.players[other].cash-ownerCash,rent);assert.equal(cash-p.cash,Math.max(0,rent-cap));
  assert.equal(p.insurance,0);assert.equal(p.inventory.length,0);
 }
});
test('step changes movement, not doubles; reroll works alone and with destiny',()=>{
 const s=started({powers:true}),p=s.players[s.current];p.inventory=['step','shield'];
 act(s,{type:'usePower',index:0,delta:1});assert.equal(E.apply(s,s.current,{type:'usePower',index:0},rng(),1000).ok,false);
 act(s,{type:'roll'},()=>0);assert.equal(p.pos,3);assert.equal(s.turn.doubles,1);assert.equal(p.movementAdjust,0);
 for(const anomaly of ['none','destiny']){
  const t=started({powers:true,anomaly}),q=t.players[t.current];q.inventory=['reroll'];
  act(t,{type:'usePower',index:0});act(t,{type:'roll'},()=>0);
  if(anomaly==='destiny')act(t,{type:'chooseDice',indices:[0,1]});
  assert.equal(t.turn.step,'rerollChoice');act(t,{type:'rerollDice'},()=>.5);
  if(anomaly==='destiny')act(t,{type:'chooseDice',indices:[0,1]});
  assert.deepEqual(t.turn.dice,[4,4]);assert.equal(q.rerollReady,false);assert.equal(t.turn.doubles,1);
 }
});
test('permits discount a real improvement, and legendary targeting cannot destroy neutral minions',()=>{
 const s=started({powers:true}),p=s.players[s.current],other=(s.current+1)%3;
 p.inventory=['permit'];own(s,1,s.current);act(s,{type:'usePower',index:0});s.turn.step='build';s.turn.offer=1;
 const cost=E.buildOptions(s,s.current,1).find(o=>o.houses===2).cost,before=p.cash;
 act(s,{type:'build',houses:2});assert.equal(before-p.cash,cost);assert.equal(p.buildDiscount,0);
 s.turn={step:'roll'};p.inventory=['annihilation'];own(s,3,other,E.HOTEL);own(s,4,other,0);s.championship={tile:3,mult:2};
 assert.equal(E.apply(s,s.current,{type:'usePower',index:0,tile:4},rng(),1000).ok,false);
 act(s,{type:'usePower',index:0,tile:3});assert.deepEqual(s.tiles[3],{owner:null,houses:0});assert.equal(s.championship,null);
 s.turn={step:'roll'};p.inventory=['goldenGift'];
 assert.equal(E.apply(s,s.current,{type:'usePower',index:0,tile:4},rng(),1000).ok,false);
 act(s,{type:'usePower',index:0,tile:1});assert.equal(s.tiles[1].houses,E.HOTEL);
});
test('bonus games and combined anomaly games finish with finite cash and unique rare offers',()=>{
 for(const anomaly of ['none','festival','cursed','destiny'])for(let seed=1;seed<=25;seed++){
  const s=started({powers:true,anomaly,durationMin:10}),random=rng(seed);let now=1000;
  for(let n=0;n<4000&&s.phase==='playing';n++){
   now+=1000;if(E.tick(s,now,random))continue;
   const action=E.botAction(s,s.current);assert.ok(action,anomaly+' '+s.turn.step);act(s,action,random,now);
   assert.ok(s.players.every(p=>Number.isFinite(p.cash)&&p.cash>=0&&p.inventory.length<=2));
   assert.equal(new Set(s.powers.rareSeen).size,s.powers.rareSeen.length);
  }
  assert.equal(s.phase,'ended',anomaly+' '+seed);
 }
});
test('local bonus selection is forwarded and displayed independently of anomalies',async()=>{
 const {createHarness}=require('./harness.cjs'),h=createHarness(),app=await h.start();
 h.get('powersEnabled').checked=true;h.get('localBots').value='1';h.get('durationSelect').value='10';h.get('btnLocal').onclick();
 assert.ok(app.state.powers);assert.equal(app.state.anomaly,null);assert.match(h.get('modeNote').textContent,/Bonus Taverne/);
});

test('legendary probability boundary is configurable and each new game resets the stock',()=>{
 for(const [chance,expected] of [[.049,true],[.05,false]]){
  const s=started({powers:true});let n=0;const values=[.5,.5,.1,chance,0];
  cross(s,()=>values[n++]??.5);
  assert.equal(s.turn.tavernChoice.offers.some(id=>CFG.POWERS[id].rare),expected);
 }
 assert.deepEqual(started({powers:true}).powers.rareSeen,[]);
});
test('one forward reward per turn survives a snapshot; backward Chance movement gives none',()=>{
 const s=started({powers:true}),p=s.players[s.current];
 cross(s);const clone=JSON.parse(JSON.stringify(s));
 for(const state of [s,clone])act(state,{type:'chooseTavern',reward:'cash'},()=>.5);
 assert.deepEqual(s,clone);
 p.pos=31;s.turn.step='roll';const laps=p.laps;
 act(s,{type:'roll'},()=>0);assert.notEqual(s.turn.step,'tavernChoice');assert.equal(p.laps,laps+1);
 const back=started({powers:true}),q=back.players[back.current];
 q.pos=10;back.deck=[CFG.CARDS.findIndex(c=>c.kind==='moveBack')];back.deckPos=0;
 act(back,{type:'roll'},()=>0);assert.equal(q.pos,9);assert.equal(q.laps,0);assert.equal(back.turn.tavernChoice,undefined);
});

test('host mode options and a pending power choice survive lobby and game synchronization',async()=>{
 const {createHarness}=require('./harness.cjs'),host=createHarness(),guest=createHarness();
 const hostApp=await host.start(),guestApp=await guest.start();
 const players=[{name:'Host',token:'🐺',peerId:'host'},{name:'Guest',token:'🐟',peerId:'guest'}];
 hostApp.lobby={code:'ABCDE',players,anomaly:'destiny',powers:true,durationMin:10,fillBots:false,started:false};
 const hostLobby=host.load('src/lobby.js').namespace.createLobby({});
 const wireLobby=JSON.parse(JSON.stringify(hostLobby.publicLobby()));
 assert.equal(wireLobby.anomaly,'destiny');assert.equal(wireLobby.powers,true);
 guestApp.mode='client';guestApp.net={peer:{id:'guest'}};
 const guestLobby=guest.load('src/lobby.js').namespace.createLobby({});
 const session=guest.load('src/session.js').namespace.createSession({onState(){},setNetStatus(){},shuffledBotNames(){}});
 const connection=guest.load('src/connection.js').namespace.createConnection({setNetStatus(){},showLobby:guestLobby.showLobby,receiveState:session.receiveState});
 connection.clientOnMessage({type:'lobby',lobby:wireLobby,yourIdx:1});
 assert.equal(guest.get('powersEnabled').checked,true);assert.equal(guest.get('powersEnabled').disabled,true);
 assert.equal(guest.get('anomalySelect').value,'destiny');assert.equal(guest.get('anomalySelect').disabled,true);
 const state=started({powers:true});state.players[1].peerId='guest';cross(state,()=>0);
 const snapshot=JSON.parse(JSON.stringify(state));connection.clientOnMessage({type:'state',state:snapshot,yourIdx:1});
 assert.deepEqual(guestApp.state.powers.rareSeen,state.powers.rareSeen);
 assert.deepEqual(guestApp.state.turn.tavernChoice,state.turn.tavernChoice);
 assert.equal(guestApp.myIdx,1);
});
