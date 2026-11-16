// AI Roadway — zoomable cartoon timeline. Time is measured in whole UTC days.
const DAY = 86400000;
const D = (y, m, d) => Math.round(Date.UTC(y, m, d) / DAY);
const toDay = s => D(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const date = d => new Date(d * DAY);
const iso = d => date(d).toISOString().slice(0, 10);
const now = new Date();
const TODAY = D(now.getFullYear(), now.getMonth(), now.getDate());
const MIN = D(1950, 0, 1), MAX = D(2160, 0, 1);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmt = d => { const t = date(d); return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`; };
const fmtLong = d => `${WD[date(d).getUTCDay()]}, ${fmt(d)}`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

const cv = $('#road'), ctx = cv.getContext('2d'), pinsEl = $('#pins');
let W = 0, H = 0, dpr = 1, RW = 44, baseY = 0, amp = 30, bot = 0, topPad = 100, compact = false;
const view = { c: TODAY, ppd: 1 };   // centre day (float) and pixels per day
let pan = 0;                          // accumulated pan in px; drives scenery parallax
let events = [], newsIdx = null, dirty = true, anim = null;
let hoverDay = null, selDay = null, inited = false;
const newsByDay = new Map(), monthState = new Map();

const X = d => W / 2 + (d - view.c) * view.ppd;
const dayAt = px => view.c + (px - W / 2) / view.ppd;
const roadY = x => baseY + Math.sin((x + pan) / 240) * amp + Math.sin((x + pan) / 97) * amp * 0.22;
const minPpd = () => W / (MAX - MIN);
const MAXPPD = 180;

/* ---------- colours that change along the road ---------- */
const lerpStops = stops => d => {
  if (d <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (d <= stops[i][0]) {
    const [d0, a] = stops[i - 1], [d1, b] = stops[i], f = (d - d0) / (d1 - d0);
    return a.map((v, k) => Math.round(v + (b[k] - v) * f));
  }
  return stops[stops.length - 1][1];
};
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const sky = lerpStops([[D(1950, 0, 1), [246, 226, 186]], [D(1995, 0, 1), [200, 232, 250]], [TODAY, [130, 205, 255]], [D(2031, 0, 1), [255, 170, 205]], [D(2046, 0, 1), [120, 90, 214]], [D(2100, 0, 1), [22, 16, 58]]]);
const ground = lerpStops([[D(1950, 0, 1), [190, 196, 120]], [D(1995, 0, 1), [150, 208, 110]], [TODAY, [118, 214, 92]], [D(2031, 0, 1), [86, 208, 176]], [D(2050, 0, 1), [70, 86, 170]], [D(2100, 0, 1), [38, 30, 92]]]);
const spaceness = d => clamp((d - D(2036, 0, 1)) / (D(2075, 0, 1) - D(2036, 0, 1)), 0, 1);
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(42);
const stars = Array.from({ length: 110 }, () => [rnd(), rnd() * 0.5, 0.6 + rnd() * 1.6]);
const clouds = Array.from({ length: 7 }, () => [rnd(), 0.08 + rnd() * 0.3, 0.7 + rnd() * 0.7]);

/* ---------- sizing ---------- */
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  // phones: toolbar docks to the bottom, the day sheet slides over it, and the road sits in what is left
  compact = W < 720;
  const sheet = compact && !$('#panel').hidden;
  document.body.classList.toggle('sheet-open', sheet);
  bot = !compact ? 0 : sheet ? $('#panel').offsetHeight : $('#controls').offsetHeight;
  topPad = !compact ? 100 : sheet ? 52 : $('#bignews').getBoundingClientRect().bottom + 6;
  document.documentElement.style.setProperty('--bot', bot + 'px');
  RW = compact ? 38 : clamp(H * 0.065, 32, 52);
  baseY = compact ? topPad + (H - bot - 46 - topPad) * 0.52 : H * 0.56;
  amp = compact ? clamp((H - bot - topPad) * 0.03, 8, 20) : clamp(H * 0.045, 12, 34);
  if (!W) return;
  if (!inited) {   // first time we know the real width: frame "a few years back, a decade ahead"
    inited = true;
    const m = location.hash.match(/^#(\d{4}-\d{2}-\d{2})$/);
    if (m) { view.c = toDay(m[1]) + 0.5; view.ppd = 80; }
    else { view.c = TODAY + 365 * (compact ? 1 : 1.5); view.ppd = spanToPpd(365.25 * (compact ? 6 : 16)); }
  }
  view.ppd = clamp(view.ppd, minPpd(), MAXPPD);
  dirty = true;
}

/* ---------- drawing ---------- */
function hGradient(fn) {
  const g = ctx.createLinearGradient(0, 0, W, 0);
  for (let i = 0; i <= 8; i++) g.addColorStop(i / 8, rgb(fn(dayAt(W * i / 8))));
  return g;
}
function roadPath(off = 0) {
  ctx.beginPath();
  for (let x = -60; x <= W + 60; x += 8) ctx.lineTo(x, roadY(x) + off);
}
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ppd = view.ppd, xT = X(TODAY + 0.5);

  // sky
  ctx.fillStyle = hGradient(sky); ctx.fillRect(0, 0, W, H);
  const glow = ctx.createLinearGradient(0, 0, 0, baseY);
  glow.addColorStop(0, 'rgba(255,255,255,0)'); glow.addColorStop(1, 'rgba(255,255,255,.35)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, baseY);

  // stars (future) and clouds (past/present)
  for (const [fx, fy, r] of stars) {
    const x = (((fx * W * 2 - pan * 0.12) % W) + W) % W, a = spaceness(dayAt(x));
    if (a < 0.03) continue;
    ctx.globalAlpha = a; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, fy * H, r, 0, 7); ctx.fill();
  }
  for (const [fx, fy, s] of clouds) {
    const span = W + 320, x = (((fx * span * 2 - pan * 0.3) % span) + span) % span - 160, y = fy * H + 40;
    const a = 1 - spaceness(dayAt(x)); if (a < 0.03) continue;
    ctx.globalAlpha = a * 0.92; ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, 7); ctx.arc(x + 26 * s, y - 12 * s, 28 * s, 0, 7);
    ctx.arc(x + 58 * s, y, 24 * s, 0, 7); ctx.rect(x, y, 58 * s, 22 * s); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // far hills, then the ground the road sits on
  ctx.beginPath(); ctx.moveTo(-60, H);
  for (let x = -60; x <= W + 60; x += 10) ctx.lineTo(x, baseY - amp - RW - 26 + Math.sin((x + pan * 0.5) / 150) * 20 + Math.sin((x + pan * 0.5) / 61) * 7);
  ctx.lineTo(W + 60, H); ctx.closePath();
  ctx.fillStyle = hGradient(d => ground(d).map(v => Math.round(v * 0.8))); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-60, H);
  for (let x = -60; x <= W + 60; x += 8) ctx.lineTo(x, roadY(x) - RW * 0.5 - 20 + Math.sin((x + pan) / 53) * 5);
  ctx.lineTo(W + 60, H); ctx.closePath();
  ctx.fillStyle = hGradient(ground); ctx.fill();

  // day columns when zoomed in far enough
  const d0 = Math.floor(dayAt(0)), d1 = Math.ceil(dayAt(W));
  if (ppd >= 12) {
    for (let d = d0; d <= d1; d++) {
      const x = X(d), wd = date(d).getUTCDay();
      if (d === selDay) { ctx.fillStyle = 'rgba(255,216,77,.45)'; ctx.fillRect(x, 0, ppd, H); }
      else if (d === hoverDay) { ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(x, 0, ppd, H); }
      else if (ppd >= 26 && (wd === 0 || wd === 6)) { ctx.fillStyle = 'rgba(43,43,58,.06)'; ctx.fillRect(x, 0, ppd, H); }
      if (ppd >= 26) { ctx.fillStyle = 'rgba(43,43,58,.13)'; ctx.fillRect(x, 0, 1, H); }
    }
  }

  // the road: paved up to today, a dashed "planned route" beyond it
  const strokeRoad = (curb, asphalt, dash, dashedCurb) => {
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    roadPath(5); ctx.strokeStyle = 'rgba(43,43,58,.35)'; ctx.lineWidth = RW + 10; ctx.stroke();
    roadPath(); ctx.strokeStyle = curb; ctx.lineWidth = RW + 10;
    if (dashedCurb) ctx.setLineDash([14, 10]); ctx.stroke(); ctx.setLineDash([]);
    roadPath(); ctx.strokeStyle = asphalt; ctx.lineWidth = RW; ctx.stroke();
    roadPath(); ctx.strokeStyle = dash; ctx.lineWidth = 4; ctx.setLineDash([18, 16]); ctx.lineDashOffset = pan; ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
  };
  const split = clamp(xT, -100, W + 100);
  ctx.save(); ctx.beginPath(); ctx.rect(-100, 0, split + 100, H); ctx.clip();
  strokeRoad('#fffbe8', '#474958', '#ffd84d'); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(split, 0, W + 100 - split, H); ctx.clip();
  strokeRoad('#e9dcff', '#6a58a6', '#b9fff0', true); ctx.restore();

  drawAxis(d0, d1);

  // days that have stored news
  if (ppd >= 4) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let d = Math.max(d0, MIN); d <= d1; d++) {
      const items = newsByDay.get(d); if (!items) continue;
      const x = X(d + 0.5), y = roadY(x);
      if (ppd < 26) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2b2b3a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fill(); ctx.stroke(); }
      else {
        const r = Math.min(15, ppd * 0.36);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2b2b3a'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
        ctx.font = `${Math.round(r * 1.05)}px serif`; ctx.fillStyle = '#2b2b3a'; ctx.fillText('📰', x, y + 1);
        if (ppd >= 48) {
          ctx.font = '700 11px Fredoka, sans-serif';
          const tx = x + r, ty = y - r; ctx.fillStyle = '#ff5d5d'; ctx.beginPath(); ctx.arc(tx, ty, 9, 0, 7); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.fillText(items.length, tx, ty + 0.5);
        }
      }
    }
  }

  // the car: you are here
  if (xT > -60 && xT < W + 60) {
    const y = roadY(xT);
    ctx.save(); ctx.translate(xT, y - 6); ctx.scale(-1, 1);
    ctx.font = `${Math.round(RW * 0.82)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🚗', 0, 0); ctx.restore();
    ctx.font = '700 11px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ty = y - RW * 0.5 - 14;
    ctx.fillStyle = '#ff5d5d'; ctx.strokeStyle = '#2b2b3a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(xT - 27, ty - 9, 54, 18, 9); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillText('TODAY', xT, ty + 0.5);
  }
  layoutPins();
}

function drawAxis(d0, d1) {
  const ppd = view.ppd, top = H - bot - 46;
  ctx.fillStyle = 'rgba(43,43,58,.82)'; ctx.fillRect(0, top, W, 46 + bot);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const tick = (x, big) => { ctx.fillStyle = big ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.3)'; ctx.fillRect(x, top, big ? 2 : 1, big ? 46 : 8); };
  const ctxLabel = (x, text) => { ctx.font = '700 13px Fredoka, sans-serif'; ctx.fillStyle = '#ffd84d'; ctx.textAlign = 'left'; ctx.fillText(text, x + 7, top + 13); ctx.textAlign = 'center'; };
  const y0 = date(Math.max(d0, MIN - 400)).getUTCFullYear(), y1 = date(d1).getUTCFullYear();

  if (ppd >= 26) {            // individual days
    let next = Infinity;
    for (let d = d0; d <= d1; d++) {
      const t = date(d), x = X(d);
      if (t.getUTCDate() === 1) { tick(x, true); if (x > 0) next = Math.min(next, x); ctxLabel(x, `${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`); }
      ctx.font = `${d === TODAY ? 700 : 500} 14px Fredoka, sans-serif`;
      ctx.fillStyle = d === TODAY ? '#ff8a8a' : '#fff';
      ctx.fillText(ppd >= 62 ? `${WD[t.getUTCDay()]} ${t.getUTCDate()}` : t.getUTCDate(), x + ppd / 2, top + 32);
    }
    const t = date(d0); if (next > 120) ctxLabel(0, `${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`);
  } else if (ppd * 30.4 >= 58) {   // months
    let next = Infinity;
    for (let y = y0; y <= y1; y++) for (let m = 0; m < 12; m++) {
      const x = X(D(y, m, 1)); if (x < -200 || x > W) continue;
      tick(x, m === 0);
      if (m === 0) { if (x > 0) next = Math.min(next, x); ctxLabel(x, y); }
      ctx.font = '500 14px Fredoka, sans-serif'; ctx.fillStyle = '#fff';
      ctx.fillText(MONTHS[m], x + ppd * 15.2, top + 32);
    }
    if (next > 70) ctxLabel(0, date(d0).getUTCFullYear());
  } else {                         // years
    const ppy = ppd * 365.25, step = [1, 2, 5, 10, 25, 50].find(s => ppy * s >= 58) || 50;
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
      const x = X(D(y, 0, 1)); tick(x, true);
      ctx.font = '600 15px Fredoka, sans-serif'; ctx.fillStyle = y === date(TODAY).getUTCFullYear() ? '#ff8a8a' : '#fff';
      ctx.textAlign = 'left'; ctx.fillText(y, x + 7, top + 24); ctx.textAlign = 'center';
    }
    if (step === 1 && ppy >= 300) for (let y = y0; y <= y1; y++) for (let m = 1; m < 12; m++) tick(X(D(y, m, 1)), false);
  }
}

