(() => {
'use strict';

/* =====================================================================
   سراب — لعبة استكشاف وألغاز 2D تعمل بدون إنترنت
   ===================================================================== */

/* ---------- أدوات ---------- */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const arNum = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function inPoly(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

/* ---------- ثوابت العالم ---------- */
const WORLD = 4800, CELL = 6, G = WORLD / CELL;
const PAD = 140;
const EG = 48, ECELL = WORLD / EG;
const PW = 640, PH = 400;

/* ---------- الصوت (يُولَّد برمجياً، بدون ملفات) ---------- */
const Sfx = {
  ctx: null, master: null, muted: store('sarab_muted') === '1',
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(this.ctx.destination);
      this.wind();
    } catch (e) { this.ctx = null; }
  },
  setMuted(m) {
    this.muted = m; store('sarab_muted', m ? '1' : '0');
    if (this.master) this.master.gain.value = m ? 0 : 0.7;
  },
  wind() {
    const c = this.ctx, len = c.sampleRate * 3;
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.03 * w) / 1.03; d[i] = last * 4; }
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.6;
    const g = c.createGain(); g.gain.value = 0.22;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.11;
    const lg = c.createGain(); lg.gain.value = 0.1;
    lfo.connect(lg); lg.connect(g.gain);
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.07;
    const lg2 = c.createGain(); lg2.gain.value = 220;
    lfo2.connect(lg2); lg2.connect(bp.frequency);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(); lfo.start(); lfo2.start();
  },
  tone(f, dur = 0.3, type = 'sine', vol = 0.15, delay = 0, slide = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t0 = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, f + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.05);
  },
  noise(dur = 0.08, freq = 1800, vol = 0.05) {
    if (!this.ctx) return;
    const c = this.ctx, n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    const g = c.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(this.master); s.start();
  },
  step() { this.noise(0.06, 1300 + Math.random() * 500, 0.03); },
  chime() { [660, 880, 1320].forEach((f, i) => this.tone(f, 0.9, 'sine', 0.14, i * 0.13)); },
  error() { this.tone(150, 0.35, 'sawtooth', 0.12, 0, -70); },
  drink() { [420, 520, 640].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.1, i * 0.09, 140)); },
  tick(n) { this.tone(500 + n * 90, 0.18, 'triangle', 0.12); },
  dig() { for (let i = 0; i < 8; i++) setTimeout(() => this.noise(0.18, 700, 0.08), i * 300); },
  win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 1.2, 'sine', 0.14, i * 0.2)); },
};

/* ---------- الضوضاء ---------- */
function makeNoise(rng) {
  const perm = new Uint8Array(512), vals = new Float32Array(256);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) vals[i] = rng();
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const v00 = vals[perm[perm[X] + Y]], v10 = vals[perm[perm[X + 1] + Y]];
    const v01 = vals[perm[perm[X] + Y + 1]], v11 = vals[perm[perm[X + 1] + Y + 1]];
    const u = fade(xf), v = fade(yf);
    return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
  };
}

/* ---------- الكثبان ---------- */
let heights = null, terrainCanvas = null;

function buildTerrain(seed) {
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const n1 = makeNoise(rng), n2 = makeNoise(rng);
  const H = new Float32Array(G * G);
  const wa = rng() * TAU, wx = Math.cos(wa), wy = Math.sin(wa);
  const ro = rng() * 100;
  for (let j = 0; j < G; j++) {
    const y = (j / G) * 8;
    for (let i = 0; i < G; i++) {
      const x = (i / G) * 8;
      const qx = n2(x * 0.8 + 3.3, y * 0.8 + 9.1) * 1.2;
      const qy = n2(x * 0.8 + 41.7, y * 0.8 + 27.5) * 1.2;
      let h = 0, amp = 1, f = 1, sum = 0;
      for (let o = 0; o < 4; o++) {
        h += n1((x + qx) * f + o * 19.7, (y + qy) * f + o * 7.3) * amp;
        sum += amp; amp *= 0.48; f *= 2.07;
      }
      h /= sum;
      const across = -i * wy + j * wx;
      h += Math.sin(across * 0.5 + h * 22 + ro) * 0.012;
      const e = Math.min(i, j, G - 1 - i, G - 1 - j) / G;
      const edge = clamp((0.06 - e) / 0.06, 0, 1);
      h += edge * edge * 0.45;
      H[j * G + i] = h;
    }
  }
  const img = new ImageData(G, G), d = img.data;
  for (let j = 0; j < G; j++) {
    const ju = Math.max(j - 1, 0), jd = Math.min(j + 1, G - 1);
    for (let i = 0; i < G; i++) {
      const il = Math.max(i - 1, 0), ir = Math.min(i + 1, G - 1);
      const gx = H[j * G + ir] - H[j * G + il], gy = H[jd * G + i] - H[ju * G + i];
      const b = clamp(0.5 + (gx + gy) * 0.7 * 14, 0, 1);
      let r, g, bl;
      if (b < 0.5) { const t = b / 0.5; r = lerp(176, 222, t); g = lerp(116, 172, t); bl = lerp(62, 104, t); }
      else { const t = (b - 0.5) / 0.5; r = lerp(222, 247, t); g = lerp(172, 222, t); bl = lerp(104, 158, t); }
      const e = Math.min(i, j, G - 1 - i, G - 1 - j) / G;
      const ed = clamp((0.07 - e) / 0.07, 0, 1) * 0.65;
      r = lerp(r, 118, ed); g = lerp(g, 70, ed); bl = lerp(bl, 36, ed);
      const k = (j * G + i) * 4;
      d[k] = r; d[k + 1] = g; d[k + 2] = bl; d[k + 3] = 255;
    }
  }
  const c = document.createElement('canvas'); c.width = G; c.height = G;
  c.getContext('2d').putImageData(img, 0, 0);
  heights = H; terrainCanvas = c;
}
function sampleH(x, y) {
  const i = clamp((x / CELL) | 0, 0, G - 1), j = clamp((y / CELL) | 0, 0, G - 1);
  return heights[j * G + i];
}

