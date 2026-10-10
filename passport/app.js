import { SPECS, PRINT_SHEETS } from './specs.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MAX_SRC = 4096;       // longest side kept in memory (iOS canvas limit is ~16.7 MP)
const MAX_PREVIEW = 1600;   // longest side used for live preview + adjustments
const SINGLE_DPI = 600;
const SHEET_DPI = 300;

// ---------- storage (best effort) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- state ----------
const st = {
  customSpecs: store.get('customSpecs', []),
  spec: null,
  full: null, W: 0, H: 0,          // source canvas at full working resolution
  preview: null, pScale: 1,       // downscaled source
  previewProc: null,              // downscaled + adjusted (what we draw)
  adj: { brightness: 0, contrast: 0, shadows: 0, warmth: 0, saturation: 0, lo: 0, hi: 1 },
  tf: { tx: 0, ty: 0, s: 1, rot: 0 },
  crown: null, chin: null, center: null, eyes: null, eyeRoll: 0,
  guides: true, comparing: false,
  view: { w: 0, h: 0, fx: 0, fy: 0, fw: 0, fh: 0, ppm: 1 },
  sBase: 1,
};

const allSpecs = () => [...SPECS, ...st.customSpecs];
function setSpec(id) {
  st.spec = allSpecs().find((s) => s.id === id) || SPECS[0];
  store.set('specId', st.spec.id);
  renderSpecUI();
  if (st.full && !$('#editor').classList.contains('hidden')) { layout(); fitToMarkers(false); }
}

// ---------- UI: spec ----------
function specSub(s) { return `${s.w} × ${s.h} mm · head ${s.headMin}–${s.headMax} mm`; }
function badge(s) {
  const t = s.custom ? 'custom' : s.status;
  return `<span class="badge ${t}">${t === 'official' ? 'OFFICIAL' : t === 'approx' ? 'VERIFY' : 'CUSTOM'}</span>`;
}
function renderSpecUI() {
  const s = st.spec;
  $('#homeSpec').innerHTML = `<span class="flag">${s.flag}</span><span class="meta"><div class="title">${esc(s.name)}</div><div class="sub">${specSub(s)}</div></span><span class="chev">›</span>`;
  $('#edSpec').innerHTML = `<span>${s.flag}</span><span>${esc(s.name)}</span>`;
  $('#specList').innerHTML = allSpecs().map((x) => `
    <button class="spec-item ${x.id === s.id ? 'sel' : ''}" data-id="${x.id}">
      <span class="flag">${x.flag}</span>
      <span class="meta"><div class="title">${esc(x.name)} ${badge(x)}</div><div class="sub">${specSub(x)}</div></span>
    </button>`).join('');
  const notes = (s.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');
  $('#specDetail').innerHTML = `
    <div><b>Background:</b> ${esc(s.background || '—')}</div>
    ${notes ? `<ul>${notes}</ul>` : ''}
    ${s.status === 'approx' ? '<div style="color:var(--warn)">Head-size range is not from an official source. Verify before submitting.</div>' : ''}
    ${s.source ? `<div>Source: <a href="${esc(s.source)}" target="_blank" rel="noopener">${esc(s.source)}</a></div>` : ''}
    ${s.custom ? `<button class="btn small" data-del="${s.id}">Delete this custom format</button>` : ''}`;
}
function esc(t) { return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function openSheet() { $('#specSheet').classList.add('open'); }
function closeSheet() { $('#specSheet').classList.remove('open'); $('#customForm').classList.add('hidden'); }
$('#homeSpec').onclick = openSheet;
$('#edSpec').onclick = openSheet;
$('#specSheet').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) return closeSheet();
  const item = e.target.closest('.spec-item');
  if (item) { setSpec(item.dataset.id); return; }
  const del = e.target.closest('[data-del]');
  if (del) {
    st.customSpecs = st.customSpecs.filter((x) => x.id !== del.dataset.del);
    store.set('customSpecs', st.customSpecs);
    setSpec(SPECS[0].id);
  }
});
$('#btnAddCustom').onclick = () => $('#customForm').classList.toggle('hidden');
$('#customForm').onsubmit = (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const n = (k) => parseFloat(f.get(k));
  const spec = {
    id: 'custom-' + Date.now(), custom: true, status: 'custom',
    name: f.get('name').trim(), flag: f.get('flag') || '🏳️',
    w: n('w'), h: n('h'), headMin: Math.min(n('headMin'), n('headMax')), headMax: Math.max(n('headMin'), n('headMax')),
    topRatio: 0.4, bg: f.get('bg'), background: 'Custom', source: f.get('source') || '', notes: [],
  };
  if (!(spec.w > 0 && spec.h > 0 && spec.headMax < spec.h)) { toast('Check the numbers'); return; }
  st.customSpecs.push(spec);
  store.set('customSpecs', st.customSpecs);
  e.target.reset();
  setSpec(spec.id);
};