/* ---------- event signposts (DOM, so they are clickable and focusable) ---------- */
function buildPins() {
  events.forEach((ev, i) => {
    ev.day = toDay(ev.d); ev.pred = ev.k === 'pred'; ev.side = i % 2;
    const pin = el('div', `pin ${ev.pred ? 'pred' : 'past'}`);
    const b = el('button', 'bubble'); b.type = 'button'; b.title = `${ev.t} — ${fmt(ev.day)}`;
    const lbl = el('span', 'lbl'); lbl.append(el('b', '', ev.t), el('i', '', (ev.pred ? '🔮 ' : '') + fmt(ev.day)));
    b.append(el('span', 'emo', ev.e), lbl);
    b.addEventListener('click', () => { if (moved > 6) return; openDay(ev.day); if (view.ppd < 26) flyTo(ev.day + 0.5, Math.max(view.ppd, Math.min(40, view.ppd * 6))); });
    pin.append(el('span', 'stem'), b); pin.style.display = 'none';
    pinsEl.append(pin); ev.el = pin;
  });
}
const bubbleW = ev => compact ? 46 + clamp(ev.t.length * 6.7, 80, 136) : 52 + clamp(ev.t.length * 7.5, 92, 200);
function layoutPins() {
  const half = RW / 2, STEP = compact ? 54 : 62, FIRST = half + 16, maxLv = compact ? 4 : 3, gap = compact ? 30 : 20;
  const upLv = clamp(Math.floor((baseY - amp - FIRST - topPad - 46) / STEP) + 1, 1, maxLv);
  const dnLv = clamp(Math.floor((H - bot - 46 - baseY - amp - FIRST - 50) / STEP) + 1, 1, maxLv);
  const xT = X(TODAY + 0.5), occ = { up0: [[xT - 34, xT + 34]] }, anchors = [], vis = [];   // keep the TODAY flag clear
  const free = (key, l, r) => (occ[key] || (occ[key] = [])).every(([a, b]) => r < a || l > b);
  for (const ev of events) {
    const x = X(ev.day + 0.5);
    if (x < -140 || x > W + 140) { if (ev.shown) { ev.el.style.display = 'none'; ev.shown = false; } continue; }
    vis.push([ev, x]);
  }
  vis.sort((a, b) => b[0].w - a[0].w || a[0].day - b[0].day);
  for (const [ev, x] of vis) {
    const hw = bubbleW(ev) / 2 + 6, sides = ev.side ? ['up', 'down'] : ['down', 'up'];
    let spot = null;
    find: for (let lv = 0; lv < maxLv; lv++) for (const side of sides) {
      if (lv >= (side === 'up' ? upLv : dnLv)) continue;
      if (!free(side + lv, x - hw, x + hw)) continue;
      let clear = true;
      for (let k = 0; k < lv; k++) if (!free(side + k, x - 4, x + 4)) clear = false;
      if (!clear) continue;
      occ[side + lv].push([x - hw, x + hw]);
      for (let k = 0; k < lv; k++) occ[side + k].push([x - 4, x + 4]);
      spot = { side, lv }; break find;
    }
    let cls = `pin ${ev.pred ? 'pred' : 'past'} `;
    if (spot) { cls += spot.side; ev.el.style.setProperty('--stem', `${FIRST + spot.lv * STEP}px`); anchors.push(x); }
    else if (anchors.every(a => Math.abs(a - x) > gap)) { cls += 'mini'; anchors.push(x); }
    else { if (ev.shown) { ev.el.style.display = 'none'; ev.shown = false; } continue; }
    if (ev.el.className !== cls) ev.el.className = cls;
    ev.el.style.transform = `translate(${x.toFixed(1)}px,${roadY(x).toFixed(1)}px)`;
    if (!ev.shown) { ev.el.style.display = ''; ev.shown = true; }
  }
}