/* ---------- الرسوم الجاهزة (Sprites) ---------- */
const sprites = {};
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ell(g, x, y, rx, ry, fill) {
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU);
  if (fill) { g.fillStyle = fill; g.fill(); }
}
function palm(g, x, y, h, lean, dry, sc) {
  g.save(); g.lineCap = 'round';
  const tx = x + lean, ty = y - h;
  g.strokeStyle = dry ? '#7a5a38' : '#6b4a2a'; g.lineWidth = 7 * sc;
  g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + lean * 0.2, y - h * 0.5, tx, ty); g.stroke();
  const n = 8, len = (dry ? 38 : 46) * sc, droop = (dry ? 26 : 14) * sc;
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (k - (n - 1) / 2) * 0.62;
    const cx = tx + Math.cos(a) * len * 0.6, cy = ty + Math.sin(a) * len * 0.9 - 10 * sc;
    const ex = tx + Math.cos(a) * len * 1.1, ey = ty + Math.sin(a) * len * 0.35 + droop * Math.abs(Math.cos(a));
    g.strokeStyle = dry ? '#8b7345' : '#2f7a3a'; g.lineWidth = 5.5 * sc;
    g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(cx, cy, ex, ey); g.stroke();
    g.strokeStyle = dry ? '#b49a63' : '#63b35a'; g.lineWidth = 2 * sc;
    g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(cx, cy, ex, ey); g.stroke();
  }
  g.restore();
}
function makeOasisSprite(dry) {
  const c = mkCanvas(320, 240), g = c.getContext('2d'), cx = 160, cy = 150;
  if (!dry) {
    ell(g, cx + 8, cy + 10, 120, 56, 'rgba(60,40,15,0.18)');
    ell(g, cx, cy, 112, 56, '#4f8a3e');
    ell(g, cx, cy - 2, 100, 49, '#6aa64a');
    palm(g, cx + 6, cy - 34, 78, -4, false, 0.9);
    const wg = g.createRadialGradient(cx - 18, cy - 12, 6, cx, cy, 78);
    wg.addColorStop(0, '#a8e6f2'); wg.addColorStop(0.6, '#4fb3cf'); wg.addColorStop(1, '#2b7fa5');
    ell(g, cx, cy, 78, 37, wg);
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(cx, cy, 58, 26, 0, 0.2, 2.6); g.stroke();
    g.beginPath(); g.ellipse(cx, cy, 40, 17, 0, 3.4, 5.6); g.stroke();
    for (let k = 0; k < 9; k++) {
      const a = k * 0.7 + 0.3;
      ell(g, cx + Math.cos(a) * 92, cy + Math.sin(a) * 42, 6, 4, '#3f7d35');
    }
    palm(g, cx - 92, cy - 4, 86, -10, false, 1);
    palm(g, cx + 88, cy - 10, 96, 12, false, 1.05);
  } else {
    ell(g, cx, cy, 108, 52, '#b58a58');
    ell(g, cx, cy - 1, 92, 43, '#a37846');
    g.strokeStyle = 'rgba(60,35,12,0.5)'; g.lineWidth = 1.4;
    const rng = mulberry32(7);
    for (let k = 0; k < 16; k++) {
      let x = cx + (rng() - 0.5) * 140, y = cy + (rng() - 0.5) * 56;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 3; s++) { x += (rng() - 0.5) * 26; y += (rng() - 0.5) * 14; g.lineTo(x, y); }
      g.stroke();
    }
    palm(g, cx - 92, cy - 4, 70, -14, true, 1);
    palm(g, cx + 88, cy - 10, 80, 16, true, 1.05);
  }
  return { c, px: cx, py: cy };
}
function col(g, x, y, h, w, broken) {
  ell(g, x, y, w * 0.7, w * 0.26, '#8d7a5a');
  const gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  gr.addColorStop(0, '#e6d3aa'); gr.addColorStop(0.55, '#c4ac80'); gr.addColorStop(1, '#8f7a57');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(x - w / 2, y);
  g.lineTo(x - w / 2, y - h);
  if (broken) { g.lineTo(x - w / 6, y - h - 8); g.lineTo(x + w / 10, y - h + 4); g.lineTo(x + w / 2, y - h - 6); }
  else g.lineTo(x + w / 2, y - h);
  g.lineTo(x + w / 2, y); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(70,50,25,0.3)'; g.lineWidth = 1.4;
  for (const dx of [-w / 6, w / 6]) { g.beginPath(); g.moveTo(x + dx, y - 4); g.lineTo(x + dx, y - h + 6); g.stroke(); }
  if (!broken) ell(g, x, y - h, w * 0.62, w * 0.22, '#e5d3ae');
}
function makeRuinSprite() {
  const c = mkCanvas(320, 240), g = c.getContext('2d'), cx = 160, cy = 175;
  ell(g, cx + 34, cy + 8, 118, 34, 'rgba(80,45,15,0.28)');
  ell(g, cx, cy, 104, 34, '#8c7b66');
  ell(g, cx, cy - 3, 96, 30, '#a8967d');
  ell(g, cx, cy - 4, 80, 24, '#c9b48f');
  g.strokeStyle = 'rgba(90,60,30,0.55)'; g.lineWidth = 2;
  g.beginPath(); g.ellipse(cx, cy - 4, 60, 18, 0, 0, TAU); g.stroke();
  // عمود ساقط
  g.save(); g.translate(cx + 10, cy + 14); g.rotate(-0.12);
  const fg = g.createLinearGradient(0, -10, 0, 10); fg.addColorStop(0, '#d6c29a'); fg.addColorStop(1, '#8d7a5a');
  g.fillStyle = fg; g.fillRect(-42, -9, 84, 18); ell(g, 42, 0, 5, 9, '#b9a47c'); g.restore();
  col(g, cx - 70, cy - 2, 78, 24, true);
  col(g, cx - 6, cy - 8, 112, 26, false);
  col(g, cx + 62, cy, 58, 24, true);
  g.fillStyle = '#9d8a6a';
  for (let k = 0; k < 7; k++) {
    const rx = cx + (k - 3) * 30 + (k % 2) * 8, ry = cy + 22 + (k % 3) * 4;
    g.beginPath(); g.moveTo(rx, ry); g.lineTo(rx + 8, ry - 3); g.lineTo(rx + 10, ry + 3); g.closePath(); g.fill();
  }
  return { c, px: cx, py: cy };
}
function makeObsSprite() {
  const c = mkCanvas(260, 260), g = c.getContext('2d'), cx = 130, cy = 215;
  ell(g, cx + 30, cy + 8, 100, 28, 'rgba(80,45,15,0.28)');
  ell(g, cx, cy, 92, 30, '#7e6f5c');
  ell(g, cx, cy - 4, 84, 26, '#a8957b');
  const bg = g.createLinearGradient(cx - 52, 0, cx + 52, 0);
  bg.addColorStop(0, '#d8c6a2'); bg.addColorStop(0.6, '#b5a182'); bg.addColorStop(1, '#85735a');
  g.fillStyle = bg; g.fillRect(cx - 52, cy - 74, 104, 70);
  ell(g, cx, cy - 4, 52, 15, '#8a785d');
  g.fillStyle = bg; g.fillRect(cx - 52, cy - 74, 104, 66);
  ell(g, cx, cy - 74, 52, 15, '#c4b293');
  // القبة
  const dg = g.createRadialGradient(cx - 18, cy - 118, 6, cx, cy - 96, 64);
  dg.addColorStop(0, '#7fa6c4'); dg.addColorStop(0.6, '#3e5f7a'); dg.addColorStop(1, '#25384c');
  g.fillStyle = dg;
  g.beginPath(); g.moveTo(cx - 52, cy - 74);
  g.bezierCurveTo(cx - 52, cy - 150, cx + 52, cy - 150, cx + 52, cy - 74);
  g.ellipse(cx, cy - 74, 52, 15, 0, 0, Math.PI); g.closePath(); g.fill();
  g.fillStyle = '#11141c';
  g.beginPath(); g.moveTo(cx + 6, cy - 128); g.lineTo(cx + 22, cy - 112); g.lineTo(cx + 14, cy - 84); g.lineTo(cx + 2, cy - 90); g.closePath(); g.fill();
  g.strokeStyle = '#2c2c34'; g.lineWidth = 9; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx + 6, cy - 104); g.lineTo(cx + 54, cy - 150); g.stroke();
  g.strokeStyle = '#8fa4b8'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx + 6, cy - 107); g.lineTo(cx + 52, cy - 152); g.stroke();
  g.fillStyle = '#ffe9a3';
  for (const [sx, sy] of [[-30, -102], [-14, -126], [-38, -86], [28, -134]]) { g.fillRect(cx + sx, cy + sy, 2.5, 2.5); }
  g.fillStyle = '#2a1c10';
  g.beginPath(); g.moveTo(cx - 13, cy - 6); g.lineTo(cx - 13, cy - 38); g.quadraticCurveTo(cx, cy - 54, cx + 13, cy - 38); g.lineTo(cx + 13, cy - 6); g.closePath(); g.fill();
  return { c, px: cx, py: cy };
}
function makeGrain() {
  const c = mkCanvas(128, 128), g = c.getContext('2d');
  const rng = mulberry32(99);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(255,240,200,0.5)' : 'rgba(90,55,20,0.45)';
    g.fillRect(rng() * 128, rng() * 128, 1.5, 1.5);
  }
  return c;
}

/* ---------- الحالة العامة ---------- */
const canvas = $('world'), ctx = canvas.getContext('2d');
const hud = $('hud'), waterFill = $('waterFill'), waterNum = $('waterNum'), piecesEl = $('pieces');
const objective = $('objective'), toastEl = $('toast'), compassEl = $('compass');
const compassArrow = $('compassArrow'), compassLabel = $('compassLabel');
const actBtn = $('actBtn'), stick = $('stick'), knob = $('knob');
const mini = $('minimap'), mctx = mini.getContext('2d');
const pcv = $('puzzleCanvas'), pg = pcv.getContext('2d');
const mapC = $('mapCanvas'), mg = mapC.getContext('2d');
const screens = { title: $('title'), loading: $('loading'), puzzle: $('puzzle'), map: $('mapScreen'), end: $('endScreen') };

let W = 0, H = 0, dpr = 1, zoom = 1;
const cam = { x: 0, y: 0 };
let S = null;            // حالة اللعبة الحالية
let T = 0;               // الوقت الكلي للعرض
let grainPattern = null;
const keys = new Set();
const joy = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
const isTouch = window.matchMedia && matchMedia('(pointer:coarse)').matches;

function showScreen(name) { for (const k in screens) screens[k].classList.toggle('hidden', k !== name); }
function hideScreens() { for (const k in screens) screens[k].classList.add('hidden'); }