// ---------- screens ----------
function show(id) { for (const s of ['home', 'camera', 'editor']) $('#' + s).classList.toggle('hidden', s !== id); }
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
const busy = (on) => $('#busy').classList.toggle('hidden', !on);

// ---------- loading ----------
$('#btnLibrary').onclick = () => $('#fileInput').click();
$('#camLib').onclick = () => { stopCamera(); $('#fileInput').click(); };
$('#fileInput').onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  busy(true);
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    await loadSource(img, img.naturalWidth, img.naturalHeight);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err); toast('Could not open that image'); show('home');
  } finally { busy(false); }
};

function scaledCanvas(src, sw, sh, maxSide) {
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

async function loadSource(src, sw, sh) {
  st.full = scaledCanvas(src, sw, sh, MAX_SRC);
  st.W = st.full.width; st.H = st.full.height;
  st.preview = scaledCanvas(st.full, st.W, st.H, MAX_PREVIEW);
  st.pScale = st.preview.width / st.W;
  st.previewProc = document.createElement('canvas');
  st.previewProc.width = st.preview.width; st.previewProc.height = st.preview.height;
  Object.assign(st.adj, { brightness: 0, contrast: 0, shadows: 0, warmth: 0, saturation: 0, lo: 0, hi: 1 });
  syncAdjSliders();
  applyAdjustments();
  st.eyes = null; st.center = null;
  // Default markers: plausible head in the middle of the photo.
  st.crown = { x: st.W / 2, y: st.H * 0.22 };
  st.chin = { x: st.W / 2, y: st.H * 0.62 };
  st.tf.rot = 0;
  show('editor');
  selectTab('align');
  layout();
  fitToMarkers(false);
  autoDetect(true);
}

// ---------- adjustments (LUT based, fast) ----------
function buildLuts(a) {
  const R = new Uint8ClampedArray(256), G = new Uint8ClampedArray(256), B = new Uint8ClampedArray(256);
  const b = a.brightness / 100 * 0.25, c = a.contrast / 100 * 0.6, sh = a.shadows / 100, w = a.warmth / 100 * 0.08;
  const span = Math.max(0.05, a.hi - a.lo);
  for (let v = 0; v < 256; v++) {
    let x = (v / 255 - a.lo) / span;
    x = clamp(x, 0, 1);
    x += sh * 2.2 * x * (1 - x) * (1 - x);          // lift / crush shadows, leaves highlights alone
    x += b;
    x = (x - 0.5) * (1 + c) + 0.5;
    x = clamp(x, 0, 1) * 255;
    R[v] = x * (1 + w); G[v] = x; B[v] = x * (1 - w);
  }
  return { R, G, B, sat: 1 + a.saturation / 100 };
}
function adjIsIdentity(a) {
  return !a.brightness && !a.contrast && !a.shadows && !a.warmth && !a.saturation && a.lo === 0 && a.hi === 1;
}
function processImageData(d, luts) {
  const { R, G, B, sat } = luts, p = d.data, n = p.length;
  if (sat === 1) {
    for (let i = 0; i < n; i += 4) { p[i] = R[p[i]]; p[i + 1] = G[p[i + 1]]; p[i + 2] = B[p[i + 2]]; }
  } else {
    for (let i = 0; i < n; i += 4) {
      const r = R[p[i]], g = G[p[i + 1]], b = B[p[i + 2]];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      p[i] = l + (r - l) * sat; p[i + 1] = l + (g - l) * sat; p[i + 2] = l + (b - l) * sat;
    }
  }
}
function applyAdjustments() {
  const ctx = st.previewProc.getContext('2d');
  ctx.drawImage(st.preview, 0, 0);
  if (!adjIsIdentity(st.adj)) {
    const d = ctx.getImageData(0, 0, st.previewProc.width, st.previewProc.height);
    processImageData(d, buildLuts(st.adj));
    ctx.putImageData(d, 0, 0);
  }
  requestDraw();
}
let adjPending = false;
function scheduleAdjust() {
  if (adjPending) return; adjPending = true;
  requestAnimationFrame(() => { adjPending = false; applyAdjustments(); });
}
for (const el of $$('[data-adj]')) {
  el.addEventListener('input', () => { st.adj[el.dataset.adj] = +el.value; el.nextElementSibling.textContent = el.value; scheduleAdjust(); });
}
function syncAdjSliders() {
  for (const el of $$('[data-adj]')) { el.value = st.adj[el.dataset.adj]; el.nextElementSibling.textContent = el.value; }
}
$('#btnResetAdj').onclick = () => { Object.assign(st.adj, { brightness: 0, contrast: 0, shadows: 0, warmth: 0, saturation: 0, lo: 0, hi: 1 }); syncAdjSliders(); applyAdjustments(); };
$('#btnAuto').onclick = autoEnhance;

function autoEnhance() {
  const c = st.preview, ctx = c.getContext('2d');
  const all = ctx.getImageData(0, 0, c.width, c.height).data;
  const hist = new Uint32Array(256); let total = 0;
  for (let i = 0; i < all.length; i += 16) { hist[(all[i] * 77 + all[i + 1] * 150 + all[i + 2] * 29) >> 8]++; total++; }
  const pct = (h, t, q) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= t * q) return v / 255; } return 1; };
  const lo = Math.min(pct(hist, total, 0.005), 0.12), hi = Math.max(pct(hist, total, 0.995), 0.82);

  // Face luminance: area between the markers (or image centre).
  const cx = (st.center || st.chin).x * st.pScale;
  const top = st.crown.y * st.pScale, bot = st.chin.y * st.pScale;
  const hh = Math.abs(bot - top), y0 = Math.round(top + hh * 0.3), y1 = Math.round(bot - hh * 0.1);
  const x0 = Math.round(cx - hh * 0.22), x1 = Math.round(cx + hh * 0.22);
  const fh = new Uint32Array(256); let ft = 0;
  if (x1 > x0 && y1 > y0) {
    const d = ctx.getImageData(clamp(x0, 0, c.width - 1), clamp(y0, 0, c.height - 1), Math.max(1, Math.min(x1, c.width) - Math.max(x0, 0)), Math.max(1, Math.min(y1, c.height) - Math.max(y0, 0))).data;
    for (let i = 0; i < d.length; i += 8) { fh[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++; ft++; }
  }
  let med = ft ? pct(fh, ft, 0.5) : pct(hist, total, 0.5);
  med = clamp((med - lo) / (hi - lo), 0, 1);
  const target = 0.58;
  Object.assign(st.adj, {
    lo, hi,
    brightness: Math.round(clamp((target - med) / 0.25 * 45, -40, 40)),
    shadows: med < 0.45 ? Math.round(clamp((0.45 - med) * 160, 0, 45)) : 0,
    contrast: 8,
    warmth: 0,
    saturation: 0,
  });
  syncAdjSliders();
  applyAdjustments();
  toast('Lighting enhanced');
}

