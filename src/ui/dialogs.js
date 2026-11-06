import { E, $, fmt, app, LEVEL_LABELS, BOARD, GROUPS, RULES } from '../runtime.js';
import { SFX } from '../audio.js';
import { openModal, closeModal, esc, groupColor, typeLabel, ICONS } from './helpers.js';

export function createDialogs({ launch, act }) {
  function showTileSheet(i) {
    const s = app.state; if (!s || !BOARD[i]) return;
    const b = BOARD[i]; const t = s.tiles[i]; const me = app.myIdx;
    const myTurn = s.current === me && s.phase === 'playing';
    app.selectedTile = i;
    $('board').querySelectorAll('.tile').forEach((tile) => tile.classList.toggle('info-selected', +tile.dataset.i === i));
    let html = `<article class="tile-info-card"><header class="tile-info-hero" style="--g:${groupColor(i)}"><span class="tile-info-icon">${ICONS[b.type] || '•'}</span><div><span class="tile-info-kicker">${esc(typeLabel(i))}</span><h2>${esc(b.name || 'Case sans type')}</h2>${b.sub ? `<p>${esc(b.sub)}</p>` : ''}</div></header><div class="tile-info-content">`;
    if (b.type === 'property') {
      const owner = t.owner !== null ? s.players[t.owner] : null;
      const currentLevel = owner ? LEVEL_LABELS[t.houses] : 'Disponible';
      html += `<div class="tile-info-summary"><span>${GROUPS[b.group].label}</span><span>${owner ? `Niveau : ${currentLevel}` : 'Propriété disponible'}</span></div>
        <div class="tile-info-stats"><div><small>Prix d’achat</small><strong>${fmt(b.price)}</strong></div><div><small>Amélioration</small><strong>${fmt(GROUPS[b.group].houseCost)}</strong></div><div><small>Serviteur doré</small><strong>${fmt(GROUPS[b.group].houseCost * RULES.hotelCostMult)}</strong></div></div>
        <p class="tile-info-owner">${owner ? `Propriétaire : <b style="color:${owner.color}">${esc(owner.name)}</b>` : 'Cette case est libre.'}${s.championship && s.championship.tile === i ? ` · ✦ Sombre Don x${s.championship.mult}` : ''}${s.festivalTiles && s.festivalTiles.includes(i) ? ' · ☾ Festival de Sombrelune x2' : ''}</p>
        <h3 class="tile-info-section-title">Loyer selon le niveau</h3><table class="tile-info-rents">` + b.rents.map((r, k) => {
        if (k === 0) return '';
        const assumedOwner = t.owner === null ? me : t.owner;
        const rentState = { ...s, tiles: s.tiles.map((tile, index) => index === i ? { owner: assumedOwner, houses: k } : tile) };
        return `<tr class="${owner && t.houses === k ? 'now' : ''}"><td>${LEVEL_LABELS[k]} <small>(+${fmt(E.levelCost(i, 0, k))})</small></td><td>${fmt(E.computeRent(rentState, i, 7))}</td></tr>`;
      }).join('') + '</table>';
      if (owner && t.owner !== me) html += `<p class="tile-info-note">${t.houses === E.HOTEL ? 'Serviteur doré : cette case ne peut pas être rachetée.' : `Rachat possible en y tombant : <b>${fmt(E.buyoutPrice(s, i))}</b> (125 % de l’investissement de ${esc(owner.name)}).`}</p>`;
    } else if (b.type === 'station') {
      const owner = t.owner !== null ? s.players[t.owner] : null;
      html += `<div class="tile-info-summary"><span>Serviteur neutre</span><span>Prix : ${fmt(b.price)}</span></div>
        <p class="tile-info-owner">${owner ? `Propriétaire : <b style="color:${owner.color}">${esc(owner.name)}</b>` : 'Cette case est libre.'}${owner && t.owner !== me ? '<br>Cette case ne peut pas être rachetée.' : ''}${s.festivalTiles && s.festivalTiles.includes(i) ? '<br>☾ Festival de Sombrelune : loyer x2' : ''}</p>
        <h3 class="tile-info-section-title">Loyer selon les serviteurs neutres possédés</h3><table class="tile-info-rents">${RULES.stationRents.map((r, k) => {
          const festivalRent = s.festivalTiles && s.festivalTiles.includes(i) ? r * 2 : r;
          return `<tr class="${owner && E.countOwned(s, t.owner, 'station') === k + 1 ? 'now' : ''}"><td>${k + 1} serviteur${k ? 's' : ''} neutre${k ? 's' : ''}</td><td>${fmt(festivalRent)}</td></tr>`;
        }).join('')}</table>`;
    } else {
      const desc = {
        blank: 'Cette case sans type n’a aucun effet.',
        start: `Recevez ${fmt(RULES.salary)} à chaque passage.`,
        jail: `A. F. KAH vous retient ici. Payez ${fmt(RULES.jailFee)}, utilisez une carte de sortie ou tentez un double (3 essais maximum). Vous pouvez être envoyé ici par une case, une carte Chance ou trois doubles.`,
        championship: `Utilisez le Sombre Don pour choisir l’un de vos serviteurs. Son loyer est multiplié (x2, puis x3… jusqu’à x${RULES.championshipMaxMult}). Un seul Sombre Don est actif à la fois.`,
        worldtour: `Le Portail chronodistordu s’active au début de votre prochain tour et remplace votre lancer de dés. Pour ${fmt(RULES.worldTourFee)}, voyagez vers l’avant jusqu’à une case libre ou à vous. Passer par la Taverne rapporte ${fmt(RULES.salary)}.`,
        tax: `Payez ${fmt(b.amount || 0)} à la banque.`,
        chance: 'Tirez une carte Chance : bonne ou mauvaise surprise.',
      }[b.type];
      html += `<p class="tile-info-description">${desc}</p>`;
    }
    html += '</div>';
    if (t && t.owner === me && myTurn && ['roll', 'debt', 'jail', 'buy', 'build', 'buyout'].includes(s.turn.step)) {
      const v = E.sellValue(s, i);
      const levels = b.type === 'property' && t.houses > 0 ? ` et ${t.houses === E.HOTEL ? 'son Serviteur doré' : `sa Taverne ${t.houses}`}` : '';
      html += `<div class="tile-info-sell"><p class="muted">Vente de la case entière${levels} : 75 % de l’investissement total.</p><button class="btn danger" id="sellBtn">Vendre toute la propriété — +${fmt(v)}</button></div>`;
    }
    const panel = $('tileInfo');
    if (!panel) return;
    panel.innerHTML = html + '</article>';
    const sb = panel.querySelector('#sellBtn');
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