let toastT = 0;
function toast(msg, ms = 3000) {
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/* ---------- توليد المواقع ---------- */
function genSites(seed) {
  const rng = mulberry32(((seed * 2654435761) ^ 0xA5A5) >>> 0);
  const sites = []; let id = 0;
  const cx = WORLD / 2, cy = WORLD / 2;
  const mk = (type, x, y, extra) => ({ id: id++, type, x, y, solved: false, used: false, vanished: false, fade: 1, seen: false, p: rng() * 100, level: 0, ...extra });
  const ok = (x, y, minD) => {
    if (dist(x, y, cx, cy) < 460) return false;
    for (const s of sites) if (dist(x, y, s.x, s.y) < minD) return false;
    return true;
  };
  const place = (type, extra) => {
    let minD = 640;
    for (let tries = 0; ; tries++) {
      const x = lerp(330, WORLD - 330, rng()), y = lerp(330, WORLD - 330, rng());
      if (ok(x, y, minD)) { const s = mk(type, x, y, extra); sites.push(s); return s; }
      if (tries % 60 === 59) minD *= 0.93;
    }
  };
  const a0 = rng() * TAU, d0 = 700 + rng() * 150;
  const first = mk('oasis', cx + Math.cos(a0) * d0, cy + Math.sin(a0) * d0);
  sites.push(first);
  const rl = shuffle([0, 1, 2], rng), ol = shuffle([0, 1], rng);
  rl.forEach((l) => place('ruin', { level: l }));
  ol.forEach((l) => place('obs', { level: l }));
  for (let i = 0; i < 8; i++) place('oasis');
  for (let i = 0; i < 5; i++) place('mirage');
  let city = null;
  for (let tries = 0; !city; tries++) {
    const x = lerp(450, WORLD - 450, rng()), y = lerp(450, WORLD - 450, rng());
    const dd = dist(x, y, cx, cy);
    const near = sites.some((s) => dist(x, y, s.x, s.y) < (tries > 500 ? 200 : 450));
    if (dd > 1500 && dd < 2100 && !near) city = { type: 'city', x, y };
    if (tries > 3000) city = { type: 'city', x: clamp(cx + 1700, 450, WORLD - 450), y: cy };
  }
  return { sites, city, first };
}

function newState(seed, daily) {
  const { sites, city, first } = genSites(seed);
  return {
    seed, daily, mode: 'play',
    p: { x: WORLD / 2, y: WORLD / 2, vx: 0, vy: 0, face: 1, walk: 0, scarfX: WORLD / 2, scarfY: WORLD / 2 - 30 },
    water: 100, pieces: 0, sites, city, mapComplete: false,
    hint: { site: first, until: 16, label: 'واحة' },
    time: 0, dist: 0, oases: 0, feetAcc: 0, side: 1,
    explored: new Uint8Array(EG * EG), feet: [], parts: [], puzzle: null,
    dig: 0, digT: 0, shake: 0, near: null, lowWarned: false, nearKey: '',
  };
}

function reveal(x, y) {
  const r = 340, ci = Math.floor(x / ECELL), cj = Math.floor(y / ECELL), rr = Math.ceil(r / ECELL);
  for (let j = cj - rr; j <= cj + rr; j++) for (let i = ci - rr; i <= ci + rr; i++) {
    if (i < 0 || j < 0 || i >= EG || j >= EG) continue;
    if (dist((i + 0.5) * ECELL, (j + 0.5) * ECELL, x, y) <= r) S.explored[j * EG + i] = 1;
  }
}

/* ---------- الجسيمات ---------- */
function spawn(x, y, n, o) {
  for (let i = 0; i < n; i++) {
    S.parts.push({
      x, y, vx: (Math.random() - 0.5) * o.spread, vy: (Math.random() - 0.5) * o.spread - (o.up || 0),
      life: o.life * (0.6 + Math.random() * 0.6), max: o.life, size: o.size * (0.6 + Math.random() * 0.8),
      color: o.color, g: o.g || 0,
    });
  }
}
function updateParts(dt) {
  const a = S.parts;
  for (let i = a.length - 1; i >= 0; i--) {
    const p = a[i]; p.life -= dt;
    if (p.life <= 0) { a.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt;
  }
}

/* =====================================================================
   الألغاز
   ===================================================================== */
class ShadowPuzzle {
  constructor(site) {
    this.site = site;
    const rng = mulberry32((S.seed ^ (site.id * 7919)) >>> 0);
    const n = 3 + site.level;
    this.n = n; this.asc = rng() < 0.5;
    const ang = ((52 + rng() * 16) * Math.PI) / 180;
    this.dirx = Math.cos(ang); this.diry = Math.sin(ang);
    const lens = [];
    for (let i = 0; i < n; i++) lens.push(50 + i * (170 / (n - 1)) + (rng() - 0.5) * 8);
    shuffle(lens, rng);
    const margin = 80, spacing = (PW - 2 * margin) / (n - 1);
    this.pillars = [];
    for (let i = 0; i < n; i++) {
      this.pillars.push({ x: margin + i * spacing, y: 96 + (rng() - 0.5) * 8, h: 62 + rng() * 40, w: 28, len: lens[i], mark: 0 });
    }
    const idx = [...Array(n).keys()].sort((a, b) => this.pillars[a].len - this.pillars[b].len);
    if (!this.asc) idx.reverse();
    this.order = idx; this.stepN = 0; this.shake = 0; this.done = false; this.fin = 0;
  }
  title() { return 'أطلال الظلال'; }
  text() {
    return `على اللوح المنقوش: «رتّب الأعمدة بحسب طول ظلّها، ${this.asc ? 'من الأقصر إلى الأطول' : 'من الأطول إلى الأقصر'}. العين تُخدع، والظلّ لا يكذب.» اضغط الأعمدة بالترتيب.`;
  }
  update(dt) { if (this.shake > 0) this.shake -= dt; if (this.done) this.fin += dt; }
  draw(g) {
    g.save();
    if (this.shake > 0) g.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 4);
    const bg = g.createLinearGradient(0, 0, 0, PH);
    bg.addColorStop(0, '#edd49c'); bg.addColorStop(1, '#d3aa6b');
    g.fillStyle = bg; g.fillRect(-10, -10, PW + 20, PH + 20);
    g.strokeStyle = 'rgba(120,85,40,0.18)'; g.lineWidth = 1.5;
    for (let r = 0; r * 56 < PH; r++) {
      g.beginPath(); g.moveTo(0, r * 56); g.lineTo(PW, r * 56); g.stroke();
      for (let x = (r % 2) * 40; x < PW; x += 80) { g.beginPath(); g.moveTo(x, r * 56); g.lineTo(x, r * 56 + 56); g.stroke(); }
    }
    for (const p of this.pillars) {
      const ex = this.dirx * p.len, ey = this.diry * p.len;
      g.fillStyle = 'rgba(70,40,15,0.36)';
      g.beginPath();
      g.moveTo(p.x - p.w / 2, p.y); g.lineTo(p.x + p.w / 2, p.y);
      g.lineTo(p.x + p.w / 2 + ex, p.y + ey); g.lineTo(p.x - p.w / 2 + ex, p.y + ey);
      g.closePath(); g.fill();
    }
    for (const p of this.pillars) {
      g.fillStyle = '#9d8765'; g.fillRect(p.x - p.w * 0.62, p.y - 6, p.w * 1.24, 10);
      const gr = g.createLinearGradient(p.x - p.w / 2, 0, p.x + p.w / 2, 0);
      gr.addColorStop(0, '#e6d3aa'); gr.addColorStop(0.55, '#c4ac80'); gr.addColorStop(1, '#8f7a57');
      g.fillStyle = gr; g.fillRect(p.x - p.w / 2, p.y - p.h, p.w, p.h - 4);
      g.fillStyle = '#d9c598'; g.fillRect(p.x - p.w * 0.62, p.y - p.h - 8, p.w * 1.24, 9);
      g.strokeStyle = 'rgba(70,50,25,0.3)'; g.lineWidth = 1.3;
      for (const dx of [-p.w / 6, p.w / 6]) { g.beginPath(); g.moveTo(p.x + dx, p.y - 8); g.lineTo(p.x + dx, p.y - p.h + 4); g.stroke(); }
      if (p.mark) {
        g.fillStyle = '#e0b33d'; g.strokeStyle = '#7a5410'; g.lineWidth = 2;
        g.beginPath(); g.arc(p.x, p.y - p.h - 28, 14, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = '#3a2508'; g.font = 'bold 18px Tahoma, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(arNum(p.mark), p.x, p.y - p.h - 27);
      }
    }
    g.restore();
  }
  hit(x, y) {
    for (let i = this.n - 1; i >= 0; i--) {
      const p = this.pillars[i];
      if (x >= p.x - p.w * 0.62 && x <= p.x + p.w * 0.62 && y >= p.y - p.h - 8 && y <= p.y + 4) return i;
      const ex = this.dirx * p.len, ey = this.diry * p.len;
      if (inPoly(x, y, [[p.x - p.w / 2, p.y], [p.x + p.w / 2, p.y], [p.x + p.w / 2 + ex, p.y + ey], [p.x - p.w / 2 + ex, p.y + ey]])) return i;
    }
    return -1;
  }
  click(x, y) {
    if (this.done) return;
    const i = this.hit(x, y);
    if (i < 0 || this.pillars[i].mark) return;
    if (i === this.order[this.stepN]) {
      this.pillars[i].mark = ++this.stepN; Sfx.tick(this.stepN);
      if (this.stepN === this.n) puzzleSolved();
    } else {
      for (const p of this.pillars) p.mark = 0;
      this.stepN = 0; this.shake = 0.4;
      puzzleWrong('الترتيب غير صحيح... تأمّل الظلال لا الأعمدة.');
    }
  }
}

class StarPuzzle {
  constructor(site) {
    this.site = site;
    const rng = mulberry32((S.seed ^ (site.id * 1337)) >>> 0);
    this.pole = { x: 180 + rng() * 280, y: 100 + rng() * 140 };
    this.omega = 0.05 * (rng() < 0.5 ? 1 : -1);
    this.stars = [{ r: 0, a: 0, s: 1.7, pole: true }];
    const decoys = 3 + site.level * 2;
    for (let i = 0; i < decoys; i++) this.stars.push({ r: 24 + rng() * 34, a: rng() * TAU, s: 1.5 + rng() * 0.8 });
    for (let i = 0; i < 110; i++) this.stars.push({ r: 60 + rng() * 520, a: rng() * TAU, s: 0.6 + rng() * 1.6 });
    this.trail = mkCanvas(PW, PH); this.tg = this.trail.getContext('2d');
    this.fast = false; this.done = false; this.fin = 0; this.shake = 0; this.t = 0;
    for (let i = 0; i < 480; i++) this.sim(1 / 60);
  }
  title() { return 'مرصد النجوم'; }
  text() { return 'على جدار المرصد: «كل نجمٍ في السماء يدور... إلا واحداً. اضغط على النجم الثابت.» سرّع الزمن لترى مسارات النجوم.'; }
  pos(st) { return { x: this.pole.x + Math.cos(st.a) * st.r, y: this.pole.y + Math.sin(st.a) * st.r }; }
  sim(dt) {
    const tg = this.tg;
    tg.strokeStyle = 'rgba(190,205,255,0.35)'; tg.lineWidth = 1;
    for (const st of this.stars) {
      if (st.r === 0) continue;
      const p0 = this.pos(st); st.a += this.omega * dt; const p1 = this.pos(st);
      if ((p0.x < -20 && p1.x < -20) || (p0.x > PW + 20 && p1.x > PW + 20) || (p0.y < -20 && p1.y < -20) || (p0.y > PH + 20 && p1.y > PH + 20)) continue;
      tg.beginPath(); tg.moveTo(p0.x, p0.y); tg.lineTo(p1.x, p1.y); tg.stroke();
    }
  }
  update(dt) {
    this.t += dt;
    if (this.shake > 0) this.shake -= dt;
    if (this.done) this.fin += dt;
    this.sim(dt * (this.fast ? 8 : 1));
  }
  draw(g) {
    g.save();
    if (this.shake > 0) g.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 4);
    const bg = g.createLinearGradient(0, 0, 0, PH);
    bg.addColorStop(0, '#04061a'); bg.addColorStop(1, '#1b1b40');
    g.fillStyle = bg; g.fillRect(-10, -10, PW + 20, PH + 20);
    g.drawImage(this.trail, 0, 0);
    this.stars.forEach((st, i) => {
      const p = this.pos(st);
      if (p.x < -4 || p.x > PW + 4 || p.y < -4 || p.y > PH + 4) return;
      const a = 0.75 + 0.25 * Math.sin(this.t * 2 + i);
      if (st.s > 1.6) { g.fillStyle = `rgba(200,215,255,${0.12 * a})`; g.beginPath(); g.arc(p.x, p.y, st.s * 3, 0, TAU); g.fill(); }
      g.fillStyle = `rgba(255,250,235,${a})`; g.beginPath(); g.arc(p.x, p.y, st.s, 0, TAU); g.fill();
    });
    // أفق الكثبان
    g.fillStyle = '#0b0a14';
    g.beginPath(); g.moveTo(0, PH); g.lineTo(0, 372);
    g.bezierCurveTo(120, 340, 220, 392, 340, 366); g.bezierCurveTo(450, 342, 540, 384, PW, 360);
    g.lineTo(PW, PH); g.closePath(); g.fill();
    g.restore();
  }
  click(x, y) {
    if (this.done) return;
    if (dist(x, y, this.pole.x, this.pole.y) <= 14) puzzleSolved();
    else { this.shake = 0.3; puzzleWrong('هذا نجمٌ يدور... ابحث عن الذي لا يترك أثراً.'); }
  }
}

function setPuzzleMsg(t, kind) { const m = $('puzzleMsg'); m.textContent = t; m.className = kind || ''; }
function puzzleSolved() {
  const pz = S.puzzle; if (!pz || pz.done) return;
  pz.done = true; pz.fin = 0;
  pz.site.solved = true; S.pieces++;
  renderPieces(); updateObjective(); Sfx.chime();
  setPuzzleMsg('انكشفت قطعة من الخريطة القديمة!', 'ok');
  spawn(pz.site.x, pz.site.y - 40, 36, { spread: 260, life: 1.4, size: 3, color: '#ffd76a', up: 60 });
}
function puzzleWrong(msg) {
  S.water = Math.max(0, S.water - 4); Sfx.error();
  setPuzzleMsg(msg + ' (−٤ ماء)', 'bad');
  if (S.water <= 0) die();
}
function openPuzzle(site) {
  S.mode = 'puzzle'; joy.x = joy.y = 0; joy.id = null; stick.classList.remove('on');
  actBtn.classList.add('hidden'); S.nearKey = '';
  S.puzzle = site.type === 'ruin' ? new ShadowPuzzle(site) : new StarPuzzle(site);
  $('puzzleTitle').textContent = S.puzzle.title();
  $('puzzleText').textContent = S.puzzle.text();
  $('speedBtn').classList.toggle('hidden', site.type !== 'obs');
  $('speedBtn').textContent = '⏩ تسريع الزمن';
  setPuzzleMsg('', '');
  showScreen('puzzle');
}
function closePuzzle() {
  if (!S || S.mode !== 'puzzle') return;
  S.mode = 'play'; S.puzzle = null; hideScreens();
}
function updatePuzzle(dt) {
  const pz = S.puzzle; if (!pz) return;
  pz.update(dt); pz.draw(pg);
  if (pz.done && pz.fin > 1.25) {
    closePuzzle();
    if (S.pieces >= 5) startMapScene();
    else toast(`حصلتَ على قطعة خريطة (${arNum(S.pieces)}/٥)`);
  }
}

/* =====================================================================
   مشهد تجميع الخريطة
   ===================================================================== */
let mapBase = null, mapAnim = null, mapJag = null;
const MAP_W = 600, MAP_H = 380;
const mapX = (x) => 40 + (x / WORLD) * (MAP_W - 80);
const mapY = (y) => 40 + (y / WORLD) * (MAP_H - 80);

function makeMapBase() {
  const c = mkCanvas(MAP_W, MAP_H), g = c.getContext('2d');
  const rng = mulberry32(S.seed >>> 0);
  const gr = g.createLinearGradient(0, 0, MAP_W, MAP_H);
  gr.addColorStop(0, '#ecd5a2'); gr.addColorStop(1, '#cfa86a');
  g.fillStyle = gr; g.fillRect(0, 0, MAP_W, MAP_H);
  for (let i = 0; i < 14; i++) {
    const x = rng() * MAP_W, y = rng() * MAP_H, r = 30 + rng() * 70;
    const bg = g.createRadialGradient(x, y, 0, x, y, r);
    bg.addColorStop(0, 'rgba(130,85,35,0.16)'); bg.addColorStop(1, 'rgba(130,85,35,0)');
    g.fillStyle = bg; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = 'rgba(120,80,40,0.28)'; g.lineWidth = 1.3;
  for (let k = 0; k < 16; k++) {
    const y0 = 20 + k * 22 + rng() * 8, ph = rng() * 6;
    g.beginPath();
    for (let x = 30; x <= MAP_W - 30; x += 10) {
      const y = y0 + Math.sin(x * 0.03 + ph + k) * 8 + Math.sin(x * 0.011 + k * 2) * 6;
      if (x === 30) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.strokeStyle = 'rgba(90,55,25,0.6)'; g.lineWidth = 3; g.strokeRect(14, 14, MAP_W - 28, MAP_H - 28);
  g.lineWidth = 1; g.strokeRect(22, 22, MAP_W - 44, MAP_H - 44);
  // الواحات الحقيقية
  for (const s of S.sites) {
    if (s.type !== 'oasis') continue;
    const x = mapX(s.x), y = mapY(s.y);
    ell(g, x, y, 11, 7, '#5d9a48'); ell(g, x, y, 7, 4.2, '#4fb3cf');
  }
  // مكان البداية (خيمة)
  const sx = mapX(WORLD / 2), sy = mapY(WORLD / 2);
  g.fillStyle = '#5a3a1c'; g.beginPath(); g.moveTo(sx, sy - 12); g.lineTo(sx + 10, sy + 5); g.lineTo(sx - 10, sy + 5); g.closePath(); g.fill();
  g.fillStyle = 'rgba(90,55,25,0.8)'; g.font = '13px Tahoma, Arial, sans-serif'; g.textAlign = 'center';
  g.fillText('البداية', sx, sy + 20);
  return c;
}
function startMapScene() {
  S.mode = 'map'; showScreen('map');
  $('mapContinue').classList.add('hidden');
  $('mapText').textContent = '';
  mapBase = makeMapBase();
  const rng = mulberry32(S.seed + 5), N = 10;
  mapJag = [];
  for (let b = 0; b <= 5; b++) {
    const row = [];
    for (let m = 0; m <= N; m++) row.push(b === 0 || b === 5 ? 0 : (rng() - 0.5) * 24);
    mapJag.push(row);
  }
  const off = [];
  for (let i = 0; i < 5; i++) off.push({ dx: (rng() - 0.5) * 520, dy: (rng() < 0.5 ? -1 : 1) * (120 + rng() * 120), rot: (rng() - 0.5) * 1.2 });
  mapAnim = { t: 0, off, shown: false };
  Sfx.chime();
}
function piecePath(g, i) {
  const N = 10, w = MAP_W / 5, h = MAP_H;
  g.beginPath();
  g.moveTo(i * w + mapJag[i][0], 0);
  g.lineTo((i + 1) * w + mapJag[i + 1][0], 0);
  for (let m = 1; m <= N; m++) g.lineTo((i + 1) * w + mapJag[i + 1][m], (m * h) / N);
  for (let m = N - 1; m >= 0; m--) g.lineTo(i * w + mapJag[i][m], (m * h) / N);
  g.closePath();
}
function updateMap(dt) {
  const a = mapAnim; if (!a) return;
  a.t += dt;
  const g = mg; g.clearRect(0, 0, MAP_W, MAP_H);
  for (let i = 0; i < 5; i++) {
    const p = clamp((a.t - i * 0.28) / 1.8, 0, 1), e = 1 - Math.pow(1 - p, 3);
    const o = a.off[i];
    g.save();
    g.translate(MAP_W / 2 + o.dx * (1 - e), MAP_H / 2 + o.dy * (1 - e));
    g.rotate(o.rot * (1 - e)); g.translate(-MAP_W / 2, -MAP_H / 2);
    g.shadowColor = `rgba(0,0,0,${0.35 * (1 - e) + 0.1})`; g.shadowBlur = 14;
    piecePath(g, i); g.fillStyle = '#d9b878'; g.fill();
    g.shadowColor = 'transparent';
    piecePath(g, i); g.clip(); g.drawImage(mapBase, 0, 0);
    g.restore();
  }
  if (a.t > 2.6) {
    g.strokeStyle = 'rgba(90,55,25,0.4)'; g.lineWidth = 1;
    for (let i = 0; i < 5; i++) { piecePath(g, i); g.stroke(); }
    const q = clamp((a.t - 2.9) / 0.7, 0, 1);
    const cx = mapX(S.city.x), cy = mapY(S.city.y), r = 11;
    g.strokeStyle = '#b3261e'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - r, cy - r); g.lineTo(cx - r + 2 * r * Math.min(1, q * 2), cy - r + 2 * r * Math.min(1, q * 2)); g.stroke();
    if (q > 0.5) { const q2 = (q - 0.5) * 2; g.beginPath(); g.moveTo(cx + r, cy - r); g.lineTo(cx + r - 2 * r * q2, cy - r + 2 * r * q2); g.stroke(); }
    if (q >= 1) { g.strokeStyle = `rgba(179,38,30,${0.5 + 0.4 * Math.sin(a.t * 4)})`; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 20 + Math.sin(a.t * 4) * 3, 0, TAU); g.stroke(); }
  }
  if (a.t > 3.8 && !a.shown) {
    a.shown = true;
    $('mapText').textContent = 'اكتملت الخريطة! أُضيفت الواحات الحقيقية إلى خريطتك الصغيرة، والبوصلة تشير إلى ✕ حيث ترقد المدينة. اذهب إليها واحفر.';
    $('mapContinue').classList.remove('hidden');
  }
}

/* =====================================================================
   اللعب
   ===================================================================== */
function renderPieces() {
  piecesEl.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const s = document.createElement('span');
    s.textContent = i < S.pieces ? '◆' : '◇';
    if (i < S.pieces) s.className = 'on';
    piecesEl.appendChild(s);
  }
}
function updateObjective() {
  objective.textContent = S.mapComplete
    ? 'اتبع البوصلة إلى ✕ ثم احفر'
    : `قطع الخريطة: ${arNum(S.pieces)}/٥ — ابحث عن الأطلال والمراصد`;
}

let lastWater = -1;
function updateHud() {
  const w = clamp(S.water, 0, 100), r = Math.ceil(w);
  if (r !== lastWater) {
    lastWater = r;
    waterFill.style.width = w + '%'; waterFill.classList.toggle('low', w < 25);
    waterNum.textContent = arNum(r);
  }
  let target = null, label = '';
  if (S.mapComplete) { target = S.city; label = 'المدينة'; }
  else if (S.hint && S.time < S.hint.until) { target = S.hint.site; label = S.hint.label; }
  else S.hint = null;
  compassEl.classList.toggle('hidden', !target);
  if (target) {
    const deg = (Math.atan2(target.x - S.p.x, -(target.y - S.p.y)) * 180) / Math.PI;
    compassArrow.style.transform = `rotate(${deg}deg)`;
    if (compassLabel.textContent !== label) compassLabel.textContent = label;
  }
}

function drawMini() {
  const m = mctx, w = mini.width, sc = w / WORLD;
  m.clearRect(0, 0, w, w);
  m.fillStyle = '#2a1c10'; m.fillRect(0, 0, w, w);
  const cs = ECELL * sc;
  m.fillStyle = '#d9b57a';
  for (let j = 0; j < EG; j++) for (let i = 0; i < EG; i++) if (S.explored[j * EG + i]) m.fillRect(i * cs, j * cs, cs + 0.7, cs + 0.7);
  const dot = (x, y, r, col) => { m.fillStyle = col; m.beginPath(); m.arc(x * sc, y * sc, r, 0, TAU); m.fill(); };
  const dia = (x, y, r, col) => {
    m.fillStyle = col; m.beginPath();
    m.moveTo(x * sc, y * sc - r); m.lineTo(x * sc + r, y * sc); m.lineTo(x * sc, y * sc + r); m.lineTo(x * sc - r, y * sc); m.closePath(); m.fill();
  };
  for (const s of S.sites) {
    if (s.type === 'mirage') { if (!s.vanished && s.seen) dot(s.x, s.y, 4, '#4fb3cf'); }
    else if (s.type === 'oasis') {
      if (s.used) { if (s.seen) dot(s.x, s.y, 3, '#7a6a55'); }
      else if (s.seen || S.mapComplete) dot(s.x, s.y, 4, '#4fb3cf');
    } else if (s.seen) dia(s.x, s.y, 5, s.solved ? '#79d98a' : s.type === 'ruin' ? '#f1c45a' : '#b08cf0');
  }
  if (S.mapComplete) {
    m.strokeStyle = '#ff5a4a'; m.lineWidth = 2.4;
    const x = S.city.x * sc, y = S.city.y * sc;
    m.beginPath(); m.moveTo(x - 5, y - 5); m.lineTo(x + 5, y + 5); m.moveTo(x + 5, y - 5); m.lineTo(x - 5, y + 5); m.stroke();
  }
  const px = S.p.x * sc, py = S.p.y * sc;
  m.fillStyle = '#fff'; m.beginPath(); m.arc(px, py, 3.6, 0, TAU); m.fill();
  m.strokeStyle = '#2a1c10'; m.lineWidth = 1.5; m.stroke();
}

function readInput() {
  let ix = 0, iy = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) ix -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) ix += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW')) iy -= 1;
  if (keys.has('ArrowDown') || keys.has('KeyS')) iy += 1;
  ix += joy.x; iy += joy.y;
  let len = Math.hypot(ix, iy);
  if (len > 1) { ix /= len; iy /= len; len = 1; }
  return { ix, iy, len };
}