// ---------- geometry ----------
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
const stage = $('#stage');

function layout() {
  const r = stage.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  const v = st.view; v.w = r.width; v.h = r.height; v.dpr = dpr;
  const pad = 26, s = st.spec;
  const k = Math.min((r.width - pad * 2) / s.w, (r.height - pad * 2) / s.h);
  v.fw = s.w * k; v.fh = s.h * k; v.ppm = k;
  v.fx = (r.width - v.fw) / 2; v.fy = (r.height - v.fh) / 2;
  st.sBase = v.fh / st.H;
  requestDraw();
}
// Keep the composition (in mm) stable when the stage changes size (rotation, dock height).
new ResizeObserver(() => {
  if (!st.full || $('#editor').classList.contains('hidden')) return;
  const old = st.view.ppm;
  layout();
  const k = st.view.ppm / old;
  st.tf.s *= k; st.tf.tx *= k; st.tf.ty *= k;
  syncAlignSliders();
}).observe(stage);

function frameCenter() { const v = st.view; return { x: v.fx + v.fw / 2, y: v.fy + v.fh / 2 }; }
function toScreen(p) {
  const { tx, ty, s, rot } = st.tf, c = frameCenter();
  const dx = (p.x - st.W / 2) * s, dy = (p.y - st.H / 2) * s;
  const co = Math.cos(rot), si = Math.sin(rot);
  return { x: c.x + tx + dx * co - dy * si, y: c.y + ty + dx * si + dy * co };
}
function toImage(q) {
  const { tx, ty, s, rot } = st.tf, c = frameCenter();
  const dx = q.x - c.x - tx, dy = q.y - c.y - ty;
  const co = Math.cos(-rot), si = Math.sin(-rot);
  return { x: (dx * co - dy * si) / s + st.W / 2, y: (dx * si + dy * co) / s + st.H / 2 };
}

// Spec layout in mm (from top of photo).
function specGeom(s = st.spec) {
  const target = (s.headMin + s.headMax) / 2;
  const top = (s.h - target) * (s.topRatio ?? 0.4);
  const chin = top + target;
  return { target, chin, crownMin: chin - s.headMax, crownMax: chin - s.headMin };
}

// Place image so that crown/chin markers match the spec's target head height.
function fitToMarkers(announce = true) {
  if (!st.crown || !st.chin) return;
  const g = specGeom(), v = st.view, rot = st.tf.rot;
  const co = Math.cos(rot), si = Math.sin(rot);
  const vx = st.chin.x - st.crown.x, vy = st.chin.y - st.crown.y;
  const headPx = Math.max(10, vx * si + vy * co);     // vertical extent after rotation
  const s = g.target * v.ppm / headPx;
  st.tf.s = s; st.tf.tx = 0; st.tf.ty = 0;
  const chinS = toScreen(st.chin);
  const midRef = st.center || { x: (st.crown.x + st.chin.x) / 2, y: (st.crown.y + st.chin.y) / 2 };
  const midS = toScreen(midRef);
  const c = frameCenter();
  st.tf.tx = c.x - midS.x;
  st.tf.ty = v.fy + g.chin * v.ppm - chinS.y;
  syncAlignSliders();
  requestDraw();
  if (announce) toast('Fitted to markers');
}
$('#btnFit').onclick = () => fitToMarkers(true);