/* ---------- navigation ---------- */
function clampView() {
  view.ppd = clamp(view.ppd, minPpd(), MAXPPD);
  view.c = clamp(view.c, MIN, MAX);
  dirty = true;
}
function panBy(dx) { view.c += dx / view.ppd; pan += dx; clampView(); }
function zoomAt(px, f) {
  const d = dayAt(px); view.ppd = clamp(view.ppd * f, minPpd(), MAXPPD);
  view.c = d - (px - W / 2) / view.ppd; clampView();
}
function flyTo(c, ppd, ms = 700) {
  const c0 = view.c, l0 = Math.log(view.ppd), l1 = Math.log(clamp(ppd, minPpd(), MAXPPD)), t0 = performance.now();
  anim = t => {
    const f = clamp((t - t0) / ms, 0, 1), e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
    const prev = view.c;
    view.ppd = Math.exp(l0 + (l1 - l0) * e); view.c = c0 + (c - c0) * e;
    pan += clamp((view.c - prev) * view.ppd, -30, 30);   // keep the scenery rolling while we drive
    clampView(); if (f >= 1) anim = null;
  };
}
const spanToPpd = days => W / days;
const ZOOMS = { era: () => [(MIN + MAX) / 2, minPpd()], decade: () => [view.c, spanToPpd(3652 * 1.3)], year: () => [view.c, spanToPpd(400)], month: () => [view.c, spanToPpd(36)], day: () => [view.c, Math.max(70, spanToPpd(9))] };