function updatePlay(dt) {
  const s = S, p = s.p;
  s.time += dt;
  const { ix, iy, len } = readInput();
  let speed = 0;
  if (len > 0.05) {
    const ux = ix / len, uy = iy / len;
    const slope = sampleH(p.x + ux * 14, p.y + uy * 14) - sampleH(p.x - ux * 14, p.y - uy * 14);
    const mult = clamp(1 - slope * 5, 0.7, 1.25);
    speed = 185 * mult * len;
    const k = Math.min(1, dt * 12);
    p.vx = lerp(p.vx, ux * speed, k); p.vy = lerp(p.vy, uy * speed, k);
  } else {
    const k = Math.min(1, dt * 10);
    p.vx = lerp(p.vx, 0, k); p.vy = lerp(p.vy, 0, k);
  }
  const sp = Math.hypot(p.vx, p.vy);
  p.x = clamp(p.x + p.vx * dt, PAD, WORLD - PAD);
  p.y = clamp(p.y + p.vy * dt, PAD, WORLD - PAD);
  if (Math.abs(p.vx) > 6) p.face = p.vx > 0 ? 1 : -1;
  p.walk += sp * dt * 0.09;
  s.dist += sp * dt;
  // آثار الأقدام
  s.feetAcc += sp * dt;
  if (s.feetAcc > 24) {
    s.feetAcc = 0; s.side = -s.side;
    const a = Math.atan2(p.vy, p.vx);
    s.feet.push({ x: p.x - Math.sin(a) * 4 * s.side, y: p.y + Math.cos(a) * 4 * s.side, a, t0: s.time });
    if (s.feet.length > 220) s.feet.shift();
    Sfx.step();
  }
  reveal(p.x, p.y);
  // الماء
  s.water -= (sp > 20 ? 1.15 : 0.12) * dt;
  if (s.water < 25 && !s.lowWarned) { s.lowWarned = true; toast('الماء يوشك أن ينفد! ابحث عن واحة.'); }
  if (s.water >= 40) s.lowWarned = false;
  // المواقع
  s.near = null; let best = 1e9;
  const seeD = Math.min(W, H) / zoom * 0.5 + 80;
  for (const st of s.sites) {
    const d = dist(p.x, p.y, st.x, st.y);
    if (d < seeD) st.seen = true;
    if (st.type === 'mirage') {
      if (!st.vanished && d < 115) vanishMirage(st);
      if (st.vanished && st.fade > 0) st.fade -= dt * 1.4;
      continue;
    }
    let kind = null;
    if ((st.type === 'ruin' || st.type === 'obs') && !st.solved && d < 85) kind = 'puzzle';
    else if (st.type === 'oasis' && !st.used && d < 85) kind = 'oasis';
    if (kind && d < best) { best = d; s.near = { kind, site: st }; }
  }
  if (s.mapComplete && dist(p.x, p.y, s.city.x, s.city.y) < 90) s.near = { kind: 'dig', site: s.city };
  if (s.mapComplete && Math.random() < dt * 14 && dist(p.x, p.y, s.city.x, s.city.y) < 1000) {
    spawn(s.city.x + (Math.random() - 0.5) * 50, s.city.y, 1, { spread: 20, life: 2, size: 2.2, color: '#ffd76a', up: 50 });
  }
  setNear(s.near);
  if (s.water <= 0) die();
}

