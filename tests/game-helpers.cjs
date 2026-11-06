const E=require('../engine.js');
function rng(seed=42){return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);}
function started(opts={}) {
 const random=rng(); const s=E.createGame([{name:'A',isBot:true},{name:'B',isBot:true},{name:'C',isBot:true}],opts,random,1000);
 while(s.ordering) { const v=s.current/3; E.apply(s,s.current,{type:'orderRoll'},()=>v,1000); }
 return s;
}
module.exports={E,rng,started};