// ---------- face detection (MediaPipe, on-device, lazy) ----------
let landmarkerP = null;
function getLandmarker() {
  if (!landmarkerP) {
    landmarkerP = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import('./vendor/vision_bundle.mjs');
      const fileset = await FilesetResolver.forVisionTasks(new URL('./vendor/wasm', location.href).href);
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: new URL('./vendor/face_landmarker.task', location.href).href, delegate: 'CPU' },
        runningMode: 'IMAGE', numFaces: 1,
      });
    })();
    landmarkerP.catch(() => { landmarkerP = null; });
  }
  return landmarkerP;
}
async function autoDetect(silent = false) {
  const btn = $('#btnDetect');
  btn.disabled = true; btn.textContent = 'Detecting…';
  try {
    const lm = await getLandmarker();
    const res = lm.detect(st.preview);
    const pts = res.faceLandmarks && res.faceLandmarks[0];
    if (!pts) { toast('No face found — place markers manually'); return; }
    const P = (i) => ({ x: pts[i].x * st.W, y: pts[i].y * st.H });
    const avg = (...a) => ({ x: a.reduce((s, p) => s + p.x, 0) / a.length, y: a.reduce((s, p) => s + p.y, 0) / a.length });
    const eL = pts.length > 473 ? P(468) : avg(P(33), P(133));
    const eR = pts.length > 473 ? P(473) : avg(P(263), P(362));
    const [left, right] = eL.x < eR.x ? [eL, eR] : [eR, eL];
    st.tf.rot = st.eyeRoll = -Math.atan2(right.y - left.y, right.x - left.x);
    const chin = P(152), brow = P(10);
    // Landmark 10 sits near the hairline; the crown is ~28 % of the chin–hairline distance above it.
    st.chin = chin;
    st.crown = { x: chin.x + (brow.x - chin.x) * 1.28, y: chin.y + (brow.y - chin.y) * 1.28 };
    st.center = avg(P(168), P(1), P(152));       // nose bridge, tip, chin: face midline
    st.eyes = avg(eL, eR);
    fitToMarkers(false);
    toast(silent ? 'Face aligned — check the crown marker' : 'Face aligned');
  } catch (err) {
    console.warn(err);
    if (!silent) toast('Face detection unavailable — use markers');
  } finally {
    btn.disabled = false; btn.textContent = '✨ Auto-align face';
  }
}
$('#btnDetect').onclick = () => autoDetect(false);

// ---------- compliance ----------
function evaluate() {
  const s = st.spec, v = st.view, g = specGeom();
  const out = [];
  const cr = toScreen(st.crown), ch = toScreen(st.chin);
  const headMm = Math.hypot(ch.x - cr.x, ch.y - cr.y) / v.ppm;
  out.push({ ok: headMm >= s.headMin && headMm <= s.headMax ? 'ok' : 'bad', t: `Head ${headMm.toFixed(1)} mm (${s.headMin}–${s.headMax})` });
  const topMm = (Math.min(cr.y, ch.y) - v.fy) / v.ppm;
  out.push({ ok: topMm >= 1.5 ? 'ok' : topMm >= 0 ? 'warn' : 'bad', t: `Top gap ${topMm.toFixed(1)} mm` });
  const midX = st.center ? toScreen(st.center).x : (cr.x + ch.x) / 2;
  const offMm = (midX - (v.fx + v.fw / 2)) / v.ppm;
  out.push({ ok: Math.abs(offMm) <= 1 ? 'ok' : Math.abs(offMm) <= 2 ? 'warn' : 'bad', t: Math.abs(offMm) <= 1 ? 'Centred' : `Off-centre ${offMm.toFixed(1)} mm` });
  const tilt = Math.atan2(ch.x - cr.x, ch.y - cr.y) * 180 / Math.PI;
  if (st.eyes) {
    const deg = (st.tf.rot - st.eyeRoll) * 180 / Math.PI;
    out.push({ ok: Math.abs(deg) <= 2 ? 'ok' : 'warn', t: `Eyes ${Math.abs(deg) <= 0.5 ? 'level' : deg.toFixed(1) + '°'}` });
  } else {
    out.push({ ok: Math.abs(tilt) <= 3 ? 'ok' : 'warn', t: `Head tilt ${tilt.toFixed(1)}°` });
  }
  if (s.eyesFromBottom && st.eyes) {
    const e = (v.fy + v.fh - toScreen(st.eyes).y) / v.ppm, [a, b] = s.eyesFromBottom;
    out.push({ ok: e >= a && e <= b ? 'ok' : 'bad', t: `Eyes ${e.toFixed(1)} mm from bottom` });
  }
  // Frame must be covered by the photo.
  const corners = [[v.fx, v.fy], [v.fx + v.fw, v.fy], [v.fx, v.fy + v.fh], [v.fx + v.fw, v.fy + v.fh]];
  const covered = corners.every(([x, y]) => { const p = toImage({ x, y }); return p.x >= 0 && p.y >= 0 && p.x <= st.W && p.y <= st.H; });
  if (!covered) out.push({ ok: 'warn', t: 'Edge filled with background' });
  const srcPpmm = v.ppm / st.tf.s;        // source pixels per output mm
  const dpi = srcPpmm * 25.4;
  out.push({ ok: dpi >= 300 ? 'ok' : dpi >= 200 ? 'warn' : 'bad', t: `${Math.round(dpi)} dpi source` });
  return out;
}
let lastChips = '';
function renderChips() {
  const html = evaluate().map((c) => `<span class="chip ${c.ok}"><i></i>${c.t}</span>`).join('');
  if (html !== lastChips) { $('#chips').innerHTML = html; lastChips = html; }
}