function setNear(n) {
  const key = n ? n.kind + n.site.id : '';
  if (key === S.nearKey) return;
  S.nearKey = key;
  if (!n) { actBtn.classList.add('hidden'); return; }
  let label = 'تفاعل';
  if (n.kind === 'oasis') label = 'اشرب';
  else if (n.kind === 'puzzle') label = n.site.type === 'ruin' ? 'افحص الأطلال' : 'ارصد النجوم';
  else if (n.kind === 'dig') label = 'احفر!';
  actBtn.textContent = label + (isTouch ? '' : '  [E]');
  actBtn.classList.remove('hidden');
}

function vanishMirage(st) {
  st.vanished = true; S.water = Math.max(0, S.water - 10);
  spawn(st.x, st.y - 20, 40, { spread: 260, life: 1.1, size: 3, color: '#e9cf99' });
  Sfx.error(); toast('كان سراباً! خسرتَ جزءاً من مائك.');
}

function interact() {
  const s = S;
  if (!s || s.mode !== 'play' || !s.near) return;
  const n = s.near;
  if (n.kind === 'oasis') drink(n.site);
  else if (n.kind === 'puzzle') openPuzzle(n.site);
  else if (n.kind === 'dig') startDig();
}

function drink(site) {
  site.used = true; S.water = 100; S.oases++;
  Sfx.drink();
  spawn(site.x, site.y - 10, 30, { spread: 200, life: 0.9, size: 3, color: '#8be0f2', up: 90, g: 260 });
  let target = null, bd = 1e9;
  for (const st of S.sites) {
    if ((st.type === 'ruin' || st.type === 'obs') && !st.solved) {
      const d = dist(S.p.x, S.p.y, st.x, st.y);
      if (d < bd) { bd = d; target = st; }
    }
  }
  if (target && !S.mapComplete) {
    S.hint = { site: target, until: S.time + 14, label: 'أثر قديم' };
    toast('ارتويت! وبينما ترتشف الماء، لمحتَ أثراً قديماً في الأفق...');
  } else toast('ارتويت! جفّت الواحة بعدك.');
  S.nearKey = '';
}