function frame(t) {
  if (anim) anim(t);
  if (dirty) { dirty = false; draw(); ensureNews(); }
  requestAnimationFrame(frame);
}

/* ---------- pointer, wheel, keyboard ---------- */
const ptrs = new Map(); let moved = 0, lastPinch = 0;
const pinchInfo = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2 }; };
let onCanvas = false;
const down = e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); anim = null;
  if (ptrs.size === 1) { moved = 0; onCanvas = e.target === cv; } else { moved = 99; lastPinch = pinchInfo().d; }
  cv.classList.add('dragging'); $('#hint').classList.add('gone');
};
cv.addEventListener('pointerdown', down); pinsEl.addEventListener('pointerdown', down);
addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) {
    const h = e.target === cv && e.pointerType === 'mouse' && view.ppd >= 12 ? Math.floor(dayAt(e.clientX)) : null;
    if (h !== hoverDay) { hoverDay = h; dirty = true; } return;
  }
  const dx = e.clientX - p.x; p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 1) { moved += Math.abs(dx); panBy(-dx); }
  else if (ptrs.size === 2) { const pi = pinchInfo(); if (lastPinch) zoomAt(pi.x, pi.d / lastPinch); lastPinch = pi.d; panBy(-dx / 2); }
});
const up = e => {
  if (!ptrs.has(e.pointerId)) return;
  const single = ptrs.size === 1; ptrs.delete(e.pointerId); lastPinch = 0;
  if (!ptrs.size) cv.classList.remove('dragging');
  if (single && moved < 6 && onCanvas && e.type === 'pointerup') {
    if (view.ppd >= 12) openDay(Math.floor(dayAt(e.clientX)));
    else flyTo(dayAt(e.clientX), view.ppd * 3.5, 500);
  }
};
addEventListener('pointerup', up); addEventListener('pointercancel', up);
addEventListener('gesturestart', e => e.preventDefault());   // stop Safari zooming the whole page
const onWheel = e => {
  e.preventDefault(); anim = null; $('#hint').classList.add('gone');
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) panBy(e.deltaX);
  else zoomAt(e.clientX, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : e.deltaMode ? 0.08 : 0.0025)));
};
cv.addEventListener('wheel', onWheel, { passive: false });
pinsEl.addEventListener('wheel', onWheel, { passive: false });
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft') panBy(-W * 0.15); else if (e.key === 'ArrowRight') panBy(W * 0.15);
  else if (e.key === '+' || e.key === '=') zoomAt(W / 2, 1.5); else if (e.key === '-') zoomAt(W / 2, 1 / 1.5);
  else if (e.key === 'Escape') closePanel();
});
addEventListener('resize', resize);