// ---------- drawing ----------
let drawPending = false;
function requestDraw() {
  if (drawPending) return; drawPending = true;
  requestAnimationFrame(() => { drawPending = false; draw(); });
}
function draw() {
  if (!st.full) return;
  const v = st.view, s = st.spec, g = specGeom();
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  ctx.fillStyle = '#0b0b0d'; ctx.fillRect(0, 0, v.w, v.h);

  // background colour inside frame (visible where the photo doesn't reach)
  ctx.fillStyle = s.bg || '#fff'; ctx.fillRect(v.fx, v.fy, v.fw, v.fh);

  const c = frameCenter();
  ctx.save();
  ctx.translate(c.x + st.tf.tx, c.y + st.tf.ty);
  ctx.rotate(st.tf.rot);
  ctx.scale(st.tf.s, st.tf.s);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(st.comparing ? st.preview : st.previewProc, -st.W / 2, -st.H / 2, st.W, st.H);
  ctx.restore();

  // dim outside
  ctx.beginPath();
  ctx.rect(0, 0, v.w, v.h); ctx.rect(v.fx, v.fy, v.fw, v.fh);
  ctx.fillStyle = 'rgba(11,11,13,0.78)'; ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
  ctx.strokeRect(v.fx + 0.5, v.fy + 0.5, v.fw - 1, v.fh - 1);

  if (st.guides) {
    const y = (mm) => v.fy + mm * v.ppm;
    // crown tolerance band
    ctx.fillStyle = 'rgba(48,209,88,0.16)';
    ctx.fillRect(v.fx, y(g.crownMin), v.fw, (g.crownMax - g.crownMin) * v.ppm);
    ctx.strokeStyle = 'rgba(48,209,88,0.75)'; ctx.setLineDash([5, 4]);
    line(v.fx, y(g.crownMin), v.fx + v.fw, y(g.crownMin));
    line(v.fx, y(g.crownMax), v.fx + v.fw, y(g.crownMax));
    // chin line
    ctx.setLineDash([]); ctx.strokeStyle = 'rgba(48,209,88,0.95)'; ctx.lineWidth = 1.5;
    line(v.fx, y(g.chin), v.fx + v.fw, y(g.chin));
    // centre line
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
    line(c.x, v.fy, c.x, v.fy + v.fh);
    // eye band (where defined)
    if (s.eyesFromBottom) {
      const [a, b] = s.eyesFromBottom;
      ctx.setLineDash([]); ctx.fillStyle = 'rgba(10,132,255,0.14)';
      ctx.fillRect(v.fx, y(s.h - b), v.fw, (b - a) * v.ppm);
    }
    // face oval ghost
    ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    const ovH = g.target * v.ppm, ovW = ovH * 0.74;
    ctx.beginPath(); ctx.ellipse(c.x, y(g.chin) - ovH / 2, ovW / 2, ovH / 2, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // labels
    ctx.font = '600 10px -apple-system, sans-serif'; ctx.fillStyle = 'rgba(48,209,88,0.95)';
    ctx.textAlign = 'right';
    ctx.fillText('CROWN', v.fx - 6, y((g.crownMin + g.crownMax) / 2) + 3);
    ctx.fillText('CHIN', v.fx - 6, y(g.chin) + 3);
  }
  // markers
  if (!st.comparing) { marker(toScreen(st.crown), 'Crown'); marker(toScreen(st.chin), 'Chin'); }

  // dimension label
  ctx.font = '500 11px -apple-system, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.textAlign = 'center';
  ctx.fillText(`${s.w} × ${s.h} mm`, c.x, v.fy + v.fh + 16);
  renderChips();
}
function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function marker(p, label) {
  ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 2;
  line(p.x - 34, p.y, p.x + 34, p.y);
  ctx.beginPath(); ctx.arc(p.x + 46, p.y, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd60a'; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#ffd60a'; ctx.font = '700 10px -apple-system, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(label.toUpperCase(), p.x + 60, p.y + 3.5);
}
const knobPos = (p) => ({ x: p.x + 46, y: p.y });

// ---------- gestures ----------
const ptrs = new Map();
let gesture = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  stage.setPointerCapture(e.pointerId);
  const r = stage.getBoundingClientRect();
  const p = { x: e.clientX - r.left, y: e.clientY - r.top };
  ptrs.set(e.pointerId, p);
  if (ptrs.size === 1) {
    const hit = ['crown', 'chin'].find((k) => {
      const m = toScreen(st[k]), kp = knobPos(m);
      return Math.hypot(kp.x - p.x, kp.y - p.y) < 26 || (Math.abs(m.y - p.y) < 14 && Math.abs(m.x - p.x) < 40);
    });
    gesture = hit ? { type: 'marker', key: hit, off: { x: toScreen(st[hit]).x - p.x, y: toScreen(st[hit]).y - p.y } } : { type: 'pan', last: p };
  } else if (ptrs.size === 2) {
    gesture = { type: 'pinch', ...pinchInfo() };
  }
});
stage.addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId)) return;
  const r = stage.getBoundingClientRect();
  const p = { x: e.clientX - r.left, y: e.clientY - r.top };
  ptrs.set(e.pointerId, p);
  if (!gesture) return;
  if (gesture.type === 'marker') {
    st[gesture.key] = toImage({ x: p.x + gesture.off.x, y: p.y + gesture.off.y });
  } else if (gesture.type === 'pan') {
    st.tf.tx += p.x - gesture.last.x; st.tf.ty += p.y - gesture.last.y; gesture.last = p;
  } else if (gesture.type === 'pinch' && ptrs.size >= 2) {
    const now = pinchInfo();
    const f = now.d / gesture.d;
    let da = now.a - gesture.a;
    if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    transformAbout(gesture.m, now.m, f, da);
    Object.assign(gesture, now);
    syncAlignSliders();
  }
  requestDraw();
});
const endPtr = (e) => {
  ptrs.delete(e.pointerId);
  if (ptrs.size === 1 && gesture?.type === 'pinch') gesture = { type: 'pan', last: [...ptrs.values()][0] };
  else if (ptrs.size === 0) gesture = null;
};
stage.addEventListener('pointerup', endPtr);
stage.addEventListener('pointercancel', endPtr);
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = stage.getBoundingClientRect(), m = { x: e.clientX - r.left, y: e.clientY - r.top };
  transformAbout(m, m, Math.exp(-e.deltaY * 0.0015), 0); syncAlignSliders(); requestDraw();
}, { passive: false });