function startDig() {
  S.mode = 'dig'; S.dig = 0; S.digT = 0;
  actBtn.classList.add('hidden'); S.nearKey = '';
  toast('تحفر في الرمال...', 2600); Sfx.dig();
}
function updateDig(dt) {
  S.dig += dt; S.digT += dt; S.shake = 3;
  S.p.vx = S.p.vy = 0;
  if (S.digT > 0.03) {
    S.digT = 0;
    spawn(S.city.x, S.city.y, 3, { spread: 220, life: 1, size: 3, color: '#e9cf99', up: 120, g: 320 });
  }
  if (S.dig > 2.8) win();
}

function die() {
  if (S.mode === 'end') return;
  S.mode = 'end'; actBtn.classList.add('hidden');
  Sfx.error();
  const box = $('endBox');
  box.innerHTML = `
    <div class="big">🏜️</div>
    <h2>أنهكك العطش</h2>
    <p>ابتلعتك الكثبان قبل أن تصل إلى المدينة. الصحراء لا ترحم من لا يحسب ماءه.</p>
    <div class="stats">
      <div><b>${arNum(S.pieces)}/٥</b>قطع الخريطة</div>
      <div><b>${fmtTime(S.time)}</b>مدة الرحلة</div>
    </div>
    <div class="btns">
      <button id="againSame" class="btn primary">نفس الكثبان</button>
      <button id="againNew" class="btn">كثبان جديدة</button>
      <button id="toTitle" class="btn">القائمة</button>
    </div>`;
  wireEnd(); showScreen('end');
}

const SKY = `<svg viewBox="0 0 400 130" aria-hidden="true"><g fill="currentColor">
<rect x="0" y="108" width="400" height="22"/>
<rect x="36" y="82" width="46" height="26"/><path d="M36 82 q23 -36 46 0z"/><rect x="57" y="48" width="4" height="14"/>
<rect x="104" y="40" width="11" height="68"/><path d="M102 40 l7.5 -24 l7.5 24z"/>
<rect x="146" y="72" width="108" height="36"/><path d="M146 72 q54 -70 108 0z"/><rect x="198" y="14" width="4" height="18"/>
<rect x="283" y="46" width="11" height="62"/><path d="M281 46 l7.5 -24 l7.5 24z"/>
<rect x="318" y="84" width="46" height="24"/><path d="M318 84 q23 -34 46 0z"/>
</g></svg>`;

