const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Minimal DOM for controller integration, not a layout or WebRTC substitute.
function createHarness() {
  const nodes = new Map();
  class Element {
    constructor() {
      this.children = []; this.dataset = {}; this.style = { setProperty() {} };
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.value = ''; this.hidden = true; this.textContent = '';
      this.attributes = {}; this.listeners = {};
    }
    set innerHTML(value) { this.html = value; this.children = []; }
    get innerHTML() { return this.html || ''; }
    setAttribute(key, value) { this.attributes[key] = value; }
    appendChild(child) { this.children.push(child); if (child.id) nodes.set(child.id, child); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    querySelectorAll(selector) {
      if (selector === '.tile') return this.children.filter(n => n.className?.startsWith('tile '));
      if (selector === '.token-btn') return this.children;
      return [];
    }
    querySelector(selector) {
      const match = selector.match(/^\.tile\[data-i="(\d+)"\]$/);
      if (match) return this.children.find(n => n.dataset.i === +match[1]) || null;
      if (selector === '.champ' || selector === '.festival') return null;
      return new Element();
    }
    get firstElementChild() { return this.children[0] || this.querySelector('span'); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    remove() {}
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const timeouts = new Map(), intervals = new Map(); let nextId = 0;
  const context = vm.createContext({
    console, Date, Math: Object.create(Math),
    document: { getElementById: get, createElement: () => new Element(), querySelector: get, body: new Element() },
    navigator: {}, location: {},
    setTimeout(fn) { const id = ++nextId; timeouts.set(id, fn); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(fn, ms) { const id = ++nextId; intervals.set(id, { fn, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    requestAnimationFrame() {}, addEventListener() {},
  });
  context.window = context;
  for (const file of ['config.js', 'engine.js', 'net.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (!cache.has(filename)) cache.set(filename, new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: filename }));
    return cache.get(filename);
  }
  async function start() {
    const entry = load('app.js');
    await entry.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier)));
    await entry.evaluate();
    context.TT_DEBUG.muted = true;
    return context.TT_DEBUG;
  }
  function flush() {
    // Run only callbacks scheduled before this flush; bot/animation chains remain bounded.
    const batch = [...timeouts];
    for (const [id, fn] of batch) if (timeouts.delete(id)) fn();
  }
  return { context, get, start, flush, intervals, load };
}
module.exports = { createHarness };