/* ---------- news ---------- */
const monthKey = d => iso(d).slice(0, 7);
const safeUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : null;
async function loadMonth(key) {
  if (monthState.has(key)) return monthState.get(key);
  const p = fetch(`data/news/${key}.json?v=${iso(TODAY)}`).then(r => r.ok ? r.json() : {}).then(j => {
    for (const [d, items] of Object.entries(j)) if (Array.isArray(items) && items.length) newsByDay.set(toDay(d), items);
    dirty = true;
  }).catch(() => {});
  monthState.set(key, p); return p;
}
function ensureNews() {
  if (!newsIdx || view.ppd < 4) return;
  const a = monthKey(Math.max(MIN, Math.floor(dayAt(0)))), b = monthKey(Math.min(MAX, Math.ceil(dayAt(W))));
  for (const m of newsIdx.months || []) if (m >= a && m <= b) loadMonth(m);
}
function showBigNews() {
  const big = newsIdx && newsIdx.big, card = $('#bignews');
  if (!big || !safeUrl(big.u)) { $('#bn-title').textContent = 'No big headline yet. The feed refreshes every day.'; card.removeAttribute('href'); return; }
  $('#bn-title').textContent = big.t;
  const ago = TODAY - toDay(big.d);
  $('#bn-meta').textContent = `${big.s} · ${ago <= 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`} · ${fmt(toDay(big.d))}`;
  card.href = big.u;
}

/* ---------- side panel ---------- */
const rel = d => { const n = d - TODAY; return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : n > 0 ? `In ${n.toLocaleString()} days` : `${(-n).toLocaleString()} days ago`; };
const untilText = d => { const n = d - TODAY; if (n < 0) return 'date has passed'; if (n < 60) return `in ${n} days`; if (n < 730) return `in ${Math.round(n / 30.4)} months`; return `in ${Math.round(n / 365.25)} years`; };
function eventCard(ev) {
  const c = el('div', `ev ${ev.pred ? 'pred' : ''}`);
  if (ev.pred) c.append(el('span', 'tag', '🔮 Prediction'));
  c.append(el('h3', '', `${ev.e} ${ev.t}`), el('p', '', ev.x));
  if (ev.pred) c.append(el('div', 'wild', `Wildness: ${'🌶️'.repeat(ev.wild || 3)} · ${untilText(ev.day)}`));
  return c;
}
async function openDay(d, pushHash = true) {
  d = clamp(d, MIN, MAX - 1); selDay = d; dirty = true;
  const body = $('#panel-body'); $('#panel').hidden = false; $('#panel').dataset.mode = 'day'; resize();
  $('#p-title').textContent = fmtLong(d); $('#p-prev').hidden = $('#p-next').hidden = false;
  if (pushHash) history.replaceState(null, '', `#${iso(d)}`);
  const key = monthKey(d);
  if (newsIdx && (newsIdx.months || []).includes(key)) await loadMonth(key);
  if (selDay !== d) return;
  body.replaceChildren();
  body.append(el('span', `when ${d > TODAY ? 'future' : ''}`, rel(d)));
  const evs = events.filter(e => e.day === d);
  evs.forEach(e => body.append(eventCard(e)));
  const items = newsByDay.get(d);
  if (items) {
    body.append(el('h4', 'sec', `📰 AI news from this day (${items.length})`));
    const ul = el('ul', 'news');
    for (const it of items) {
      const u = safeUrl(it.u); if (!u) continue;
      const a = el('a', '', it.t); a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.append(el('small', '', it.s)); const li = el('li'); li.append(a); ul.append(li);
    }
    body.append(ul);
  } else if (d > TODAY) {
    if (!evs.length) body.append(el('p', 'empty', 'This stretch of road hasn’t been paved yet. News will appear here when the day arrives.'));
  } else {
    const first = newsIdx && newsIdx.firstDay;
    body.append(el('p', 'empty', first && d < toDay(first)
      ? `Daily news logging on the Roadway began on ${fmt(toDay(first))}. Earlier days show only major milestones.`
      : d === TODAY ? 'Today’s headlines haven’t been collected yet. The feed refreshes once a day.' : 'No AI headlines were stored for this day.'));
  }
  if (view.ppd < 26) { const b = el('button', 'chip', '🔍 Zoom to this day'); b.onclick = () => flyTo(d + 0.5, 80); body.append(b); }
}
function openPredictions() {
  selDay = null; dirty = true;
  $('#panel').hidden = false; $('#panel').dataset.mode = 'list'; resize();
  $('#p-title').textContent = '🔮 The road ahead'; $('#p-prev').hidden = $('#p-next').hidden = true;
  const body = $('#panel-body'); body.replaceChildren();
  body.append(el('p', 'fine', 'These dates are playful guesses about the future, not facts or forecasts from experts. Tap one to drive there.'));
  const list = el('div', 'plist');
  for (const ev of events.filter(e => e.pred).sort((a, b) => a.day - b.day)) {
    const b = el('button'); b.type = 'button';
    b.append(el('span', 'pe', ev.e), el('span', 'pt', ev.t), el('span', 'pd', fmt(ev.day)));
    b.onclick = () => { flyTo(ev.day + 0.5, 40, 1100); openDay(ev.day); };
    list.append(b);
  }
  body.append(list);
}
function closePanel() { $('#panel').hidden = true; resize(); selDay = null; dirty = true; history.replaceState(null, '', location.pathname + location.search); }