function win() {
  if (S.mode === 'end') return;
  S.mode = 'end'; Sfx.win();
  const best = parseFloat(store('sarab_best') || '0');
  let bestNote = '';
  if (!best || S.time < best) { store('sarab_best', String(S.time)); bestNote = '<p>🏆 رقم قياسي جديد لك!</p>'; }
  const box = $('endBox');
  box.innerHTML = `
    <div class="skyline">${SKY}</div>
    <h2>وجدتَ المدينة المدفونة</h2>
    <p>انحسرت الرمال عن قباب وأبراج لم يرها أحد منذ قرون... رحلتك لم تذهب سدىً.</p>
    ${bestNote}
    <div class="stats">
      <div><b>${fmtTime(S.time)}</b>مدة الرحلة</div>
      <div><b>${arNum(Math.round(S.dist / 2))} م</b>المسافة</div>
      <div><b>${arNum(S.oases)}</b>واحات شربتَ منها</div>
      <div><b>${arNum(Math.ceil(S.water))}%</b>ماء متبقٍّ</div>
    </div>
    <div class="btns">
      <button id="againNew" class="btn primary">رحلة جديدة</button>
      <button id="againSame" class="btn">نفس الكثبان</button>
      <button id="toTitle" class="btn">القائمة</button>
    </div>`;
  wireEnd(); showScreen('end');
}
function wireEnd() {
  const a = $('againSame'), b = $('againNew'), c = $('toTitle');
  const seed = S.seed, daily = S.daily;
  if (a) a.onclick = () => beginGame(seed, daily);
  if (b) b.onclick = () => beginGame(randSeed(), false);
  if (c) c.onclick = () => toTitle();
}
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return arNum(String(m).padStart(2, '0')) + ':' + arNum(String(s).padStart(2, '0'));
}

/* ---------- بدء اللعبة ---------- */
const randSeed = () => (Math.floor(Math.random() * 4294967294) + 1) >>> 0;
function dailySeed() {
  const d = new Date();
  const n = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  return (Math.imul(n, 2654435761) >>> 0) || 1;
}
function beginGame(seed, daily) {
  Sfx.init();
  showScreen('loading'); hud.classList.add('hidden');
  setTimeout(() => {
    buildTerrain(seed);
    S = newState(seed, daily);
    lastWater = -1;
    renderPieces(); updateObjective();
    hideScreens(); hud.classList.remove('hidden');
    actBtn.classList.add('hidden'); toastEl.classList.remove('show');
    const vw = W / zoom, vh = H / zoom;
    cam.x = clamp(S.p.x - vw / 2, 0, WORLD - vw); cam.y = clamp(S.p.y - vh / 2, 0, WORLD - vh);
    reveal(S.p.x, S.p.y);
    toast(daily ? 'التحدي اليومي: الصحراء نفسها لكل اللاعبين اليوم.' : 'اتبع البوصلة نحو أول واحة. الماء ينقص كلما مشيت.', 4500);
  }, 40);
}
function toTitle() {
  S = null; hud.classList.add('hidden'); actBtn.classList.add('hidden');
  const best = parseFloat(store('sarab_best') || '0');
  $('best').textContent = best ? `أفضل زمن لك: ${fmtTime(best)}` : '';
  showScreen('title');
}

/* =====================================================================
   الرسم
   ===================================================================== */
function updateCamera(dt) {
  const vw = W / zoom, vh = H / zoom;
  if (S) {
    const tx = clamp(S.p.x - vw / 2, 0, WORLD - vw), ty = clamp(S.p.y - vh / 2, 0, WORLD - vh);
    const k = Math.min(1, dt * 6);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
  } else {
    cam.x = clamp(WORLD / 2 - vw / 2 + Math.sin(T * 0.08) * 700, 0, WORLD - vw);
    cam.y = clamp(WORLD / 2 - vh / 2 + Math.cos(T * 0.06) * 700, 0, WORLD - vh);
  }
}

const dust = [];
for (let i = 0; i < 90; i++) dust.push({ x: Math.random() * 3000, y: Math.random() * 2000, sp: Math.random(), ph: Math.random() * 6 });

