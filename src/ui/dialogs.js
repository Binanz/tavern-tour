import { E, $, fmt, app, LEVEL_LABELS, BOARD, GROUPS, RULES } from '../runtime.js';
import { SFX } from '../audio.js';
import { openModal, closeModal, esc, groupColor } from './helpers.js';

export function createDialogs({ launch, act }) {
  function showTileSheet(i) {
    const s = app.state; const b = BOARD[i]; const t = s.tiles[i]; const me = app.myIdx;
    const myTurn = s.current === me && s.phase === 'playing';
    let html = `<div class="prop-sheet"><div class="ps-head" style="--g:${groupColor(i)}">${esc(b.name || 'Case sans type')}</div>`;
    if (b.type === 'property') {
      const owner = t.owner !== null ? s.players[t.owner] : null;
      html += `<p>${GROUPS[b.group].label} · Prix ${fmt(b.price)} · Niveau de taverne ${fmt(GROUPS[b.group].houseCost)} · Serviteur doré ${fmt(GROUPS[b.group].houseCost * RULES.hotelCostMult)}<br>${owner ? `Propriétaire : <b style="color:${owner.color}">${esc(owner.name)}</b>` : 'Libre'}${s.championship && s.championship.tile === i ? ` · 🏆 Championnats x${s.championship.mult}` : ''}${s.festivalTiles && s.festivalTiles.includes(i) ? ' · 🎪 Festival x2' : ''}</p>`;
      html += '<table>' + b.rents.map((r, k) => {
        if (k === 0) return '';
        const assumedOwner = t.owner === null ? me : t.owner;
        const rentState = { ...s, tiles: s.tiles.map((tile, index) => index === i ? { owner: assumedOwner, houses: k } : tile) };
        return `<tr class="${owner && t.houses === k ? 'now' : ''}"><td>${LEVEL_LABELS[k]} <small class="muted">(+${fmt(E.levelCost(i, 0, k))})</small></td><td>${fmt(E.computeRent(rentState, i, 7))}</td></tr>`;
      }).join('') + '</table>';
      if (owner && t.owner !== me) html += `<p>${t.houses === E.HOTEL ? 'Serviteur doré : cette case ne peut pas être rachetée.' : `Rachat possible en y tombant : <b>${fmt(E.buyoutPrice(s, i))}</b> (125 % du prix d’achat initial de ${esc(owner.name)}).`}</p>`;
    } else if (b.type === 'station') {
      const owner = t.owner !== null ? s.players[t.owner] : null;
      html += `<p>Serviteur neutre · Prix ${fmt(b.price)}${s.festivalTiles && s.festivalTiles.includes(i) ? ' · 🎪 Festival x2' : ''}<br>${owner ? `Propriétaire : <b style="color:${owner.color}">${esc(owner.name)}</b>` : 'Libre'}${owner && t.owner !== me ? '<br>Cette case ne peut pas être rachetée.' : ''}</p><table>${RULES.stationRents.map((r, k) => {
        const assumedOwner = t.owner === null ? me : t.owner;
        const rentState = { ...s, tiles: s.tiles.map((tile, index) => index === i ? { owner: assumedOwner, houses: 0 } : tile) };
        return `<tr class="${owner && E.countOwned(s, t.owner, 'station') === k + 1 ? 'now' : ''}"><td>${k + 1} serviteur${k ? 's' : ''} neutre${k ? 's' : ''}</td><td>${fmt(rentState.festivalTiles && rentState.festivalTiles.includes(i) ? r * 2 : r)}</td></tr>`;
      }).join('')}</table>`;
    } else {
      const desc = {
        blank: 'Cette case sans type n’a aucun effet.',
        start: `Recevez ${fmt(RULES.salary)} à chaque passage.`,
        jail: `Naufragé ! Payez ${fmt(RULES.jailFee)} ou faites un double pour repartir (3 essais max). On y arrive en tombant dessus, par une carte Chance ou après 3 doubles.`,
        championship: `Pour ${fmt(RULES.championshipFee)}, organisez les Championnats sur une de vos cases : son loyer est multiplié (x2, puis x3… jusqu’à x${RULES.championshipMaxMult}). Un seul lieu à la fois sur le plateau.`,
        worldtour: `Quand vous tombez sur le Tour du monde, le Portail s’active au début de votre prochain tour et remplace votre lancer de dés. Pour ${fmt(RULES.worldTourFee)}, voyagez vers l’avant jusqu’à une case libre ou à vous. Passer par la Taverne rapporte ${fmt(RULES.salary)}.`,
        tax: `Payez ${fmt(b.amount)} à la banque.`,
        chance: 'Tirez une carte Chance : bonne ou mauvaise surprise.',
      }[b.type];
      html += `<p>${desc}</p>`;
    }
    html += '</div>';
    if (t && t.owner === me && myTurn && ['roll', 'debt', 'jail', 'buy', 'build', 'buyout'].includes(s.turn.step)) {
      const v = E.sellValue(s, i);
      const levels = b.type === 'property' && t.houses > 0 ? ` et ${t.houses === E.HOTEL ? 'son Serviteur doré' : `sa Taverne ${t.houses}`}` : '';
      html += `<p class="muted">Vente de la case entière${levels} : 75 % de l’investissement total.</p><div class="btn-row" style="margin-top:14px"><button class="btn danger" id="sellBtn">Vendre toute la propriété — +${fmt(v)}</button></div>`;
    }
    const c = openModal(html);
    const sb = c.querySelector('#sellBtn');
    if (sb) sb.onclick = () => { closeModal(); act({ type: 'sell', tile: i }); };
  }

  function showChanceCard(text) {
    SFX.card();
    openModal(`<div class="chance-card"><div class="big">?</div><h2>Carte Chance</h2><p>${esc(text)}</p><div class="btn-row"><button class="btn primary" data-close>OK</button></div></div>`);
    clearTimeout(openModal._auto);
    openModal._auto = setTimeout(() => { if (!$('modal').hidden && $('modalCard').querySelector('.chance-card')) closeModal(); }, 2500);
  }

  function showEnd() {
    const s = app.state; if (!s || !s.ranking) return;
    $('brandHome').disabled = false;
    document.querySelector('.topbar').classList.add('game-ended');
    const isHost = app.mode !== 'client';
    const reason = s.endReason === 'time' ? 'Le chrono a sonné !' : s.endReason === 'victory' ? `Victoire spéciale : ${esc(s.winReason)}.` : 'Tous les adversaires ont fait faillite !';
    const list = s.ranking.map((r, k) => `<li><span class="rk">${k + 1}</span><span class="tk">${r.token}</span><span class="nm">${esc(r.name)}${r.bankrupt ? '<small>Faillite</small>' : `<small>${r.props} case${r.props > 1 ? 's' : ''} · ${fmt(r.cash)} en or</small>`}</span><span class="wt">${r.bankrupt ? '—' : fmt(r.worth)}</span></li>`).join('');
    const rankingDescription = s.endReason === 'victory' ? 'La partie s’arrête immédiatement.' : 'Classement à la fortune totale (or + valeur des cases et constructions).';
    openModal(`<h2>🏆 ${esc(s.ranking[0].name)} remporte la taverne !</h2><p>${reason} ${rankingDescription}</p><ul class="ranking">${list}</ul>
      <div class="btn-row">${isHost ? '<button class="btn primary" id="againBtn">Rejouer avec les mêmes joueurs</button>' : '<p class="muted">L’hôte peut relancer une partie.</p>'}<button class="btn" data-close>Fermer</button></div>`);
    const ab = $('againBtn');
    if (ab) ab.onclick = () => { closeModal(); const players = s.players.map((p) => ({ name: p.name, token: p.token, isBot: p.isBot, peerId: p.peerId })); launch(players, app.lobby ? app.lobby.durationMin : RULES.defaultDurationMin); };
  }

  function showRules() {
    openModal(`<div class="rules"><h2>Règles de la taverne</h2>
      <h3>But</h3><ul><li>Quand le chrono sonne, le joueur le plus riche gagne : or + valeur des cases et constructions.</li><li>La partie s’arrête aussi si tous les autres joueurs font faillite.</li></ul>
      <h3>Victoires immédiates</h3><ul><li>Posséder les 4 serviteurs neutres (Brann, Drakkari, Titus et Leeroy).</li><li>Posséder toutes les cases achetables d’un même côté du plateau (serviteurs et cartes neutres).</li><li>Posséder 3 monopoles de famille.</li></ul>
      <h3>Tour de jeu</h3><ul><li>Au début, chacun lance les dés pour déterminer l’ordre de passage ; les égalités sont départagées par un nouveau lancer.</li><li>Chaque tour dure 30 secondes, indiqué par la mèche du pétard. Le tour passe automatiquement à l’expiration.</li><li>Lancez les dés, avancez. Un double fait rejouer ; trois doubles d’affilée envoient sur l’Île perdue.</li><li><b>Case libre</b> : achetez-la directement avec une Taverne de niveau 1 à 4. Seule la Taverne 4 est bloquée jusqu’à un premier passage par la Taverne.</li><li><b>Case à vous</b> : améliorez-la jusqu’à Taverne 4, puis en Serviteur doré, pour le loyer maximal. Le Serviteur doré rend la case imprenable.</li><li><b>Case adverse</b> : payez le loyer, puis vous pouvez la <b>racheter</b> pour 125 % de sa valeur d’achat (sauf Serviteur doré). L’or lui est versé et les niveaux restent.</li><li>Passage par la Taverne : +${fmt(RULES.salary)}.</li></ul>
      <h3>Cases spéciales</h3><ul><li><b>Festival</b> : au début de la partie, 3 cases achetables de familles différentes sont choisies au hasard ; leur loyer est doublé jusqu’à la fin. Le prix d’achat ne change pas.</li><li><b>Chance</b> : tirez une carte (gains, pertes, déplacements, carte de sortie…).</li><li><b>Serviteurs neutres</b> (Brann, Drakkari, Titus et Leeroy) : achetez-les sans niveau ; le loyer dépend du nombre que vous possédez. Ils ne peuvent pas être rachetés.</li><li><b>Taxe</b> : payez ${fmt(RULES.taxA)} à la banque.</li><li><b>Île perdue</b> : payez ${fmt(RULES.jailFee)} ou faites un double pour partir (3 essais).</li><li><b>Championnats</b> : pour ${fmt(RULES.championshipFee)}, le loyer d’une de vos cases est multiplié (x2, x3… jusqu’à x${RULES.championshipMaxMult}).</li><li><b>Monopole</b> : posséder toute une famille double le loyer à tous les niveaux.</li><li><b>Tour du monde</b> : il s’active à votre prochain tour et remplace le lancer de dés. Pour ${fmt(RULES.worldTourFee)}, voyagez vers l’avant jusqu’à une case libre ou à vous ; passer par la Taverne rapporte ${fmt(RULES.salary)}.</li></ul>
      <h3>Modes facultatifs</h3><ul><li><b>Anomalies</b> : une règle commune, choisie ou tirée au lancement. Le Festival peut se déplacer ; les terres maudites coûtent moins cher et rapportent plus ; le Dé du destin laisse choisir deux dés parmi trois.</li><li><b>Bonus Taverne</b> : une récompense maximum par tour, en avançant par la Taverne. Choisissez le salaire ou un des deux pouvoirs proposés. Arriver exactement à la Taverne conserve le supplément de salaire, même avec un pouvoir. Deux pouvoirs en réserve, un utilisé par tour avant un lancer. À expiration du choix, l’or est choisi.</li><li><b>Légendaires</b> : 5 % des offres contiennent un légendaire. Chacun ne peut apparaître qu’une fois par partie, même refusé : annulation totale d’un loyer, anéantissement d’une propriété adverse (même dorée), ou amélioration dorée gratuite. Les serviteurs neutres sont protégés de l’anéantissement.</li></ul>
      <h3>Dettes</h3><ul><li>En cas de dette, vous pouvez vendre une propriété entière avec tous ses niveaux à la banque pour 75 % du montant total investi.</li><li>En cas de faillite, chaque propriété et ses niveaux sont mis aux enchères entre les joueurs restants. Le joueur en faillite récupère 50 % du prix adjugé.</li></ul>
      <div class="btn-row" style="margin-top:16px"><button class="btn primary" data-close>Compris</button></div></div>`);
  }


  return { showTileSheet, showChanceCard, showEnd, showRules };
}
