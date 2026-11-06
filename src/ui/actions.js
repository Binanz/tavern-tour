import { E, $, fmt, app, LEVEL_LABELS, BOARD, RULES } from '../runtime.js';
import { toast, openModal, closeModal, esc, groupColor, typeLabel } from './helpers.js';

const JAIL_NAME = BOARD.find((tile) => tile.type === 'jail').name;
const SHADOW_GIFT_NAME = BOARD.find((tile) => tile.type === 'championship').name;
const PORTAL_NAME = BOARD.find((tile) => tile.type === 'worldtour').name;

export function createActions({ act, showTileSheet, showEnd }) {
  function offerCardHTML(i, extra) {
    const b = BOARD[i]; const t = app.state.tiles[i];
    let rentLine = '';
    if (b.type === 'property') rentLine = `Loyer actuel ${fmt(E.computeRent({ ...app.state, tiles: app.state.tiles.map((x, k) => (k === i ? { owner: t.owner === null ? app.myIdx : t.owner, houses: t.houses } : x)) }, i, 7))}${t.owner !== null ? ` · ${LEVEL_LABELS[t.houses]}` : ''}`;
    else rentLine = `Loyer ${fmt(RULES.stationRents[0])} → ${fmt(RULES.stationRents[3])} selon les serviteurs neutres possédés`;
    return `<div class="offer-card" style="--g:${groupColor(i)}"><div class="oc-band">${esc(b.name)}</div><div class="oc-body"><div class="oc-type">${typeLabel(i)}</div><div class="oc-price">${fmt(b.price)}</div><div class="oc-rent">${rentLine}</div>${extra || ''}</div></div>`;
  }

  function payNoteHTML(s, lp) {
    if (!lp) return '';
    const me = app.myIdx;
    const from = s.players[lp.from]; const to = typeof lp.to === 'number' ? s.players[lp.to] : null;
    const toName = to ? to.name : lp.to === 'split' ? 'les autres joueurs' : 'la banque';
    if (lp.from === me) return `<div class="pay-note">Vous payez ${fmt(lp.amount)} à ${esc(toName)}<small>${esc(lp.reason)}</small></div>`;
    if (to && lp.to === me) return `<div class="pay-note gain">${esc(from.name)} vous paie ${fmt(lp.amount)}<small>${esc(lp.reason)}</small></div>`;
    return `<div class="pay-note" style="color:var(--cream)">${esc(from.name)} paie ${fmt(lp.amount)} à ${esc(toName)}<small>${esc(lp.reason)}</small></div>`;
  }
  function levelButtons(opts, i, kind) {
    const b = BOARD[i];
    return `<div class="levels">${opts.map((o) => {
      const name = o.houses === 0 ? 'Achat' : LEVEL_LABELS[o.houses];
      const pips = o.houses === E.HOTEL ? '<i class="gold"></i>' : '<i></i>'.repeat(o.houses);
      const rentState = { ...app.state, tiles: app.state.tiles.map((tile, index) => index === i ? { owner: app.myIdx, houses: o.houses } : tile) };
      const rentNow = b.type === 'property' || b.type === 'station' ? E.computeRent(rentState, i, 7) : null;
      const hint = o.locked ? 'Après un passage par la Taverne' : !o.affordable ? 'Pas assez d’or' : rentNow !== null ? `Loyer ${fmt(rentNow)}${o.houses === E.HOTEL ? ' · imprenable' : ''}` : '';
      return `<button class="lvl${o.locked ? ' locked' : ''}" data-houses="${o.houses}" ${o.locked || !o.affordable ? 'disabled' : ''} title="${hint}"><span class="lv-name">${name}</span><span class="lv-houses">${pips}</span><span class="lv-cost">${fmt(o.cost)}</span><span class="lv-rent">${hint}</span></button>`;
    }).join('')}</div>`;
  }

  function renderActions(pending) {
    const s = app.state; const el = $('actions'); const banner = $('turnBanner');
    const me = app.myIdx; const p = s.players[s.current]; const t = s.turn;
    const meP = s.players[me];
    const myTurn = s.current === me && s.phase === 'playing';
    if (s.phase === 'ended') { banner.innerHTML = 'Partie terminée'; banner.classList.remove('mine'); el.innerHTML = `<div class="btn-row"><button class="btn primary" id="btnShowEnd">Voir le classement</button></div>`; $('btnShowEnd').onclick = showEnd; return; }
    if (s.ordering) {
      banner.innerHTML = `Définition de l’ordre · manche ${s.ordering.round}`;
      banner.classList.toggle('mine', myTurn);
      const results = s.players.map((player, i) => {
        const roll = s.ordering.rolls[i];
        const score = roll ? `${roll.dice[0]} + ${roll.dice[1]} <b>= ${roll.total}</b>` : 'À lancer';
        return `<div class="order-result${s.current === i ? ' rolling' : ''}"><span>${player.token} ${esc(player.name)}</span><span>${score}</span></div>`;
      }).join('');
      const prompt = pending
        ? `<div class="prompt muted">${esc(p.name)} lance les dés…</div>`
        : myTurn
          ? `<div class="prompt">Lancez les dés pour déterminer l’ordre de passage.<small>En cas d’égalité, les joueurs concernés relancent.</small></div><button class="btn primary big" data-act="orderRoll">🎲 Lancer les dés</button>`
          : `<div class="prompt muted">${esc(p.name)}${p.isBot ? ' (bot)' : ''} lance les dés…</div>`;
      el.innerHTML = `<div class="order-results">${results}</div>${prompt}`;
      el.querySelectorAll('[data-act]').forEach((button) => (button.onclick = () => { act({ type: button.dataset.act }); }));
      return;
    }
    if (s.auction) {
      const auction = s.auction;
      const tile = auction.tiles[auction.cursor];
      const bidder = s.players[auction.current];
      banner.innerHTML = `${myTurn ? 'Enchères : à vous, ' : 'Enchères : '}<b>${esc(bidder.name)}</b>`;
      banner.classList.toggle('mine', myTurn);
      if (!myTurn) {
        el.innerHTML = `<div class="offer-card" style="--g:${groupColor(tile)}"><div class="oc-band">${esc(BOARD[tile].name)}</div><div class="oc-body"><div class="oc-type">${BOARD[tile].type === 'property' ? LEVEL_LABELS[s.tiles[tile].houses] : typeLabel(tile)}</div><div class="oc-price">Investissement : ${fmt(E.tileValue(s, tile))}</div><div class="oc-rent">Enchère actuelle : ${auction.highestBid ? fmt(auction.highestBid) + ' · ' + esc(s.players[auction.highestBidder].name) : 'aucune'}</div></div></div>
          <div class="prompt muted">${esc(bidder.name)} propose une enchère ou passe…</div>`;
        return;
      }
      if (pending) { el.innerHTML = '<div class="prompt muted">…</div>'; return; }
      const minimum = auction.highestBidder === null ? RULES.auctionMinBid : auction.highestBid + RULES.auctionMinBid;
      const suggested = Math.min(meP.cash, minimum);
      el.innerHTML = `<div class="offer-card" style="--g:${groupColor(tile)}"><div class="oc-band">${esc(BOARD[tile].name)}</div><div class="oc-body"><div class="oc-type">${BOARD[tile].type === 'property' ? LEVEL_LABELS[s.tiles[tile].houses] : typeLabel(tile)}</div><div class="oc-price">Investissement total : ${fmt(E.tileValue(s, tile))}</div><div class="oc-rent">Enchère actuelle : ${auction.highestBid ? fmt(auction.highestBid) + ' · ' + esc(s.players[auction.highestBidder].name) : 'aucune'}</div></div></div>
        <div class="prompt">Vous pouvez enchérir pour cette case et ses niveaux ou passer.<small>Enchère minimale : ${fmt(minimum)}. Le meilleur enchérisseur paie son offre.</small></div>
        <div class="auction-actions"><label class="field"><span>Votre enchère</span><input id="auctionBidAmount" type="number" min="${minimum}" max="${meP.cash}" step="${RULES.auctionMinBid}" value="${suggested >= minimum ? suggested : minimum}" ${meP.cash < minimum ? 'disabled' : ''} /></label>
        <button class="btn primary" id="btnAuctionBid" ${meP.cash < minimum ? 'disabled' : ''}>Enchérir</button><button class="btn" data-act="auctionPass">Passer</button></div>`;
      const input = $('auctionBidAmount');
      const bidButton = $('btnAuctionBid');
      if (bidButton) bidButton.onclick = () => {
        const amount = input.valueAsNumber;
        if (!Number.isSafeInteger(amount) || amount > meP.cash) { toast('Entrez une enchère entière que vous pouvez payer.'); return; }
        act({ type: 'auctionBid', amount });
      };
      el.querySelectorAll('[data-act]').forEach((button) => (button.onclick = () => act({ type: button.dataset.act })));
      return;
    }
    banner.innerHTML = myTurn ? `À vous de jouer, <b>${esc(p.name)}</b>` : `Au tour de <b>${esc(p.name)}</b>${p.isBot ? ' (bot)' : ''}`;
    banner.classList.toggle('mine', myTurn);
    if (pending) { el.innerHTML = `<div class="prompt muted">…</div>`; return; }
    const lastPay = t.lastPay && (['done', 'buyout', 'debt'].includes(t.step) || (t.step === 'roll' && t.rolledThisTurn)) ? t.lastPay : null;
    if (!myTurn) {
      const what = { tavernChoice: 'choisit sa récompense de Taverne', rerollChoice: 'décide de relancer ses dés', diceChoice: 'choisit deux dés parmi trois', roll: 'lance les dés', jail: 'est naufragé sur l’Île perdue', buy: `hésite à acheter ${t.offer != null ? BOARD[t.offer].name : ''}`, build: 'envisage de construire', buyout: `peut racheter ${t.offer != null ? BOARD[t.offer].name : ''}`, teleport: 'choisit une destination', championship: 'organise les Championnats', debt: 'doit vendre pour payer sa dette', auction: 'participe aux enchères', done: 'termine son tour' }[t.step] || '';
      el.innerHTML = `${payNoteHTML(s, lastPay)}<div class="prompt muted">${esc(p.name)} ${what}…<small>Cliquez sur une case pour voir ses loyers.</small></div>`;
      return;
    }
    let html = '';
    switch (t.step) {
      case 'tavernChoice': {
        const choice = t.tavernChoice, full = meP.inventory.length >= window.TT_CONFIG.POWER_RULES.maxInventory;
        html = '<div class="prompt">Récompense de la Taverne<small>Choisissez votre salaire ou un pouvoir. Réserve : ' + meP.inventory.length + '/2. Les légendaires ne peuvent apparaître qu’une fois, même refusés.' + (choice.extra ? ' Arrivée exacte : supplément de ' + fmt(choice.extra) + ' or conservé avec un pouvoir.' : '') + '</small></div><button class="btn primary" data-reward="cash">Prendre ' + fmt(choice.salary) + ' or</button><div class="power-offers">' + choice.offers.map(id => {
          const power = window.TT_CONFIG.POWERS[id];
          return '<button class="btn power-card' + (power.rare ? ' legendary' : '') + '" data-reward="' + id + '" ' + (full ? 'disabled' : '') + '><strong>' + esc(power.name) + (power.rare ? ' · LÉGENDAIRE UNIQUE' : '') + '</strong><span>' + esc(power.description) + '</span></button>';
        }).join('') + '</div>';
        break;
      }
      case 'rerollChoice': {
        html = '<div class="prompt">Seconde chance : ' + t.pendingDice.join(' + ') + '<small>Gardez ce résultat ou relancez une seule fois.</small></div><div class="btn-row"><button class="btn primary" data-act="keepDice">Garder les dés</button><button class="btn" data-act="rerollDice">Relancer</button></div>';
        break;
      }
      case 'diceChoice': {
        html = '<div class="prompt">Choisissez deux dés parmi ' + t.rollChoices.join(' · ') + '.<small>Les deux dés gardés déterminent le déplacement et les doubles.</small></div><div class="btn-row">' + [[0,1],[0,2],[1,2]].map(pair => '<button class="btn primary" data-pair="' + pair.join(',') + '">' + pair.map(i => t.rollChoices[i]).join(' + ') + '</button>').join('') + '</div>';
        break;
      }
      case 'roll': {
        html = `<div class="prompt">${t.doubles > 0 ? 'Double ! Relancez les dés.' : 'Lancez les dés.'}<small>Votre tour dure 30 secondes. Cliquez sur une de vos propriétés pour vendre la case entière à 75 % de l’investissement.</small></div>
          <button class="btn primary big" data-act="roll">🎲 Lancer les dés</button>`;
        break;
      }
      case 'jail':
        html = `<div class="prompt">Vous êtes retenu à ${esc(JAIL_NAME)}.<small>Essai ${meP.jailTurns + 1}/${RULES.jailMaxTurns} : faites un double pour partir, ou payez ${fmt(RULES.jailFee)}.</small></div>
          <div class="btn-row"><button class="btn primary" data-act="jailRoll">🎲 Tenter un double</button><button class="btn" data-act="jailPay" ${meP.cash < RULES.jailFee ? 'disabled' : ''}>Payer ${fmt(RULES.jailFee)}</button>${meP.jailCards > 0 ? '<button class="btn" data-act="jailCard">Utiliser une carte de sortie</button>' : ''}</div>`;
        break;
      case 'buy': {
        const i = t.offer; const opts = E.buyOptions(s, me, i);
        html = `${offerCardHTML(i)}<div class="prompt" style="font-size:1em">Acheter ${esc(BOARD[i].name)}${BOARD[i].type === 'property' ? ' — choisissez le niveau' : ''} :</div>${levelButtons(opts, i, 'buy')}<div class="btn-row"><button class="btn" data-act="skipBuy">Passer</button></div>`;
        break;
      }
      case 'build': {
        const i = t.offer; const h = s.tiles[i].houses; const opts = E.buildOptions(s, me, i);
        html = `${offerCardHTML(i)}<div class="prompt" style="font-size:1em">Vous êtes chez vous (${LEVEL_LABELS[h]}) — améliorer ?</div>${levelButtons(opts, i, 'build')}<div class="btn-row"><button class="btn" data-act="skipBuild">Passer</button></div>`;
        break;
      }
      case 'buyout': {
        const i = t.offer; const owner = s.players[s.tiles[i].owner]; const price = t.buyoutPrice || E.buyoutPrice(s, i);
        html = `${payNoteHTML(s, lastPay)}${offerCardHTML(i)}<div class="prompt" style="font-size:1em">Racheter ${esc(BOARD[i].name)} à <b style="color:${owner.color}">${esc(owner.name)}</b> ?<small>125 % du prix d’achat initial (${fmt(E.tileValue(s, i))}). L’or lui est versé, les niveaux restent.</small></div>
          <div class="btn-row"><button class="btn primary" data-act="buyout" ${meP.cash < price ? 'disabled' : ''}>Racheter — ${fmt(price)}</button><button class="btn" data-act="skipBuyout">Passer</button></div>`;
        break;
      }
      case 'teleport':
        html = `<div class="prompt">Votre tour est consacré au ${esc(PORTAL_NAME)}. Choisissez une case libre ou à vous sur le plateau.<small>Coût ${fmt(RULES.worldTourFee)}. Vous avancez toujours vers l’avant : passer par la Taverne rapporte ${fmt(RULES.salary)}.</small></div><div class="btn-row"><button class="btn" data-act="skipTeleport">Passer ce voyage</button></div>`;
        break;
      case 'championship': {
        const next = Math.min(RULES.championshipMaxMult, s.championship ? s.championship.mult + 1 : 2);
        html = `<div class="prompt">Choisissez l’un de vos serviteurs pour y appliquer le ${esc(SHADOW_GIFT_NAME)} (case en surbrillance).<small>Coût ${fmt(RULES.championshipFee)} — le loyer y sera multiplié par ${next}.</small></div><div class="btn-row"><button class="btn" data-act="skipChampionship">Passer</button></div>`;
        break;
      }
      case 'debt': {
        const d = t.debt; const to = typeof d.to === 'number' ? s.players[d.to].name : d.to === 'split' ? 'aux autres joueurs' : 'à la banque';
        const canCover = meP.cash + E.liquidationValue(s, me) >= d.amount;
        html = `<div class="prompt">Vous devez <b>${fmt(d.amount)}</b> ${typeof d.to === 'number' ? 'à ' + esc(to) : to}.<small>Il vous manque ${fmt(d.amount - meP.cash)}. Cliquez sur vos propriétés en rouge pour vendre la case entière, niveaux de taverne inclus, à 75 % de l’investissement.</small></div>
          <div class="btn-row"><button class="btn danger" data-act="declareBankrupt" ${canCover ? 'disabled title="Vous pouvez encore vendre pour payer"' : ''}>Déclarer faillite</button></div>`;
        break;
      }
      case 'done':
        html = `${payNoteHTML(s, lastPay)}<div class="prompt muted">Tour terminé.<small>Le tour passe au joueur suivant…</small></div>`;
        break;
    }
    if (s.powers && t.step === 'roll') {
      html += '<div class="power-rack"><div class="prompt">Réserve de pouvoirs (' + meP.inventory.length + '/2)<small>Un pouvoir par tour, avant un lancer.' + (meP.insurance ? ' Protection loyer active.' : '') + (meP.buildDiscount ? ' Permis actif.' : '') + '</small></div>' + meP.inventory.map((id, index) => {
        const power = window.TT_CONFIG.POWERS[id], targeted = ['annihilation', 'goldenGift'].includes(id), targets = targeted ? E.powerTargets(s, me, id) : [];
        const disabled = t.powerUsed || (targeted && !targets.length) || (['shield','rentSkip'].includes(id) && meP.insurance) || (id === 'permit' && meP.buildDiscount) || (id === 'reroll' && meP.rerollReady);
        return '<div class="power-slot' + (power.rare ? ' legendary' : '') + '"><strong>' + esc(power.name) + '</strong><span>' + esc(power.description) + '</span>' + (targeted ? '<label>Propriété cible<select data-power-target="' + index + '">' + targets.map(i => '<option value="' + i + '">' + esc(BOARD[i].name) + ' · ' + esc(s.players[s.tiles[i].owner].name) + '</option>').join('') + '</select></label>' : '') + (id === 'step' ? [-1,1].map(delta => '<button class="btn small" data-power="' + index + '" data-delta="' + delta + '" ' + (disabled ? 'disabled' : '') + '>Déplacement ' + (delta > 0 ? '+' : '') + delta + '</button>').join('') : '<button class="btn small" data-power="' + index + '" ' + (disabled ? 'disabled' : '') + '>Utiliser</button>') + '</div>';
      }).join('') + '</div>';
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-reward]').forEach(b => { b.onclick = () => act({ type: 'chooseTavern', reward: b.dataset.reward }); });
    el.querySelectorAll('[data-power]').forEach(b => { b.onclick = () => {
      const index = Number(b.dataset.power), target = el.querySelector('[data-power-target="' + index + '"]');
      const action = { type: 'usePower', index };
      if (target) action.tile = Number(target.value);
      if (b.dataset.delta !== undefined) action.delta = Number(b.dataset.delta);
      act(action);
    }; });
    el.querySelectorAll('[data-pair]').forEach(b => { b.onclick = () => act({ type: 'chooseDice', indices: b.dataset.pair.split(',').map(Number) }); });
    el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => { act({ type: b.dataset.act }); }));
    el.querySelectorAll('.lvl[data-houses]').forEach((b) => (b.onclick = () => { act({ type: t.step === 'buy' ? 'buy' : 'build', houses: +b.dataset.houses }); }));
  }

  // Interactions plateau
  function onTileClick(i) {
    const s = app.state; if (!s || app.animating) return;
    const me = app.myIdx; const myTurn = s.current === me && s.phase === 'playing';
    const b = BOARD[i]; const t = s.tiles[i];
    showTileSheet(i);
    if (myTurn && app.selectMode === 'teleport' && E.teleportTargets(s, me).includes(i)) {
      const c = openModal(`<h2>Voyager vers ${esc(b.name)} ?</h2><p>Le Portail vous y dépose pour ${fmt(RULES.worldTourFee)}. ${t.owner === null ? 'La case est libre : vous pourrez l’acheter.' : 'C’est chez vous : vous pourrez y construire.'}</p><div class="btn-row"><button class="btn primary" id="okTp">Voyager</button><button class="btn" data-close>Annuler</button></div>`);
      c.querySelector('#okTp').onclick = () => { closeModal(); act({ type: 'teleport', tile: i }); };
      return;
    }
    if (myTurn && app.selectMode === 'championship' && E.championshipTargets(s, me).includes(i)) {
      const next = Math.min(RULES.championshipMaxMult, s.championship ? s.championship.mult + 1 : 2);
      const c = openModal(`<h2>${esc(SHADOW_GIFT_NAME)} sur ${esc(b.name)} ?</h2><p>Pour ${fmt(RULES.championshipFee)}, le loyer de ce serviteur sera multiplié par ${next} (loyer actuel ${fmt(E.computeRent(s, i, 7))} → ${fmt(E.computeRent({ ...s, championship: null }, i, 7) * next)}).</p><div class="btn-row"><button class="btn primary" id="okCh">Appliquer le Sombre Don</button><button class="btn" data-close>Annuler</button></div>`);
      c.querySelector('#okCh').onclick = () => { closeModal(); act({ type: 'championship', tile: i }); };
      return;
    }
  }


  return { renderActions, onTileClick };
}