function glow(x, y, r, rgb, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
function drawSprite(sp, x, y) { ctx.drawImage(sp.c, x - sp.px, y - sp.py); }

function drawMirage(s, t) {
  const sp = sprites.oasis, w = sp.c.width, h = sp.c.height;
  const a = clamp(s.fade, 0, 1) * (0.5 + 0.18 * Math.sin(t * 3 + s.p));
  if (a <= 0) return;
  ctx.globalAlpha = a;
  for (let y = 0; y < h; y += 3) {
    const off = Math.sin(y * 0.22 + t * 5 + s.p) * (5 + 3 * Math.sin(t * 0.7));
    ctx.drawImage(sp.c, 0, y, w, 3, s.x - sp.px + off, s.y - sp.py + y + Math.sin(t * 2 + y * 0.1) * 0.8, w, 3);
  }
  ctx.globalAlpha = 1;
}

function drawOasis(s, t) {
  if (s.used) { drawSprite(sprites.oasisDry, s.x, s.y); return; }
  drawSprite(sprites.oasis, s.x, s.y);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (let k = 0; k < 3; k++) {
    const a = 0.3 + 0.3 * Math.sin(t * 1.5 + k * 2);
    ctx.globalAlpha = Math.max(0, a);
    ell(ctx, s.x - 30 + k * 28, s.y - 6 + (k % 2) * 8, 5, 1.6, '#fff'); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSite(s, t) {
  switch (s.type) {
    case 'ruin':
    case 'obs': {
      const col = s.type === 'ruin' ? '255,205,90' : '170,140,255';
      if (!s.solved) {
        glow(s.x, s.y - 30, 110 + Math.sin(t * 2 + s.p) * 10, col, 0.2);
        ctx.strokeStyle = `rgba(${col},${0.35 + 0.25 * Math.sin(t * 2.4 + s.p)})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(s.x, s.y - 4, 74, 24, 0, 0, TAU); ctx.stroke();
      }
      drawSprite(s.type === 'ruin' ? sprites.ruin : sprites.obs, s.x, s.y);
      if (s.solved) {
        ctx.font = 'bold 26px Arial'; ctx.textAlign = 'center'; ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(30,20,10,0.7)'; ctx.strokeText('✓', s.x, s.y - 125);
        ctx.fillStyle = '#79d98a'; ctx.fillText('✓', s.x, s.y - 125);
      }
      break;
    }
    case 'oasis': drawOasis(s, t); break;
    case 'mirage': if (!s.vanished || s.fade > 0) drawMirage(s, t); break;
  }
}

function drawPlayer(p, t) {
  const mv = Math.min(1, Math.hypot(p.vx, p.vy) / 120);
  const bob = Math.abs(Math.sin(p.walk)) * 2.2 * mv;
  const sw = Math.sin(p.walk) * 5 * mv;
  // وشاح يتطاير
  const tgx = p.x - p.vx * 0.2 - p.face * 8 + Math.sin(t * 5) * 2, tgy = p.y - 30 - p.vy * 0.12 + Math.cos(t * 4) * 2;
  p.scarfX += (tgx - p.scarfX) * 0.2; p.scarfY += (tgy - p.scarfY) * 0.2;
  ctx.save(); ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(70,40,10,0.3)'; ctx.beginPath(); ctx.ellipse(8, 3, 15, 6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#3a281c';
  ctx.beginPath(); ctx.ellipse(-5, sw * 0.4, 4.5, 3, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(5, -sw * 0.4, 4.5, 3, 0, 0, TAU); ctx.fill();
  ctx.translate(0, -bob);
  ctx.strokeStyle = '#c25a3a'; ctx.lineCap = 'round'; ctx.lineWidth = 5;
  const sx = p.scarfX - p.x, sy = p.scarfY - p.y;
  ctx.beginPath(); ctx.moveTo(-p.face * 4, -28); ctx.quadraticCurveTo((sx - p.face * 4) / 2, sy - 8, sx, sy); ctx.stroke();
  const gr = ctx.createLinearGradient(-13, -30, 13, 0); gr.addColorStop(0, '#3a4f8a'); gr.addColorStop(1, '#1d2850');
  ctx.fillStyle = gr;
  ctx.beginPath(); ctx.moveTo(-9, -27); ctx.quadraticCurveTo(0, -33, 9, -27); ctx.lineTo(14, -3); ctx.quadraticCurveTo(0, 2, -14, -3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#d8b04e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-13, -5); ctx.quadraticCurveTo(0, 0, 13, -5); ctx.stroke();
  ctx.fillStyle = '#c98e5c'; ctx.beginPath(); ctx.arc(0, -35, 7, 0, TAU); ctx.fill();
  ctx.fillStyle = '#efe2c2'; ctx.beginPath(); ctx.arc(0, -37, 7.6, Math.PI, TAU); ctx.fill(); ctx.fillRect(-7.6, -37, 15.2, 3);
  ctx.fillStyle = '#2a1a10'; ctx.fillRect(p.face * 3 - 1, -34, 2, 2);
  ctx.restore();
}

function render(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!terrainCanvas) return;
  const vw = W / zoom, vh = H / zoom, k = dpr * zoom;
  let shx = 0, shy = 0;
  if (S && S.shake > 0) { shx = (Math.random() - 0.5) * S.shake; shy = (Math.random() - 0.5) * S.shake; }
  ctx.setTransform(k, 0, 0, k, -(cam.x + shx) * k, -(cam.y + shy) * k);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(terrainCanvas, cam.x / CELL, cam.y / CELL, vw / CELL, vh / CELL, cam.x, cam.y, vw, vh);
  if (!grainPattern) grainPattern = ctx.createPattern(sprites.grain, 'repeat');
  ctx.globalAlpha = 0.3; ctx.fillStyle = grainPattern; ctx.fillRect(cam.x, cam.y, vw, vh); ctx.globalAlpha = 1;

  if (S) {
    // آثار الأقدام
    for (const f of S.feet) {
      const a = clamp(1 - (S.time - f.t0) / 25, 0, 1) * 0.32;
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(110,70,30,${a})`;
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a);
      ctx.beginPath(); ctx.ellipse(0, 0, 5, 2.6, 0, 0, TAU); ctx.fill(); ctx.restore();
    }
    // علامة المدينة وضوء الدلالة
    if (S.mapComplete) {
      const c = S.city, d = dist(S.p.x, S.p.y, c.x, c.y);
      if (d < 1100) {
        const bg = ctx.createLinearGradient(0, c.y - 320, 0, c.y);
        bg.addColorStop(0, 'rgba(255,215,106,0)'); bg.addColorStop(1, `rgba(255,215,106,${0.3 + 0.1 * Math.sin(t * 2)})`);
        ctx.fillStyle = bg; ctx.fillRect(c.x - 30, c.y - 320, 60, 320);
        glow(c.x, c.y, 90, '255,215,106', 0.35);
      }
      ctx.strokeStyle = 'rgba(120,30,20,0.5)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(c.x - 14, c.y - 10); ctx.lineTo(c.x + 14, c.y + 10); ctx.moveTo(c.x + 14, c.y - 10); ctx.lineTo(c.x - 14, c.y + 10); ctx.stroke();
    }
    // الأجسام مرتّبة حسب العمق
    const cx = cam.x + vw / 2, cy = cam.y + vh / 2;
    const items = [];
    for (const st of S.sites) {
      if (Math.abs(st.x - cx) < vw / 2 + 240 && Math.abs(st.y - cy) < vh / 2 + 240) items.push(st);
    }
    items.push({ type: 'player', y: S.p.y });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) { if (it.type === 'player') drawPlayer(S.p, t); else drawSite(it, t); }
    // جسيمات
    for (const p of S.parts) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // غبار الرياح
  const ww = vw + 200;
  ctx.fillStyle = 'rgba(255,240,200,0.28)';
  for (const d of dust) {
    d.x += (0.9 + d.sp * 1.1);
    const rx = (((d.x - cam.x) % ww) + ww) % ww - 100;
    const ry = (((d.y + Math.sin(t * 0.6 + d.ph) * 14 - cam.y) % (vh + 100)) + vh + 100) % (vh + 100);
    ctx.fillRect(cam.x + rx, cam.y + ry, 5 + d.sp * 9, 1.2);
  }

  // تأثيرات الشاشة
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.65);
  vg.addColorStop(0, 'rgba(40,18,4,0)'); vg.addColorStop(1, 'rgba(40,18,4,0.5)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  if (S && S.water < 25 && S.mode !== 'end') {
    const a = ((25 - S.water) / 25) * 0.4 * (0.7 + 0.3 * Math.sin(t * 6));
    const rg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    rg.addColorStop(0, 'rgba(160,20,10,0)'); rg.addColorStop(1, `rgba(160,20,10,${a})`);
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  }
}

/* ---------- الحلقة الرئيسية ---------- */
let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts; T += dt;
  if (S) {
    if (S.shake > 0 && S.mode !== 'dig') S.shake = Math.max(0, S.shake - dt * 10);
    if (S.mode === 'play') updatePlay(dt);
    else if (S.mode === 'dig') updateDig(dt);
    else if (S.mode === 'puzzle') { updatePuzzle(dt); if (S && S.water <= 0) die(); }
    else if (S.mode === 'map') updateMap(dt);
    if (S) updateParts(dt);
  }
  updateCamera(dt);
  render(T);
  if (S && S.mode !== 'end') { updateHud(); drawMini(); }
  requestAnimationFrame(frame);
}

/* ---------- الإدخال ---------- */
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  zoom = clamp(W / 1100, 0.45, 1.5);
}
window.addEventListener('resize', resize);

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && S && S.mode === 'play') e.preventDefault();
  keys.add(e.code);
  if (!S) return;
  if (S.mode === 'play' && !e.repeat && (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter')) interact();
  if (e.code === 'Escape' && S.mode === 'puzzle') closePuzzle();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

canvas.addEventListener('pointerdown', (e) => {
  if (!S || S.mode !== 'play') return;
  Sfx.init();
  joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* تجاهل */ }
  stick.style.left = e.clientX + 'px'; stick.style.top = e.clientY + 'px';
  stick.classList.add('on'); knob.style.transform = 'translate(-50%,-50%)';
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== joy.id) return;
  let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
  const R = 55, l = Math.hypot(dx, dy);
  if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
  joy.x = dx / R; joy.y = dy / R;
  if (Math.hypot(joy.x, joy.y) < 0.18) { joy.x = 0; joy.y = 0; }
  knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
});
const endJoy = (e) => {
  if (e.pointerId !== joy.id) return;
  joy.id = null; joy.x = joy.y = 0; stick.classList.remove('on');
};
canvas.addEventListener('pointerup', endJoy);
canvas.addEventListener('pointercancel', endJoy);

actBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); Sfx.init(); interact(); });

pcv.addEventListener('pointerdown', (e) => {
  if (!S || S.mode !== 'puzzle' || !S.puzzle) return;
  e.preventDefault();
  const r = pcv.getBoundingClientRect();
  S.puzzle.click(((e.clientX - r.left) / r.width) * PW, ((e.clientY - r.top) / r.height) * PH);
});
$('puzzleClose').addEventListener('click', closePuzzle);
$('speedBtn').addEventListener('click', () => {
  const pz = S && S.puzzle; if (!pz || pz.fast === undefined) return;
  pz.fast = !pz.fast;
  $('speedBtn').textContent = pz.fast ? '⏸ زمن عادي' : '⏩ تسريع الزمن';
});
$('mapContinue').addEventListener('click', () => {
  if (!S || S.mode !== 'map') return;
  S.mode = 'play'; S.mapComplete = true; S.hint = null;
  hideScreens(); updateObjective();
  toast('اتبع البوصلة إلى ✕ ثم احفر. الماء ما زال ينقص!', 4000);
});

$('startBtn').addEventListener('click', () => beginGame(randSeed(), false));
$('dailyBtn').addEventListener('click', () => beginGame(dailySeed(), true));
const muteBtn = $('muteBtn');
muteBtn.textContent = Sfx.muted ? '🔇' : '🔊';
muteBtn.addEventListener('click', () => { Sfx.init(); Sfx.setMuted(!Sfx.muted); muteBtn.textContent = Sfx.muted ? '🔇' : '🔊'; });

/* ---------- الإقلاع ---------- */
function boot() {
  resize();
  sprites.oasis = makeOasisSprite(false);
  sprites.oasisDry = makeOasisSprite(true);
  sprites.ruin = makeRuinSprite();
  sprites.obs = makeObsSprite();
  sprites.grain = makeGrain();
  buildTerrain(randSeed());   // خلفية الشاشة الرئيسية
  toTitle();
  requestAnimationFrame(frame);
}
boot();

})();