/* ---------- controls ---------- */
$('#p-close').onclick = closePanel;
const stepDay = n => { const d = selDay + n; openDay(d); if (X(d) < 40 || X(d + 1) > W - 40) flyTo(d + 0.5, view.ppd, 300); };
$('#p-prev').onclick = () => stepDay(-1);
$('#p-next').onclick = () => stepDay(1);
$('#zoom-in').onclick = () => flyTo(view.c, view.ppd * 2.2, 300);
$('#zoom-out').onclick = () => flyTo(view.c, view.ppd / 2.2, 300);
$('#go-today').onclick = () => { flyTo(TODAY + 0.5, Math.max(view.ppd, 60)); openDay(TODAY); };
$('#show-preds').onclick = openPredictions;
$('#jump').onchange = e => { if (e.target.value) { const d = toDay(e.target.value); flyTo(d + 0.5, 80, 1000); openDay(d); } };
document.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => { const [c, p] = ZOOMS[b.dataset.zoom](); flyTo(c, p, 600); });

/* ---------- boot ---------- */
async function boot() {
  if (matchMedia('(pointer:coarse)').matches) $('#hint').textContent = 'Pinch to zoom · swipe to travel · tap a day to open it';
  resize();
  requestAnimationFrame(frame);
  events = await fetch('data/events.json', { cache: 'no-cache' }).then(r => r.json());   // always pick up newly added signposts
  buildPins(); dirty = true;

  const next = events.filter(e => e.pred && e.day >= TODAY).sort((a, b) => a.day - b.day)[0];
  if (next) {
    const chip = $('#next-pred'); chip.hidden = false;
    chip.textContent = `🔮 Next: ${next.t} ${untilText(next.day)}`;
    chip.onclick = () => { flyTo(next.day + 0.5, 40, 1000); openDay(next.day); };
  }
  const asi = events.find(e => e.pred && /^Superintelligence/.test(e.t));
  if (asi && asi.day > TODAY) $('#tagline').textContent = `${(asi.day - TODAY).toLocaleString()} days to predicted superintelligence`;

  try { newsIdx = await fetch(`data/news/index.json?v=${Date.now()}`).then(r => r.ok ? r.json() : null); } catch { newsIdx = null; }
  showBigNews(); resize();

  const m = location.hash.match(/^#(\d{4}-\d{2}-\d{2})$/);
  if (m) openDay(toDay(m[1]), false);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => dirty = true);
  setTimeout(() => $('#hint').classList.add('gone'), 9000);
}
addEventListener('hashchange', () => { const m = location.hash.match(/^#(\d{4}-\d{2}-\d{2})$/); if (m && toDay(m[1]) !== selDay) { const d = toDay(m[1]); flyTo(d + 0.5, 80, 900); openDay(d, false); } });
boot();
