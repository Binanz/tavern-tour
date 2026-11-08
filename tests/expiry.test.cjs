const test=require('node:test'),assert=require('node:assert/strict');
const {E,started}=require('./game-helpers.cjs');
const CFG=require('../config.js');
// rng donnant des dés précis : valeur v dans [0,1) -> 1+floor(v*6)
const dice=(a,b)=>{const q=[(a-1+.5)/6,(b-1+.5)/6];let i=0;return()=>q[i++%2];};
test('temps écoulé : les dés sont lancés, la case libre n’est pas achetable et le tour passe',()=>{
 const s=started(),p=s.current;
 const r=E.tick(s,s.turnEndsAt,dice(1,2)); // 3 cases : propriété libre
 assert.equal(r,true);
 assert.equal(s.players[p].pos,3);
 assert.equal(s.tiles[3].owner,null);
 assert.notEqual(s.current,p);
 assert.ok(s.log.some(l=>/dés sont lancés automatiquement/.test(l.t)));
});
test('temps écoulé sur un double : pas de relance, le joueur suivant joue à sa place',()=>{
 const s=started(),p=s.current;
 E.tick(s,s.turnEndsAt,dice(1,1));
 assert.equal(s.players[p].pos,2);
 assert.notEqual(s.current,p);
});
test('temps écoulé : le loyer reste dû mais ni rachat ni construction',()=>{
 const s=started(),p=s.current,o=(p+1)%3;
 s.tiles[3].owner=o;s.tiles[3].houses=1;
 const cash=s.players[p].cash;
 E.tick(s,s.turnEndsAt,dice(1,2));
 assert.ok(s.players[p].cash<cash);
 assert.equal(s.tiles[3].owner,o);
 assert.notEqual(s.current,p);
 const s2=started(),q=s2.current;
 s2.tiles[3].owner=q;s2.tiles[3].houses=1;
 E.tick(s2,s2.turnEndsAt,dice(1,2));
 assert.equal(s2.tiles[3].houses,1);
 assert.notEqual(s2.current,q);
});
test('sans expiration, un double permet toujours de rejouer et l’achat reste proposé',()=>{
 const s=started(),p=s.current;
 E.apply(s,p,{type:'roll'},dice(1,2),1000);
 assert.equal(s.turn.step,'buy');
 const s2=started();E.apply(s2,s2.current,{type:'roll'},dice(1,1),1000);
 assert.equal(s2.turn.step,'buy');
});
