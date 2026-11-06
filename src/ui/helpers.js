import { $, BOARD, GROUPS } from '../runtime.js';

// Utilitaires UI
function toast(msg, ms) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms || 2600);
}
function openModal(html, opts) {
  opts = opts || {};
  const m = $('modal'), c = $('modalCard');
  c.innerHTML = html + (opts.noClose ? '' : '<button class="btn small ghost close" data-close>✕</button>');
  m.hidden = false;
  m.onclick = (e) => { if (e.target === m && !opts.noClose) closeModal(); };
  c.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeModal));
  return c;
}
function closeModal() { $('modal').hidden = true; clearTimeout(openModal._auto); }
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const groupColor = (i) => (BOARD[i].type === 'property' ? GROUPS[BOARD[i].group].color : '#5c88a8');
const typeLabel = (i) => (BOARD[i].type === 'property' ? GROUPS[BOARD[i].group].label : BOARD[i].type === 'station' ? 'Serviteur neutre' : 'Case spéciale');
const ICONS = { start: '🍺', jail: '🏝️', championship: '🏆', worldtour: '🌀', tax: '💰', chance: '?', station: '🛡️' };
const shortName = (i) => BOARD[i].short || BOARD[i].name;
// format compact pour les cases : 540 k, 1,05 M
const fmtShort = (n) => (n >= 1e6 ? (Math.round(n / 10000) / 100).toLocaleString('fr-FR') + ' M' : Math.round(n / 1000).toLocaleString('fr-FR') + ' k');


export { toast, openModal, closeModal, esc, groupColor, typeLabel, ICONS, shortName, fmtShort };