function pinchInfo() {
  const [a, b] = [...ptrs.values()];
  return { m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), a: Math.atan2(b.y - a.y, b.x - a.x) };
}
// Scale by f and rotate by da around screen point mOld, moving it to mNew.
function transformAbout(mOld, mNew, f, da) {
  const sNew = clamp(st.tf.s * f, st.sBase * 0.2, st.sBase * 16);
  f = sNew / st.tf.s;
  const c = frameCenter();
  const px = c.x + st.tf.tx - mOld.x, py = c.y + st.tf.ty - mOld.y;
  const co = Math.cos(da), si = Math.sin(da);
  st.tf.tx = mNew.x + (px * co - py * si) * f - c.x;
  st.tf.ty = mNew.y + (px * si + py * co) * f - c.y;
  st.tf.s = sNew; st.tf.rot += da;
}

// ---------- align sliders ----------
const rotEl = $('#rot'), zoomEl = $('#zoom');
function syncAlignSliders() {
  const deg = st.tf.rot * 180 / Math.PI;
  rotEl.value = clamp(Math.round(deg * 10), -200, 200);
  $('#rotOut').textContent = deg.toFixed(1) + '°';
  const z = st.tf.s / st.sBase;
  zoomEl.value = clamp(Math.round(300 + Math.log2(z) * 200), 0, 1000);
  $('#zoomOut').textContent = z.toFixed(2) + '×';
}
rotEl.addEventListener('input', () => {
  const c = frameCenter();
  transformAbout(c, c, 1, (rotEl.value / 10) * Math.PI / 180 - st.tf.rot);
  $('#rotOut').textContent = (rotEl.value / 10).toFixed(1) + '°';
  requestDraw();
});
zoomEl.addEventListener('input', () => {
  const c = frameCenter();
  const target = st.sBase * Math.pow(2, (zoomEl.value - 300) / 200);
  transformAbout(c, c, target / st.tf.s, 0);
  $('#zoomOut').textContent = (st.tf.s / st.sBase).toFixed(2) + '×';
  requestDraw();
});

// ---------- tabs & toggles ----------
function selectTab(t) {
  for (const b of $$('#seg button')) b.classList.toggle('active', b.dataset.tab === t);
  for (const p of $$('.panel')) p.classList.toggle('hidden', p.dataset.panel !== t);
  if (t === 'export') updateExportPreview();
}
$('#seg').onclick = (e) => { const b = e.target.closest('button'); if (b) selectTab(b.dataset.tab); };
$('#edGuides').onclick = (e) => { st.guides = !st.guides; e.currentTarget.classList.toggle('on', st.guides); requestDraw(); };
$('#edBack').onclick = () => show('home');
const cmp = $('#compare');
const cmpOn = (e) => { e.preventDefault(); st.comparing = true; requestDraw(); };
const cmpOff = () => { st.comparing = false; requestDraw(); };
cmp.addEventListener('pointerdown', cmpOn); cmp.addEventListener('pointerup', cmpOff);
cmp.addEventListener('pointerleave', cmpOff); cmp.addEventListener('pointercancel', cmpOff);

// ---------- export ----------
function renderPhoto(dpi, spec = st.spec) {
  const ppmOut = dpi / 25.4;
  const w = Math.round(spec.w * ppmOut), h = Math.round(spec.h * ppmOut);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = spec.bg || '#fff'; x.fillRect(0, 0, w, h);
  const v = st.view, k = ppmOut / v.ppm;
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.translate(w / 2 + st.tf.tx * k, h / 2 + st.tf.ty * k);
  x.rotate(st.tf.rot);
  x.scale(st.tf.s * k, st.tf.s * k);
  // Downsample in steps when shrinking a lot, to avoid aliasing.
  let src = st.full;
  const shrink = st.tf.s * k;
  if (shrink < 0.5) src = scaledCanvas(st.full, st.W, st.H, Math.max(st.W, st.H) * Math.max(shrink * 2, 0.05));
  x.drawImage(src, -st.W / 2, -st.H / 2, st.W, st.H);
  x.setTransform(1, 0, 0, 1, 0, 0);
  if (!adjIsIdentity(st.adj)) {
    const d = x.getImageData(0, 0, w, h);
    processImageData(d, buildLuts(st.adj));
    x.putImageData(d, 0, 0);
  }
  return c;
}

function renderSheet(sheet) {
  const s = st.spec, dpi = SHEET_DPI, ppm = dpi / 25.4, gap = 2, margin = 2;
  const options = [{ w: sheet.w, h: sheet.h }, { w: sheet.h, h: sheet.w }].map((o) => {
    const cols = Math.floor((o.w - 2 * margin + gap) / (s.w + gap));
    const rows = Math.floor((o.h - 2 * margin + gap) / (s.h + gap));
    return { ...o, cols, rows, n: Math.max(0, cols) * Math.max(0, rows) };
  });
  const L = options[0].n >= options[1].n ? options[0] : options[1];
  if (!L.n) return null;
  const c = document.createElement('canvas');
  c.width = Math.round(L.w * ppm); c.height = Math.round(L.h * ppm);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  const photo = renderPhoto(dpi);
  const gw = L.cols * s.w + (L.cols - 1) * gap, gh = L.rows * s.h + (L.rows - 1) * gap;
  const ox = (L.w - gw) / 2, oy = (L.h - gh) / 2;
  x.strokeStyle = '#b8b8b8'; x.lineWidth = 1;
  for (let r = 0; r < L.rows; r++) for (let q = 0; q < L.cols; q++) {
    const px = Math.round((ox + q * (s.w + gap)) * ppm), py = Math.round((oy + r * (s.h + gap)) * ppm);
    x.drawImage(photo, px, py, photo.width, photo.height);
    x.strokeRect(px - 0.5, py - 0.5, photo.width + 1, photo.height + 1);
  }
  x.fillStyle = '#888'; x.font = `${Math.round(2.2 * ppm)}px -apple-system, Helvetica, sans-serif`;
  x.fillText(`${s.name} · ${s.w}×${s.h} mm · print at 100% (${dpi} dpi)`, Math.round(margin * ppm * 0.5), c.height - Math.round(margin * ppm * 0.35));
  return { canvas: c, n: L.n };
}

async function shareCanvas(c, name) {
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
  const file = new File([blob], name, { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const slug = () => st.spec.id + '-' + new Date().toISOString().slice(0, 10);
$('#btnSingle').onclick = async () => {
  busy(true);
  try { await shareCanvas(renderPhoto(SINGLE_DPI), `${slug()}.jpg`); } finally { busy(false); }
};
$('#btnSheet').onclick = async () => {
  busy(true);
  try {
    const sheet = PRINT_SHEETS.find((p) => p.id === $('#sheetSize').value) || PRINT_SHEETS[0];
    const out = renderSheet(sheet);
    if (!out) { toast('Format does not fit on this sheet'); return; }
    await shareCanvas(out.canvas, `${slug()}-${sheet.id}.jpg`);
  } finally { busy(false); }
};
$('#sheetSize').innerHTML = PRINT_SHEETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
$('#sheetSize').onchange = updateExportPreview;
function updateExportPreview() {
  if (!st.full) return;
  const c = renderPhoto(150);
  $('#expPreview').src = c.toDataURL('image/jpeg', 0.85);
  const s = st.spec, ppm = SINGLE_DPI / 25.4;
  const sheet = PRINT_SHEETS.find((p) => p.id === $('#sheetSize').value) || PRINT_SHEETS[0];
  const fit = (o) => Math.floor((o.w - 2) / (s.w + 2)) * Math.floor((o.h - 2) / (s.h + 2));
  const n = Math.max(fit(sheet), fit({ w: sheet.h, h: sheet.w }));
  $('#expInfo').innerHTML = `Single: ${Math.round(s.w * ppm)} × ${Math.round(s.h * ppm)} px (${SINGLE_DPI} dpi)<br>Sheet: ${n} photos on ${sheet.name}`;
}

// ---------- live camera ----------
let stream = null, facing = 'environment', timerOn = false;
const video = $('#video'), camOv = $('#camOverlay');
$('#btnCamera').onclick = startCamera;
$('#camClose').onclick = () => { stopCamera(); show('home'); };
$('#camFlip').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; startCamera(); };
$('#camTimer').onclick = (e) => { timerOn = !timerOn; e.currentTarget.classList.toggle('on', timerOn); toastCam(timerOn ? '3 s timer on' : 'Timer off'); };
function toastCam(m) { $('#camHint').textContent = m; setTimeout(() => { $('#camHint').textContent = 'Fit your face in the oval · eyes level · look into the lens'; }, 1500); }

async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) { toast('Camera not available — use Photos'); $('#fileInput').click(); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: facing, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
    video.srcObject = stream;
    video.classList.toggle('mirror', facing === 'user');
    show('camera');
    await video.play().catch(() => {});
    drawCamOverlay();
  } catch (err) {
    console.warn(err);
    toast('Camera permission denied — use Photos');
    show('home');
  }
}
function stopCamera() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }

function drawCamOverlay() {
  const r = camOv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  camOv.width = r.width * dpr; camOv.height = r.height * dpr;
  const x = camOv.getContext('2d'); x.scale(dpr, dpr);
  const s = st.spec, g = specGeom();
  // Frame occupies ~78 % of width so people stand at a sensible distance.
  const fw = Math.min(r.width * 0.78, (r.height * 0.62) * s.w / s.h), fh = fw * s.h / s.w;
  const fx = (r.width - fw) / 2, fy = (r.height - fh) / 2 - 20, ppm = fw / s.w;
  x.fillStyle = 'rgba(0,0,0,0.45)';
  x.beginPath(); x.rect(0, 0, r.width, r.height); x.rect(fx, fy, fw, fh); x.fill('evenodd');
  x.strokeStyle = 'rgba(255,255,255,0.8)'; x.lineWidth = 1.5; x.strokeRect(fx, fy, fw, fh);
  const ovH = g.target * ppm, ovW = ovH * 0.74;
  x.setLineDash([8, 6]); x.strokeStyle = '#fff'; x.lineWidth = 2;
  x.beginPath(); x.ellipse(fx + fw / 2, fy + g.chin * ppm - ovH / 2, ovW / 2, ovH / 2, 0, 0, Math.PI * 2); x.stroke();
  x.setLineDash([]); x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 1;
  const eyeY = fy + (g.chin - g.target * 0.53) * ppm;
  x.beginPath(); x.moveTo(fx + fw * 0.2, eyeY); x.lineTo(fx + fw * 0.8, eyeY); x.stroke();
}
window.addEventListener('resize', () => { if (stream) drawCamOverlay(); });

$('#shutter').onclick = async () => {
  if (!stream) return;
  if (timerOn) {
    const cd = $('#countdown');
    for (let i = 3; i > 0; i--) { cd.textContent = i; await new Promise((r) => setTimeout(r, 1000)); }
    cd.textContent = '';
  }
  const fl = $('#flash'); fl.style.opacity = 0.8; setTimeout(() => (fl.style.opacity = 0), 120);
  const vw = video.videoWidth, vh = video.videoHeight;
  const c = document.createElement('canvas'); c.width = vw; c.height = vh;
  c.getContext('2d').drawImage(video, 0, 0, vw, vh);
  stopCamera();
  busy(true);
  try { await loadSource(c, vw, vh); } finally { busy(false); }
};

// ---------- boot ----------
setSpec(store.get('specId', SPECS[0].id));
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Warm up the face model in the background once the UI is idle.
(window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => getLandmarker().catch(() => {}));

// Expose for debugging / tests.
window.__idphoto = { st, fitToMarkers, evaluate, renderPhoto, renderSheet, loadSource, autoDetect };
