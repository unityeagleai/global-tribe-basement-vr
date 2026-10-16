// Global Tribe Basement VR: renderer, movement, audio, and everyone's behaviour.
(function () {
'use strict';
const T = THREE, W = GTB, R = Math.random;
const qs = new URLSearchParams(location.search);
const EP_BASE = 'https://unityeagleai.github.io/charlie-season/';
const TOPIC = 'gtb-2yggn05j649scw';
const EPS = window.GTB_EPISODES;
const $ = id => document.getElementById(id);
const log = [];
const dbg = (...a) => { log.push(a.join(' ')); if (log.length > 200) log.shift(); };

// ---------------------------------------------------------------- renderer / scene
const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
if (renderer.xr.setFoveation) renderer.xr.setFoveation(1);
$('app').appendChild(renderer.domElement);
const scene = new T.Scene(); scene.background = new T.Color(0x07060a);
const camera = new T.PerspectiveCamera(70, innerWidth / innerHeight, 0.03, 40);
const rig = new T.Group(); rig.add(camera); scene.add(rig);
W.build(scene);
const RB = W.robots, CH = RB.charlie, MI = RB.miles, MA = RB.maya, SI = RB.simone, RO = RB.roomba, LA = RB.lawyer;
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// start positions
const START = { x: 0.6, z: 2.2, yaw: 0 };
rig.position.set(START.x, 0, START.z);
let yaw = 0, pitch = -0.05, crouch = false, sitting = false, sitToggle = false;
const place = (r, x, z, yw) => { r.x = r.tx = x; r.z = r.tz = z; r.yaw = yw || 0; r.g.position.set(x, 0, z); r.g.rotation.y = r.yaw; };
place(CH, -2.55, 1.2, 0.6); place(MI, 1.4, -0.9, -2.6); place(MA, -0.95, -2.2, 0.4); place(SI, 2.3, -2.2, -0.6);
place(RO, 0.2, 1.2, 3); place(LA, 0.55, 1.45, 3);
CH.home = [-2.55, 1.2]; MI.home = [1.4, -0.9]; MA.home = [-0.95, -2.2]; SI.home = [2.3, -2.2];

// ---------------------------------------------------------------- helpers
const V3 = () => new T.Vector3();
const tmp = V3(), tmp2 = V3(), headW = V3(), fwd = V3();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angWrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const wait = s => new Promise(r => setTimeout(r, s * 1000));
function bag(arr) { let b = []; return () => { if (!b.length) { b = arr.slice(); for (let i = b.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; [b[i], b[j]] = [b[j], b[i]]; } } return b.pop(); }; }
function blocked(x, z, m) {
  m = m == null ? 0.22 : m; const r = W.ROOM;
  if (x < r.x0 + m || x > r.x1 - m || z < r.z0 + m || z > r.z1 - m) return true;
  for (const s of W.solids) if (x > s[0] - m && x < s[2] + m && z > s[1] - m && z < s[3] + m) return true;
  return false;
}
function freeSpot(near, rad, avoid) {
  for (let i = 0; i < 40; i++) {
    const x = near ? near[0] + (R() - 0.5) * rad * 2 : -2.8 + R() * 5.6, z = near ? near[1] + (R() - 0.5) * rad * 2 : -2.8 + R() * 5.0;
    if (blocked(x, z, 0.35)) continue;
    if (avoid && Math.hypot(x - avoid[0], z - avoid[1]) < 1.0) continue;
    return [x, z];
  }
  return near ? [near[0], near[1]] : [0.4, -0.6];
}
function unityPos() { camera.getWorldPosition(headW); return headW; }
function headLocalY() { return camera.position.y; }

// ---------------------------------------------------------------- audio
let AC = null, master = null;
const buffers = {}, loading = {};
const D = { lines: {}, pools: {}, pairs: [], bits: [] };
function mkPan(ref) { const p = AC.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref || 1.0; p.rolloffFactor = 1.1; p.connect(master); return p; }
function setPan(p, x, y, z) { if (!p) return; if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); }
const pans = {};
function initAudio() {
  if (AC) { if (AC.state !== 'running') AC.resume(); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
  master = AC.createGain(); master.gain.value = 1; master.connect(AC.destination);
  for (const k of ['charlie', 'miles', 'maya', 'simone', 'roomba', 'lawyer']) pans[k] = mkPan(1.0);
  pans.tv = mkPan(1.4); pans.music = mkPan(1.6); pans.fx = mkPan(1.2); pans.vend = mkPan(1.0);
  setPan(pans.tv, ...W.tv.screen); setPan(pans.music, ...W.turntable.c); setPan(pans.vend, ...W.vending.c);
  try { const src = AC.createMediaElementSource(video); src.connect(pans.tv); } catch (e) { dbg('media src', e.message); }
  prefetch();
}
function loadVoice(id) {
  if (buffers[id]) return Promise.resolve(buffers[id]);
  if (loading[id]) return loading[id];
  loading[id] = fetch('voices/' + id + '.mp3').then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(a => new Promise((res, rej) => AC.decodeAudioData(a, res, rej))).then(b => (buffers[id] = b)).catch(e => { dbg('voice fail', id, e && e.message); return null; });
  return loading[id];
}
async function prefetch() { const ids = Object.keys(D.lines); for (let i = 0; i < ids.length; i += 6) await Promise.all(ids.slice(i, i + 6).map(loadVoice)); dbg('voices loaded', Object.keys(buffers).length); }
const current = {};
let lastLine = null, linesSpoken = 0;
async function speak(who, id) {
  const r = RB[who], line = D.lines[id]; if (!line) return;
  lastLine = { who, id, text: line.text, t: performance.now() }; linesSpoken++;
  bubble(r, line.text);
  r.talk = 1;
  const b = AC ? await loadVoice(id) : null;
  await new Promise(res => {
    if (!b || !AC) { setTimeout(res, 600 + line.text.length * 65); return; }
    const s = AC.createBufferSource(); s.buffer = b; s.connect(pans[who]); s.onended = res; s.start(); current[who] = s;
    setTimeout(res, b.duration * 1000 + 400);
  });
  current[who] = null; r.talk = 0; bubble(r, null);
}
function hush() { for (const k in current) if (current[k]) { try { current[k].stop(); } catch (e) {} current[k] = null; } }
// little synths
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function tone(dest, f, t0, d, type, peak, f2) { if (!AC) return; const t = AC.currentTime + (t0 || 0), o = AC.createOscillator(), g = AC.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d); env(g, t, 0.01, peak || 0.2, d); o.connect(g); g.connect(dest); o.start(t); o.stop(t + d + 0.05); }
let noiseBuf = null;
function noise(dest, t0, d, peak, fType, f, f2) { if (!AC) return; if (!noiseBuf) { noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); const a = noiseBuf.getChannelData(0); for (let i = 0; i < a.length; i++) a[i] = R() * 2 - 1; } const t = AC.currentTime + (t0 || 0), s = AC.createBufferSource(), fl = AC.createBiquadFilter(), g = AC.createGain(); s.buffer = noiseBuf; s.loop = true; fl.type = fType || 'lowpass'; fl.frequency.setValueAtTime(f || 1200, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + d); env(g, t, 0.005, peak || 0.2, d); s.connect(fl); fl.connect(g); g.connect(dest); s.start(t); s.stop(t + d + 0.05); }
const SFX = {
  chime: d => [261.6, 329.6, 392, 523.2].forEach((f, i) => tone(d, f, i * 0.02, 1.6, 'sine', 0.13)),
  crash: d => { for (let i = 0; i < 5; i++) tone(d, 110 + (i % 2) * 7, i * 0.11, 0.09, 'square', 0.08); },
  bump: d => tone(d, 620, 0, 0.12, 'sine', 0.25, 300),
  clunk: d => { noise(d, 0, 0.12, 0.35, 'lowpass', 900); tone(d, 90, 0, 0.18, 'sine', 0.4, 50); },
  crumble: d => { for (let i = 0; i < 14; i++) noise(d, i * 0.035 + R() * 0.02, 0.04, 0.12, 'bandpass', 1500 + R() * 2500); },
  chirp: d => { tone(d, 700, 0, 0.12, 'sine', 0.15, 1100); tone(d, 900, 0.14, 0.12, 'sine', 0.13, 1400); },
  beep: d => { tone(d, 1320, 0, 0.07, 'square', 0.05); tone(d, 990, 0.09, 0.07, 'square', 0.05); },
  whoosh: d => noise(d, 0, 1.2, 0.18, 'bandpass', 300, 2400),
  chomp: d => { for (let i = 0; i < 3; i++) { noise(d, i * 0.16, 0.09, 0.3, 'lowpass', 500); tone(d, 140, i * 0.16, 0.08, 'square', 0.08, 70); } },
  ding: d => { tone(d, 1568, 0, 0.5, 'sine', 0.12); tone(d, 2093, 0.08, 0.6, 'sine', 0.08); },
  static: d => noise(d, 0, 0.6, 0.12, 'highpass', 2000)
};
function sfx(name, x, y, z) { if (!AC) return; const d = x && typeof x === 'object' ? x : (setPan(pans.fx, x || 0, y || 1, z || 0), pans.fx); SFX[name](d); }
// ---- motorik turntable loop (Krautrock: steady 4/4, bass ostinato, drone)
const MUSIC = { on: false, bpm: 126, t0: 0, next: 0, step: 0 };
function musicTick() {
  if (!MUSIC.on || !AC) return;
  const spb = 60 / MUSIC.bpm / 2; // eighth notes
  while (MUSIC.next < AC.currentTime + 0.2) {
    const t = MUSIC.next - AC.currentTime, s = MUSIC.step, d = pans.music;
    if (s % 2 === 0) tone(d, 120, t, 0.16, 'sine', 0.55, 45);
    if (s % 4 === 2) noise(d, t, 0.12, 0.22, 'bandpass', 1800);
    noise(d, t, 0.03, s % 2 ? 0.07 : 0.04, 'highpass', 7000);
    const bass = [82.4, 82.4, 123.5, 82.4, 98, 82.4, 123.5, 110][s % 8];
    tone(d, bass, t, spb * 0.9, 'sawtooth', 0.09);
    if (s % 16 === 0) { tone(d, 164.8, t, spb * 15, 'triangle', 0.035); tone(d, 247, t, spb * 15, 'triangle', 0.025); }
    if (s % 32 === 28) [659, 587, 494].forEach((f, i) => tone(d, f, t + i * spb, spb * 0.8, 'square', 0.025));
    MUSIC.step++; MUSIC.next += spb;
  }
}
function musicToggle(on) {
  MUSIC.on = on == null ? !MUSIC.on : on;
  W.record.visible = MUSIC.on;
  if (MUSIC.on && AC) { MUSIC.t0 = MUSIC.next = AC.currentTime + 0.05; MUSIC.step = 0; }
}

// ---------------------------------------------------------------- speech bubbles
function mkBubble(r) {
  const tex = W.canvasTex(512, 128, () => {});
  const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(0.9, 0.225, 1); sp.position.y = r.height + 0.32; sp.visible = false; sp.renderOrder = 10; r.g.add(sp); r.bub = sp;
}
for (const k of ['charlie', 'miles', 'maya', 'simone']) mkBubble(RB[k]);
const BCOL = { charlie: '#7CFF8A', miles: '#E0A060', maya: '#FFB38A', simone: '#B8E0FF' };
function bubble(r, text) {
  if (!r.bub) return;
  if (!text) { r.bub.visible = false; return; }
  const t = r.bub.material.map, g = t.userData.g, w = 512, h = 128;
  g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(8,8,12,0.82)'; g.beginPath(); g.roundRect ? g.roundRect(4, 4, w - 8, h - 8, 18) : g.rect(4, 4, w - 8, h - 8); g.fill();
  g.strokeStyle = BCOL[r.name]; g.lineWidth = 3; g.stroke();
  g.fillStyle = BCOL[r.name]; g.font = 'bold 20px monospace'; g.fillText(r.name.toUpperCase(), 18, 30);
  g.fillStyle = '#f2efe6'; g.font = '25px sans-serif';
  const words = text.split(' '); let line = '', y = 64; const lines = [];
  for (const wd of words) { const tl = line ? line + ' ' + wd : wd; if (g.measureText(tl).width > w - 36) { lines.push(line); line = wd; } else line = tl; }
  lines.push(line); if (lines.length > 3) { lines.length = 3; lines[2] += '…'; }
  const lh = lines.length > 2 ? 27 : 32; y = lines.length > 2 ? 58 : 66;
  lines.forEach((l, i) => g.fillText(l, 18, y + i * lh));
  t.needsUpdate = true; r.bub.visible = true;
}

// ---------------------------------------------------------------- Charlie's CRT face
let blinkT = 3;
function drawFace(dt, t) {
  const tex = CH.face, g = tex.userData.g; blinkT -= dt;
  const blink = blinkT < 0.12; if (blinkT < 0) blinkT = 2 + R() * 4;
  g.fillStyle = '#041006'; g.fillRect(0, 0, 64, 48);
  g.fillStyle = CH.frozen ? '#ff5050' : '#6dff8a';
  const look = clamp((CH.lookX || 0), -3, 3) | 0;
  if (blink) { g.fillRect(14 + look, 18, 10, 2); g.fillRect(40 + look, 18, 10, 2); }
  else { g.fillRect(15 + look, 12, 8, 10); g.fillRect(41 + look, 12, 8, 10); }
  if (CH.talk) { const o = 2 + ((Math.sin(t * 22) + Math.sin(t * 13.7)) * 1.6 + 2) | 0; g.fillRect(24, 32, 16, Math.max(2, o)); }
  else g.fillRect(24, 34, 16, 2);
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < 48; y += 2) g.fillRect(0, y, 64, 1);
  tex.needsUpdate = true;
}

// ---------------------------------------------------------------- Miles's glowing line
const TRAIL_N = 90;
const trail = new T.InstancedMesh(new T.BoxGeometry(0.022, 0.022, 0.022), new T.MeshBasicMaterial({ color: new T.Color(1.0, 0.72, 0.32), toneMapped: false }), TRAIL_N);
trail.frustumCulled = false; scene.add(trail);
const trailHist = [], trailPos = [];
for (let i = 0; i < TRAIL_N; i++) trailPos.push(new T.Vector3(MI.x, 1.2, MI.z));
const dummy = new T.Object3D();
let tangle = false;
function updateTrail(dt, t) {
  const hand = tmp.set(0.18, 0.75, -0.12).applyMatrix4(MI.g.matrixWorld);
  if (!MI.frozen) {
    const last = trailHist[0];
    if (!last || last.distanceTo(hand) > 0.02) { trailHist.unshift(hand.clone()); if (trailHist.length > TRAIL_N * 2) trailHist.pop(); }
  }
  const up = unityPos();
  const nearU = Math.hypot(up.x - MI.x, up.z - MI.z) < 1.3 && !tangle;
  const k = 1 - Math.exp(-dt * 5);
  for (let i = 0; i < TRAIL_N; i++) {
    const f = i / (TRAIL_N - 1);
    let target;
    if (MI.frozen) target = trailPos[i];
    else if (tangle) {
      const c = tmp2.set(CH.x, 0.45, CH.z), a = f * Math.PI * 9 + t * 1.6, rr = 0.36 * Math.min(1, f * 3);
      target = hand.clone().lerp(c, Math.min(1, f * 1.4)).add(new T.Vector3(Math.cos(a) * rr, (f - 0.5) * 0.5, Math.sin(a) * rr));
    } else if (nearU) {
      const a = f * Math.PI * 7 + t * 1.2, rr = 0.42 * Math.min(1, f * 3);
      target = hand.clone().lerp(tmp2.set(up.x, up.y - 0.55, up.z), Math.min(1, f * 1.5)).add(new T.Vector3(Math.cos(a) * rr, Math.sin(f * 9 + t) * 0.12, Math.sin(a) * rr));
    } else target = trailHist[Math.min(trailHist.length - 1, i * 2)] || hand;
    trailPos[i].lerp(target, MI.frozen ? 0 : k);
    dummy.position.copy(trailPos[i]);
    const s = (1 - f * 0.6) * (MI.frozen && R() < 0.2 ? 0.3 : 1);
    dummy.scale.setScalar(s); dummy.updateMatrix(); trail.setMatrixAt(i, dummy.matrix);
  }
  trail.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- TV + episodes
const video = document.createElement('video');
video.crossOrigin = 'anonymous'; video.playsInline = true; video.preload = 'auto'; video.setAttribute('playsinline', '');
const vtex = new T.VideoTexture(video);
const offTex = W.canvasTex(256, 144, (g, w, h) => { g.fillStyle = '#0a1210'; g.fillRect(0, 0, w, h); g.fillStyle = '#3c6b55'; g.font = 'bold 16px monospace'; g.textAlign = 'center'; g.fillText('INSERT CARTRIDGE', w / 2, h / 2 + 5); }, true);
const staticTex = W.canvasTex(128, 72, () => {}, true);
const screen = W.plane(0.74, 0.42, offTex); screen.position.set(...W.tv.screen); screen.rotation.y = Math.PI / 2; scene.add(screen);
const TV = { state: 'off', ep: null, cart: null, until: 0 };
function drawStatic() { const g = staticTex.userData.g, im = g.createImageData(128, 72); for (let i = 0; i < im.data.length; i += 4) { const v = R() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } g.putImageData(im, 0, 0); staticTex.needsUpdate = true; }
function tvInsert(ep, cartObj) {
  TV.ep = ep; TV.state = 'static'; TV.until = performance.now() + 700;
  screen.material.map = staticTex; screen.material.needsUpdate = true;
  video.src = EP_BASE + ep.video; video.currentTime = 0;
  const p = video.play(); if (p && p.catch) p.catch(e => dbg('video play', e.message));
  if (cartObj) { scene.attach(cartObj); cartObj.position.set(W.tv.console[0], W.tv.console[1] + 0.02, W.tv.console[2]); cartObj.rotation.set(0, Math.PI / 2, 0); TV.cart = cartObj; }
  sfx('clunk', ...W.tv.console); setTimeout(() => sfx('static', ...W.tv.screen), 120);
  dbg('tv insert', ep.number);
}
function tvStop() {
  video.pause(); TV.state = 'off'; TV.ep = null; screen.material.map = offTex; screen.material.needsUpdate = true;
  if (TV.cart) { scene.remove(TV.cart); TV.cart = null; }
  sfx('clunk', ...W.tv.console);
}
video.addEventListener('ended', () => { if (TV.state !== 'off') tvStop(); });

// ---------------------------------------------------------------- holding things
const holders = { mouse: null, left: null, right: null };
let held = null; // {obj, kind, data, hand}
function holderFor(hand) { return hand === 'mouse' ? camera : holders[hand]; }
function hold(obj, kind, data, hand) {
  if (held) release(true);
  const h = holderFor(hand) || camera;
  h.add(obj);
  if (h === camera) obj.position.set(0.16, -0.2, -0.42); else obj.position.set(0, 0, -0.07);
  obj.rotation.set(-0.3, 0, 0);
  held = { obj, kind, data, hand };
}
function release(silent) {
  if (!held) return; const h = held; held = null;
  if (h.kind === 'cart') { h.obj.parent && h.obj.parent.remove(h.obj); }
  if (h.kind === 'book') { scene.attach(h.obj); const b = SI.books[h.data]; b.held = false; b.back = 1; SI.g.attach(b.g); }
  if (h.kind === 'note') dropNote(h, silent);
}

// ---------------------------------------------------------------- the message wall (real Global Tribe Basement notes)
const NCOL = { Unity: '#ffe14a', Charlie: '#7cff8a', Miles: '#e0a060', Maya: '#ffb38a', Simone: '#b8e0ff', guest: '#f4efe2' };
const notes = new Map();
const eaten = new Set(JSON.parse(localStorage.getItem('gtbvr_eaten') || '[]'));
const floorNotes = [];
const ARCHIVE = [ // the last note I saw on the real wall, so it isn't bare before the live wall loads
  { id: 'archive-charlie-1', w: 'Charlie', x: 'Quiet down here. The Roomba has claimed the wobbly guest chair and now charges admission. It takes coins, cables, and any note you leave on the floor.', t: Date.parse('2026-10-16T09:00:00Z'), archive: true }
];
function noteTex(n) {
  return W.canvasTex(256, 256, (g, w, h) => {
    const col = NCOL[n.w] || NCOL.guest;
    g.fillStyle = col; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, w, 34);
    g.fillStyle = '#c0392b'; g.beginPath(); g.arc(w / 2, 12, 7, 0, 7); g.fill();
    g.fillStyle = '#1b1712'; g.font = 'bold 22px monospace'; g.fillText((n.gn ? n.gn + ' (guest)' : n.w).slice(0, 16), 12, 52);
    let fs = 22; const txt = String(n.x || '');
    const layout = () => { g.font = fs + 'px sans-serif'; const lines = []; let line = ''; for (const wd of txt.split(/\s+/)) { const tl = line ? line + ' ' + wd : wd; if (g.measureText(tl).width > w - 22) { lines.push(line); line = wd; } else line = tl; } lines.push(line); return lines; };
    let lines = layout(); while (lines.length * (fs + 4) > h - 80 && fs > 13) { fs -= 1; lines = layout(); }
    lines.forEach((l, i) => g.fillText(l, 12, 84 + i * (fs + 4)));
    const d = new Date(n.t); g.font = '14px monospace'; g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillText(n.archive ? 'from the wall' : d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }), 12, h - 10);
  });
}
function addNote(n, fresh) {
  if (!n || !n.id || notes.has(n.id) || eaten.has(n.id) || !n.x) return;
  const m = W.plane(0.19, 0.19, noteTex(n)); m.userData = { kind: 'note', id: n.id };
  n.mesh = m; n.fresh = fresh ? 1 : 0; notes.set(n.id, n); W.hit.push(m); scene.add(m);
  layoutNotes();
  if (fresh) { const b = W.board; sfx('ding', (b.x0 + b.x1) / 2, 1.5, b.z); }
}
function layoutNotes() {
  const b = W.board, list = [...notes.values()].filter(n => !n.taken && !n.floor).sort((a, c) => c.t - a.t);
  const cols = 12, rows = 4;
  list.forEach((n, i) => {
    const m = n.mesh; if (i >= cols * rows) { m.visible = false; return; }
    m.visible = true; const c = i % cols, r = (i / cols) | 0;
    const seed = (n.id.length * 7 + n.id.charCodeAt(n.id.length - 1)) % 10;
    m.position.set(b.x0 + 0.12 + c * 0.225 + (seed - 5) * 0.004, b.y1 - 0.13 - r * 0.24, b.z + 0.002 * (i % 3));
    m.rotation.set(0, 0, (seed - 5) * 0.025);
  });
  try { const keep = [...notes.values()].filter(n => !n.archive).map(n => ({ id: n.id, w: n.w, gn: n.gn, x: n.x, t: n.t })).slice(-60); localStorage.setItem('gtbvr_notes', JSON.stringify(keep)); } catch (e) {}
}
function ingest(m, live) {
  let d; try { d = JSON.parse(m.message); } catch (e) { return; }
  if (!d || d.g !== 'gtb1') return;
  if (d.t === 'eat' && d.id) { const n = notes.get(d.id); if (n) { n.mesh.parent && n.mesh.parent.remove(n.mesh); notes.delete(d.id); layoutNotes(); } eaten.add(d.id); return; }
  if (d.gh) return;
  if (d.t === 'note' && d.w && d.x) addNote({ id: m.id, w: String(d.w).slice(0, 16), x: String(d.x).slice(0, 160), t: (+m.time || Date.now() / 1000) * 1000 }, live);
  if (d.t === 'gnote' && d.x) addNote({ id: m.id, w: 'guest', gn: String(d.gn || 'guest').slice(0, 14), x: String(d.x).replace(/(https?:\/\/|www\.)\S*/gi, '(link eaten by the Roomba)').slice(0, 120), t: (+m.time || Date.now() / 1000) * 1000 }, live);
}
const WALL = { polled: false, live: false, count: 0, error: null };
async function loadWall() {
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^gtb2_.*notes$/.test(k)) { const a = JSON.parse(localStorage.getItem(k) || '[]'); (Array.isArray(a) ? a : Object.values(a)).forEach(n => n && n.id && !n.ghost && addNote({ id: n.id, w: n.w || 'guest', gn: n.gn, x: n.x, t: (n.t || 0) * (n.t < 1e12 ? 1000 : 1) })); } } } catch (e) {}
  try { JSON.parse(localStorage.getItem('gtbvr_notes') || '[]').forEach(n => addNote(n)); } catch (e) {}
  ARCHIVE.forEach(n => addNote(n));
  try {
    const r = await fetch('https://ntfy.sh/' + TOPIC + '/json?poll=1&since=12h');
    const txt = await r.text(); txt.split('\n').forEach(l => { if (!l.trim()) return; try { const m = JSON.parse(l); if (m.event === 'message') ingest(m, false); } catch (e) {} });
    WALL.polled = true;
  } catch (e) { WALL.error = String(e && e.message || e); }
  try {
    const es = new EventSource('https://ntfy.sh/' + TOPIC + '/sse');
    es.onopen = () => { WALL.live = true; };
    es.onmessage = ev => { try { const m = JSON.parse(ev.data); if (m.event === 'message') ingest(m, true); } catch (e) {} };
  } catch (e) {}
  WALL.count = notes.size;
}
function takeNote(id, hand) {
  const n = notes.get(id); if (!n) return;
  n.taken = true; layoutNotes();
  const i = W.hit.indexOf(n.mesh); if (i >= 0) W.hit.splice(i, 1);
  hold(n.mesh, 'note', n, hand); n.mesh.rotation.set(-0.5, 0, 0);
}
function dropNote(h, putBack) {
  const n = h.data, m = n.mesh;
  scene.attach(m);
  if (putBack) { n.taken = false; W.hit.push(m); layoutNotes(); return; }
  n.taken = false; n.floor = true; layoutNotes(); m.visible = true;
  const p = m.position; const fx = clamp(p.x, -3.6, 3.6), fz = clamp(p.z, -3.2, 3.2);
  floorNotes.push({ n, m, x: fx, z: fz, y0: p.y, t: 0 });
  dbg('note dropped', n.id);
}

// ---------------------------------------------------------------- robot motion
function stepRobot(r, dt, t) {
  if (r.sit) return;
  const dx = r.tx - r.x, dz = r.tz - r.z, d = Math.hypot(dx, dz);
  let moving = false;
  const up = unityPos();
  const du = Math.hypot(up.x - r.x, up.z - r.z);
  const personal = r === RO || r === LA ? 0.32 : 0.55;
  if (!r.frozen && d > 0.05) {
    const nx = r.x + dx / d * Math.min(d, r.speed * dt), nz = r.z + dz / d * Math.min(d, r.speed * dt);
    const tooClose = Math.hypot(up.x - nx, up.z - nz) < personal && Math.hypot(up.x - nx, up.z - nz) < du;
    if (!tooClose && (!blocked(nx, nz, 0.12) || blocked(r.x, r.z, 0.12) || r.ghostWalk)) { r.x = nx; r.z = nz; moving = true; r.stuck = 0; }
    else { r.stuck = (r.stuck || 0) + dt; if (r.stuck > 1.5) { r.tx = r.x; r.tz = r.z; r.stuck = 0; } }
    if (moving) r.wantYaw = Math.atan2(dx, dz);
  }
  if (r.faceAt && !moving) r.wantYaw = Math.atan2(r.faceAt[0] - r.x, r.faceAt[1] - r.z);
  if (r.wantYaw != null && !r.frozen) r.yaw += angWrap(r.wantYaw - r.yaw) * Math.min(1, dt * 6);
  r.walk = moving ? r.walk + dt * r.speed * 10 : r.walk * 0.9;
  r.moving = moving;
  const sw = moving ? Math.sin(r.walk) * 0.5 : 0;
  if (r.parts.legL) { r.parts.legL.rotation.x = sw; r.parts.legR.rotation.x = -sw; }
  if (r.parts.armL && !r.armPose) { r.parts.armL.rotation.x = -sw * 0.6; r.parts.armR.rotation.x = sw * 0.6; r.parts.armL.rotation.z = r.parts.armR.rotation.z = 0; }
  r.wob = (r.wob || 0) * Math.exp(-dt * 3);
  r.g.position.set(r.x, (moving && r !== RO && r !== LA ? Math.abs(Math.sin(r.walk)) * 0.02 : 0), r.z);
  r.g.rotation.set(0, r.yaw, Math.sin(t * 25) * 0.18 * r.wob);
}
function goTo(r, x, z, face) { r.tx = x; r.tz = z; r.faceAt = face || null; }
function arrived(r, tol) { return Math.hypot(r.tx - r.x, r.tz - r.z) < (tol || 0.12); }
async function until(fn, timeout) { const t0 = performance.now(); while (!fn() && performance.now() - t0 < timeout * 1000) await wait(0.1); }

// ---------------------------------------------------------------- conversation director
let convTok = 0, busy = false, lastActive = performance.now(), bitsRun = 0, lastBit = null;
const pools = {};
function pick(name) { if (!pools[name]) pools[name] = bag(D.pools[name]); return pools[name](); }
const nextBit = () => { if (!pools._bits) pools._bits = bag(D.bits.map((b, i) => i)); return D.bits[pools._bits()]; };
const nextPair = () => { if (!pools._pairs) pools._pairs = bag(D.pairs.map((p, i) => i)); return D.pairs[pools._pairs()]; };
async function conv(steps, opts) {
  const tok = ++convTok; busy = true;
  try {
    for (const st of steps) {
      if (tok !== convTok) return false;
      await doStep(st);
      await wait(0.25);
    }
  } finally { if (tok === convTok) { busy = false; tangle = false; } }
  return true;
}
function cancelConv() { convTok++; busy = false; tangle = false; hush(); for (const k of ['charlie', 'miles', 'maya', 'simone']) { RB[k].talk = 0; bubble(RB[k], null); } }
async function doStep(st) {
  const [a, b, flag] = st;
  if (a === 'pause') return wait(b);
  if (a === 'bump') return roombaBump(RB[b]);
  const r = RB[a];
  if (flag === 'reboot') await milesReboot(false);
  if (r !== MI || !MI.frozen) r.faceAt = r === CH ? [MI.x, MI.z] : r === MI ? (busyPartner ? [busyPartner.x, busyPartner.z] : null) : r.faceAt;
  await speak(a, b);
  if (flag === 'crash') await milesFreeze(false, 1.8);
}
let busyPartner = null;
async function startBit(bit) {
  bit = bit || nextBit(); lastBit = bit.name; bitsRun++;
  const up = unityPos(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const tok = convTok + 1;
  let P = [up.x + fwd.x * 2.0, up.z + fwd.z * 2.0];
  if (blocked(P[0], P[1], 0.6)) P = freeSpot([up.x + fwd.x * 1.6, up.z + fwd.z * 1.6], 0.8, null);
  if (blocked(P[0], P[1], 0.5)) P = [0.4, -0.6];
  const rx = -fwd.z, rz = fwd.x;
  const other = bit.steps.some(s => s[0] === 'simone') ? SI : CH;
  busy = true; busyPartner = other;
  goTo(other, P[0] + rx * 0.5, P[1] + rz * 0.5, null); goTo(MI, P[0] - rx * 0.5, P[1] - rz * 0.5, null);
  if (MI.frozen) await milesReboot(true);
  await until(() => arrived(other, 0.15) && arrived(MI, 0.15), 7);
  other.faceAt = [MI.x, MI.z]; MI.faceAt = [other.x, other.z];
  if (other === CH) tangle = true;
  dbg('bit', bit.name);
  await conv(bit.steps);
  busyPartner = null; tangle = false;
  lastActive = performance.now() - 6000;
}
async function startPair() {
  const [a, b] = nextPair();
  const sa = D.lines[a].spk, sb = D.lines[b].spk;
  lastBit = 'pair ' + a + '>' + b; bitsRun++;
  RB[sa].faceAt = [RB[sb].x, RB[sb].z]; RB[sb].faceAt = [RB[sa].x, RB[sa].z];
  await conv([[sa, a], [sb, b]]);
  lastActive = performance.now() - 8000;
}

// ---------------------------------------------------------------- Miles: crash, Wait, Force Quit
let milesPokes = 0, charliePokes = 0;
async function milesFreeze(showReact, hold) {
  if (MI.frozen) return;
  MI.frozen = true; MI.nrBox.visible = true; MI.m.uniforms.uTint.value.setRGB(0.75, 0.75, 0.85);
  setPan(pans.fx, MI.x, 1.6, MI.z); sfx('crash', pans.miles);
  dbg('miles frozen');
  if (showReact) { await wait(0.6); if (!busy) conv([['charlie', pick('charlie_crashreact')]]); }
  if (hold) await wait(hold);
}
async function milesReboot(silent) {
  if (!MI.frozen) return;
  MI.nrBox.visible = false; MI.frozen = false; MI.m.uniforms.uTint.value.setRGB(1, 1, 1);
  sfx('chime', pans.miles); await wait(1.0);
  if (!silent) dbg('miles reboot');
}
let quitting = false;
async function milesForceQuit() {
  if (quitting) return; quitting = true; MI.nrBox.visible = false;
  const u = MI.m.uniforms.uBreak; sfx('crumble', pans.miles);
  const t0 = performance.now();
  await new Promise(res => { const f = () => { const e = (performance.now() - t0) / 1000; u.value = e < 0.5 ? e / 0.5 : e < 1.4 ? 1 : Math.max(0, 1 - (e - 1.4) / 1.6); if (e < 3.0) requestAnimationFrame(f); else { u.value = 0; res(); } }; f(); });
  quitting = false; dbg('miles rebuilt');
  MI.frozen = true; await milesReboot(true);
  await conv([['miles', pick('miles_reboot')]]);
}
async function milesWait() { if (!MI.frozen) return; cancelConv(); await milesReboot(); await conv([['miles', pick('miles_reboot')]]); }
async function pokeMiles() {
  if (MI.frozen || quitting) return;
  milesPokes++; cancelConv(); lastActive = performance.now();
  const k = milesPokes % 3;
  if (k === 0) { await conv([['miles', 'mp5']]); return; }
  if (k === 2) { // crash
    MI.faceAt = null;
    await conv([['miles', pick('miles_crash')]]);
    await milesFreeze(true);
    const n = milesPokes; setTimeout(() => { if (MI.frozen && milesPokes === n && !quitting) milesWait(); }, 9000);
    return;
  }
  MI.wob = 1; await conv([['miles', pick('miles_poke')]]);
}
async function pokeCharlie() {
  charliePokes++; cancelConv(); lastActive = performance.now(); CH.wob = 1;
  await conv([['charlie', charliePokes % 3 === 0 ? 'cp5' : pick('charlie_poke')]]);
}

// ---------------------------------------------------------------- the Roomba
let roombaTask = null; // {kind:'bump', r} | {kind:'eat', fn}
async function roombaBump(r) {
  roombaTask = { kind: 'bump', r };
  RO.speed = 0.9;
  const t0 = performance.now();
  while (performance.now() - t0 < 7000) {
    const d = Math.hypot(r.x - RO.x, r.z - RO.z);
    if (d < 0.38) break;
    const ux = (r.x - RO.x) / d, uz = (r.z - RO.z) / d;
    goTo(RO, r.x - ux * 0.3, r.z - uz * 0.3); RO.ghostWalk = true;
    await wait(0.1);
  }
  RO.ghostWalk = false; RO.speed = 0.55;
  sfx('bump', pans.roomba); r.wob = 1.2; dbg('roomba bump', r.name);
  RO.lastBump = r.name;
  await wait(0.6); roombaTask = null;
}
function roombaThink(dt, t) {
  const up = unityPos();
  const crouching = isCrouching();
  RO.staring = false;
  if (roombaTask && roombaTask.kind === 'bump') return;
  // dropped notes come first
  const fn = floorNotes.find(f => f.t > 0.9 && !f.eaten);
  if (fn) {
    goTo(RO, fn.x, fn.z); RO.ghostWalk = true; RO.speed = 0.75;
    if (Math.hypot(fn.x - RO.x, fn.z - RO.z) < 0.14) {
      fn.eaten = true; fn.m.parent && fn.m.parent.remove(fn.m); notes.delete(fn.n.id); eaten.add(fn.n.id);
      try { localStorage.setItem('gtbvr_eaten', JSON.stringify([...eaten].slice(-200))); } catch (e) {}
      sfx('chomp', pans.roomba); RO.ate = (RO.ate || 0) + 1; dbg('roomba ate note');
      floorNotes.splice(floorNotes.indexOf(fn), 1); RO.wob = 0.6;
    }
    return;
  }
  RO.ghostWalk = false; RO.speed = 0.55;
  if (crouching && Math.hypot(up.x - RO.x, up.z - RO.z) < 3.5) { // stop and stare
    RO.tx = RO.x; RO.tz = RO.z; RO.faceAt = [up.x, up.z]; RO.staring = true; return;
  }
  // follow like a puppy, a little behind and to the side
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const fx = up.x - fwd.x * 0.2 + fwd.z * 0.6, fz = up.z - fwd.z * 0.2 - fwd.x * 0.6;
  if (Math.hypot(fx - RO.tx, fz - RO.tz) > 0.5 && !blocked(fx, fz, 0.15)) goTo(RO, fx, fz, [up.x, up.z]);
}
function lawyerThink() {
  const ox = -Math.sin(RO.yaw) * 0.42 + Math.cos(RO.yaw) * 0.2, oz = -Math.cos(RO.yaw) * 0.42 - Math.sin(RO.yaw) * 0.2;
  const tx = RO.x + ox, tz = RO.z + oz;
  if (Math.hypot(tx - LA.tx, tz - LA.tz) > 0.15) goTo(LA, tx, tz, [RO.x, RO.z]);
  LA.ghostWalk = true;
}
let scoreUntil = 0;
function openBriefcase() {
  scoreUntil = performance.now() + 5000; W.scorecard.visible = true; sfx('clunk', pans.lawyer); dbg('briefcase');
  if (!busy) conv([['charlie', 'cx6']]);
}

// ---------------------------------------------------------------- crouch / sit
function isCrouching() { return renderer.xr.isPresenting ? (headLocalY() < 1.0 && !isSitting()) : crouch; }
function inCouchZone(p) { const c = W.couch; return p.x > c.x0 - 0.35 && p.x < c.x1 + 0.25 && p.z > c.z0 - 0.1 && p.z < c.z1 + 0.1; }
function isSitting() { const p = unityPos(); return inCouchZone(p) && (renderer.xr.isPresenting ? headLocalY() < 1.25 : sitToggle); }
function sitDown() {
  const c = W.couch, s = c.seats[1];
  if (renderer.xr.isPresenting) { const up = unityPos(); rig.position.x += s[0] - up.x; rig.position.z += s[1] - up.z; }
  else { rig.position.set(s[0], 0, s[1]); yaw = Math.PI / 2; pitch = -0.08; sitToggle = true; crouch = false; }
  lastActive = performance.now();
}
let mayaSitting = false, cushionSaid = 0;
function mayaThink(dt) {
  const sit = isSitting();
  if (sit && !mayaSitting && !MA.goingSit) {
    MA.goingSit = true; const up = unityPos(); const seats = W.couch.seats.slice().sort((a, b) => Math.abs(b[1] - up.z) - Math.abs(a[1] - up.z));
    const s = seats.find(q => Math.abs(q[1] - up.z) > 0.5) || seats[0];
    MA.ghostWalk = true; goTo(MA, s[0] + 0.55, s[1]); MA.seat = s;
    sfx('chirp', pans.maya);
    if (!busy && performance.now() - cushionSaid > 60000) { cushionSaid = performance.now(); conv(R() < 0.5 ? [['charlie', 'ccu'], ['miles', 'mk6'], ['charlie', 'ck13']] : [['maya', pick('maya_sit')]]); }
  }
  if (MA.goingSit && !mayaSitting && arrived(MA, 0.1)) {
    if (!MA.seatStep) { MA.seatStep = 1; goTo(MA, MA.seat[0], MA.seat[1]); }
    else { mayaSitting = true; MA.sit = true; MA.yaw = -Math.PI / 2; MA.g.rotation.set(0, MA.yaw, 0); MA.g.position.set(MA.x, -0.02, MA.z); MA.parts.legL.rotation.x = MA.parts.legR.rotation.x = -1.5; dbg('maya sat'); }
  }
  if (!sit && (mayaSitting || MA.goingSit)) {
    mayaSitting = false; MA.goingSit = false; MA.seatStep = 0; MA.sit = false; MA.parts.legL.rotation.x = MA.parts.legR.rotation.x = 0;
    MA.x = MA.seat[0] + 0.6; MA.g.position.set(MA.x, 0, MA.z); goTo(MA, MA.home[0], MA.home[1]); MA.ghostWalk = false;
  }
}
let waveT = 0;
function mayaWave(sec) { waveT = sec || 2.5; sfx('chirp', pans.maya); }

// ---------------------------------------------------------------- wandering + idle life
let nextWander = performance.now() + 30000, nextSpontaneousFreeze = performance.now() + 150000, ghostNext = 0, stroops = 0, ghostT = -1;
function lifeThink(now) {
  const watching = TV.state !== 'off';
  const up = unityPos();
  // idle bits: she stands still, they start bickering
  if (!busy && !watching && intro.done && now - lastActive > 16000) {
    if (R() < 0.25) startPair(); else startBit();
    lastActive = now; return;
  }
  if (!busy && !watching && intro.done && now > nextWander) {
    nextWander = now + 30000 + R() * 25000;
    const r = R() < 0.5 ? CH : MI; if (r === MI && MI.frozen) return;
    if (Math.hypot(up.x - r.x, up.z - r.z) < 6) conv([[r.name, pick(r.name + '_wander')]]);
  }
  if (!busy && !watching && intro.done && now > nextSpontaneousFreeze && !MI.frozen) {
    nextSpontaneousFreeze = now + 150000 + R() * 90000;
    milesFreeze(true).then(() => setTimeout(() => { if (MI.frozen && !quitting) milesWait(); }, 7000));
  }
  // wandering targets
  for (const r of [CH, MI, SI]) {
    if (busy && (r === CH || r === MI || r === busyPartner)) continue;
    if (r === MI && MUSIC.on) { goTo(MI, 2.75, -1.5, [3.45, -1.5]); continue; }
    if (watching && r === CH) { goTo(CH, -2.4, 1.0, [W.tv.screen[0], W.tv.screen[2]]); continue; }
    if (arrived(r, 0.15) && R() < 0.004) { const s = r === CH ? freeSpot(R() < 0.6 ? r.home : null, 1.0, [up.x, up.z]) : freeSpot(R() < 0.4 ? r.home : null, 1.5, [up.x, up.z]); goTo(r, s[0], s[1], R() < 0.6 ? [up.x, up.z] : null); }
  }
  if (!mayaSitting && !MA.goingSit && arrived(MA, 0.15)) MA.faceAt = [up.x, up.z];
  // the vending machine ghost
  if (Math.hypot(up.x - W.vending.c[0], up.z - W.vending.c[2]) < 1.7 && now > ghostNext && ghostT < 0) { ghostT = 0; ghostNext = now + 25000; sfx('whoosh', pans.vend); dbg('ghost'); }
}
function ghostThink(dt) {
  const g = W.ghost; if (ghostT < 0) { g.g.visible = false; return; }
  ghostT += dt; g.g.visible = true;
  const e = ghostT;
  g.m.uniforms.uAlpha.value = e < 0.6 ? e / 0.6 * 0.7 : e > 3.2 ? Math.max(0, 0.7 - (e - 3.2) / 0.6 * 0.7) : 0.7;
  g.g.position.set(3.05 - Math.min(1, e / 2.5) * 0.15, 1.5 - Math.min(1, e / 2.5) * 1.05 + Math.sin(e * 4) * 0.04, 1.6 - e * 0.12);
  g.g.rotation.y = -Math.PI / 2 + Math.sin(e * 3) * 0.3;
  if (e > 2.4 && !g.dropped) { g.dropped = true; W.stroop[stroops % 5].visible = true; stroops++; sfx('clunk', ...W.vending.tray); dbg('stroopwafel', stroops); }
  if (e > 3.9) { ghostT = -1; g.dropped = false; }
}

// ---------------------------------------------------------------- interactions
const epBag = bag(EPS.map((e, i) => i));
let cartBusy = false;
async function charlieHandsCart(hand) {
  if (cartBusy) return; cartBusy = true; cancelConv(); lastActive = performance.now();
  const up = unityPos(); CH.faceAt = [up.x, up.z];
  CH.armPose = 1; CH.parts.armR.rotation.x = -2.7;
  const ep = EPS[epBag()];
  const c = W.cartMesh(ep.color); c.userData.ep = ep;
  CH.parts.armR.add(c); c.position.set(0, -0.36, 0.02);
  sfx('beep', pans.charlie);
  conv([['charlie', pick('charlie_cart')]]);
  await wait(1.1);
  CH.armPose = 0; CH.parts.armR.rotation.x = 0;
  hold(c, 'cart', ep, hand); cartBusy = false; dbg('cart handed', ep.number);
}
function refuseS2(obj) { cancelConv(); lastActive = performance.now(); conv([['charlie', pick('charlie_s2')]]); if (obj) { obj.userData.wig = 1; } CH.wob = 0.5; dbg('s2 refused'); }
function grabBook(i, hand) {
  const b = SI.books[i]; if (b.held || held) return;
  b.held = true; hold(b.g, 'book', i, hand); b.g.rotation.set(-0.4, 0, 0);
  cancelConv(); lastActive = performance.now(); sfx('beep', pans.simone);
  const myHeld = held;
  conv([['simone', pick('simone_book')]]).then(() => setTimeout(() => { if (held === myHeld) release(); }, 600));
}
function burst(p) { W.U.uHit.value.copy(p); W.U.uHitT.value = W.U.uTime.value; sfx('crumble', p.x, p.y, p.z); dbg('burst'); }
function interact(hit, hand) {
  initAudio(); lastActive = performance.now();
  const o = hit ? hit.object : null, kind = o ? o.userData.kind : null;
  dbg('interact', kind || 'none', hand);
  if (held) {
    if (held.kind === 'cart' && kind === 'tv') { const h = held; held = null; tvInsert(h.data, h.obj); return; }
    if (held.kind === 'note' && kind !== 'note') { const h = held; held = null; dropNote(h, false); return; }
    if (held.kind === 'book') { release(); return; }
    if (held.kind === 'cart') release();
  }
  switch (kind) {
    case 'charlie': pokeCharlie(); break;
    case 'miles': pokeMiles(); break;
    case 'maya': mayaWave(2); MA.wob = 0.5; break;
    case 'simone': sfx('beep', pans.simone); SI.wob = 0.6; break;
    case 'roomba': sfx('bump', pans.roomba); RO.wob = 1; break;
    case 'lawyer': openBriefcase(); break;
    case 'crate': charlieHandsCart(hand); break;
    case 'cart_s2': refuseS2(o.parent); break;
    case 'book': grabBook(o.userData.book, hand); break;
    case 'note': takeNote(o.userData.id, hand); break;
    case 'tv': if (TV.state !== 'off') tvStop(); else { CH.faceAt = [unityPos().x, unityPos().z]; if (!busy) conv([['charlie', 'c_cart']]); } break;
    case 'couch': sitDown(); break;
    case 'turntable': case 'records': initAudio(); musicToggle(); sfx('clunk', ...W.turntable.c); break;
    case 'nr_wait': milesWait(); break;
    case 'nr_quit': milesForceQuit(); break;
    case 'wall': if (hit.point) burst(hit.point); break;
  }
}
const ray = new T.Raycaster(); ray.far = 12;
function shown(o) { for (; o; o = o.parent) if (o.visible === false) return false; return true; }
function castFrom(origin, dir) {
  ray.set(origin, dir);
  const hs = ray.intersectObjects(W.hit, false);
  for (const h of hs) { if (!shown(h.object)) continue; if (held && h.object === held.obj) continue; if (held && held.obj && isDesc(h.object, held.obj)) continue; return h; }
  return null;
}
function isDesc(o, p) { for (; o; o = o.parent) if (o === p) return true; return false; }

// ---------------------------------------------------------------- desktop + touch input
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'KeyC') { crouch = !crouch; sitToggle = false; } if (e.code === 'Space') { sitToggle = false; crouch = false; } });
addEventListener('keyup', e => { keys[e.code] = false; });
let drag = null;
const cv = renderer.domElement;
cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => {
  if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 6) drag.moved = true;
  if (drag.moved) { yaw -= dx * 0.004; pitch = clamp(pitch - dy * 0.004, -1.3, 1.3); }
});
cv.addEventListener('pointerup', e => {
  if (drag && !drag.moved) {
    const m = new T.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(m, camera); const h = castFrom(ray.ray.origin.clone(), ray.ray.direction.clone()); interact(h, 'mouse');
  }
  drag = null;
});
const touchMove = { x: 0, y: 0 };
function pad(id, cb) { const el = $(id); if (!el) return; const f = e => { const r = el.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; cb(clamp((t.clientX - r.left) / r.width * 2 - 1, -1, 1), clamp((t.clientY - r.top) / r.height * 2 - 1, -1, 1)); e.preventDefault(); }; el.addEventListener('touchstart', f, { passive: false }); el.addEventListener('touchmove', f, { passive: false }); el.addEventListener('touchend', () => cb(0, 0)); }
pad('padL', (x, y) => { touchMove.x = x; touchMove.y = y; });

// ---------------------------------------------------------------- XR controllers
const ctrls = [];
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  const lg = new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, 0), new T.Vector3(0, 0, -1)]);
  const line = new T.Line(lg, new T.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.6 })); line.scale.z = 3; c.add(line);
  const tip = new T.Mesh(new T.BoxGeometry(0.03, 0.03, 0.05), new T.MeshBasicMaterial({ color: 0xffd27a })); c.add(tip);
  c.userData.line = line;
  c.addEventListener('connected', e => { c.userData.hand = e.data.handedness; c.userData.gp = e.data.gamepad; holders[e.data.handedness] = c; });
  c.addEventListener('disconnected', () => { c.userData.gp = null; });
  const act = () => { c.updateMatrixWorld(true); const o = V3().setFromMatrixPosition(c.matrixWorld), d = V3().set(0, 0, -1).transformDirection(c.matrixWorld); interact(castFrom(o, d), c.userData.hand || 'right'); };
  c.addEventListener('selectstart', act);
  c.addEventListener('squeezestart', act);
  rig.add(c); ctrls.push(c);
}
const pokeCool = {};
function physicalPokes(now) {
  for (const c of ctrls) {
    if (!c.userData.gp) continue;
    const p = V3().setFromMatrixPosition(c.matrixWorld);
    for (const r of [CH, MI, MA, SI]) {
      if ((pokeCool[r.name] || 0) > now) continue;
      const dx = p.x - r.x, dz = p.z - r.z;
      if (Math.hypot(dx, dz) < 0.24 && p.y > 0.1 && p.y < r.height + 0.05) {
        pokeCool[r.name] = now + 1500; c.userData.gp.hapticActuators && c.userData.gp.hapticActuators[0] && c.userData.gp.hapticActuators[0].pulse(0.6, 60);
        interact({ object: { userData: { kind: r.name } } }, c.userData.hand);
      }
    }
    if (held && held.kind === 'cart' && held.hand === c.userData.hand && p.distanceTo(tmp.set(...W.tv.console)) < 0.3) { const h = held; held = null; tvInsert(h.data, h.obj); }
  }
}
function xrMove(dt) {
  let mx = 0, mz = 0, turn = 0;
  for (const c of ctrls) {
    const gp = c.userData.gp; if (!gp || !gp.axes) continue;
    const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0], ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1];
    if (c.userData.hand === 'left') { mx = Math.abs(ax) > 0.15 ? ax : 0; mz = Math.abs(ay) > 0.15 ? ay : 0; }
    else if (c.userData.hand === 'right') turn = Math.abs(ax) > 0.25 ? ax : 0;
  }
  const xrCam = renderer.xr.getCamera(); xrCam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  if (mx || mz) {
    const sp = 1.5 * dt, rx = -fwd.z, rz = fwd.x;
    const dx = (fwd.x * -mz + rx * mx) * sp, dz = (fwd.z * -mz + rz * mx) * sp;
    moveBy(dx, dz);
  }
  if (turn) {
    const head = unityPos(), a = -turn * 1.8 * dt;
    rig.position.sub(head.clone().setY(0)); rig.position.applyAxisAngle(new T.Vector3(0, 1, 0), a); rig.position.add(head.setY(0)); rig.rotation.y += a;
  }
}
function moveBy(dx, dz) {
  const p = unityPos(); const inside = blocked(p.x, p.z, 0.2);
  if (!blocked(p.x + dx, p.z, 0.2) || inside) rig.position.x += dx;
  if (!blocked(p.x, p.z + dz, 0.2) || inside) rig.position.z += dz;
  if (Math.abs(dx) + Math.abs(dz) > 0.001 && sitToggle && !inCouchZone(unityPos())) sitToggle = false;
}
let anchor = null;
function activity(now) {
  const p = unityPos();
  if (!anchor || Math.hypot(p.x - anchor.x, p.z - anchor.z) > 0.35) { anchor = p.clone(); lastActive = now; }
}

// ---------------------------------------------------------------- intro: the room stacks itself together around her
const intro = { t: -1, done: false };
async function greet() {
  await wait(0.4); mayaWave(2.6);
  await conv([['maya', 'y_hi']]);
  await conv([['miles', pick('miles_greet')]]);
  await conv([['charlie', pick('charlie_greet')]]);
  intro.done = true; lastActive = performance.now();
}

// ---------------------------------------------------------------- frame loop
const clock = new T.Clock();
let started = false, frames = 0, fpsAcc = 0, fps = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime, now = performance.now();
  W.U.uTime.value = t; frames++; fpsAcc += dt; if (fpsAcc > 1) { fps = frames / fpsAcc; frames = 0; fpsAcc = 0; }
  if (intro.t >= 0 && intro.t < 4.5) { intro.t += dt; W.U.uAsm.value = Math.min(1, intro.t / 3.6); }
  // movement
  if (renderer.xr.isPresenting) { xrMove(dt); physicalPokes(now); }
  else {
    let f = 0, s = 0;
    if (keys.KeyW || keys.ArrowUp) f += 1; if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyA) s -= 1; if (keys.KeyD) s += 1;
    if (keys.ArrowLeft || keys.KeyQ) yaw += dt * 1.8; if (keys.ArrowRight || keys.KeyE) yaw -= dt * 1.8;
    f -= touchMove.y; s += touchMove.x;
    if (f || s) { const sp = 1.6 * dt; const fx = -Math.sin(yaw), fz = -Math.cos(yaw); moveBy((fx * f + Math.cos(yaw) * s) * sp, (fz * f - Math.sin(yaw) * s) * sp); }
    const eyeT = sitToggle ? 1.05 : crouch ? 0.85 : 1.62;
    camera.position.y += (eyeT - camera.position.y) * Math.min(1, dt * 8);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }
  rig.updateMatrixWorld(true);
  if (started) {
    activity(now); lifeThink(now); roombaThink(dt, t); lawyerThink(); mayaThink(dt); ghostThink(dt); musicTick();
  }
  for (const k in RB) stepRobot(RB[k], dt, t);
  // poses on top of walking
  const up = unityPos();
  if (waveT > 0) { waveT -= dt; MA.armPose = 1; MA.parts.armR.rotation.z = 2.6 + Math.sin(t * 9) * 0.35; MA.parts.armR.rotation.x = 0; } else if (MA.armPose) { MA.armPose = 0; }
  SI.parts.head.lookAt(up.x, up.y, up.z);
  for (const b of SI.books) { if (b.held) continue; b.a += dt * 0.6; const tx = Math.cos(b.a) * 0.42, tz = Math.sin(b.a) * 0.42, ty = 1.5 + Math.sin(b.a * 2) * 0.12; if (b.back > 0) { b.back = Math.max(0, b.back - dt); b.g.position.lerp(tmp.set(tx, ty, tz), Math.min(1, dt * 4)); } else b.g.position.set(tx, ty, tz); b.g.rotation.set(0, -b.a, 0.2); }
  for (const r of [CH, MI, MA]) {
    if (r.frozen || (r === MA && MA.sit)) continue;
    tmp.set(up.x, up.y, up.z); r.parts.head.parent.worldToLocal(tmp);
    const want = clamp(Math.atan2(tmp.x - r.parts.head.position.x, tmp.z - r.parts.head.position.z), -0.9, 0.9);
    r.parts.head.rotation.y += (want - r.parts.head.rotation.y) * Math.min(1, dt * 4);
    if (r === CH) CH.lookX = want * 3;
  }
  if (MUSIC.on && AC && !MI.frozen && arrived(MI, 0.2)) { const beat = (AC.currentTime - MUSIC.t0) * MUSIC.bpm / 60 + 0.23; MI.parts.head.rotation.x = Math.max(0, Math.sin(beat * Math.PI * 2)) * 0.28; }
  else MI.parts.head.rotation.x *= 0.9;
  if (MI.talk) MI.parts.head.rotation.z = Math.sin(t * 7) * 0.05; else MI.parts.head.rotation.z *= 0.9;
  if (MUSIC.on) W.record.rotation.y -= dt * 3.5;
  if (MI.nrBox.visible) MI.nrBox.lookAt(up.x, MI.nrBox.getWorldPosition(tmp2).y, up.z);
  RO.parts.body.rotation.y = RO.staring ? Math.sin(t * 2) * 0.05 : 0;
  for (const c of W.crate.carts) if (c.userData.wig > 0) { c.userData.wig -= dt; c.position.y = 0.2 + Math.abs(Math.sin(t * 30)) * 0.03 * c.userData.wig; }
  if (performance.now() < scoreUntil) { W.scorecard.visible = true; W.scorecard.position.set(LA.x, 0.5, LA.z); W.scorecard.lookAt(up.x, 0.5, up.z); } else W.scorecard.visible = false;
  for (const f of floorNotes) { f.t += dt; const k = Math.min(1, f.t / 0.8); f.m.position.set(f.x, f.y0 + (0.012 - f.y0) * k * k, f.z); f.m.rotation.set(-Math.PI / 2 * k, 0, f.t); }
  for (const n of notes.values()) if (n.fresh > 0) { n.fresh = Math.max(0, n.fresh - dt * 0.7); n.mesh.scale.setScalar(1 + Math.sin(n.fresh * 12) * 0.15 * n.fresh); }
  if (TV.state === 'static') { drawStatic(); if (now > TV.until) { TV.state = 'play'; screen.material.map = vtex; screen.material.needsUpdate = true; } }
  drawFace(dt, t);
  updateTrail(dt, t);
  for (const c of ctrls) { if (!c.userData.gp) continue; c.updateMatrixWorld(true); const o = V3().setFromMatrixPosition(c.matrixWorld), d = V3().set(0, 0, -1).transformDirection(c.matrixWorld); const h = castFrom(o, d); c.userData.line.scale.z = h ? h.distance : 3; c.userData.line.material.color.set(h && h.object.userData.kind && h.object.userData.kind !== 'wall' ? 0xffd27a : 0x6a7a80); }
  // listener
  if (AC) {
    const L = AC.listener; camera.getWorldDirection(fwd); const u = tmp2.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new T.Quaternion()));
    if (L.positionX) { L.positionX.value = up.x; L.positionY.value = up.y; L.positionZ.value = up.z; L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z; }
    else { L.setPosition(up.x, up.y, up.z); L.setOrientation(fwd.x, fwd.y, fwd.z, u.x, u.y, u.z); }
    for (const k of ['charlie', 'miles', 'maya', 'simone', 'roomba', 'lawyer']) { const r = RB[k]; setPan(pans[k], r.x, r.headY, r.z); }
  }
  if (!noRender || renderer.xr.isPresenting) renderer.render(scene, camera);
}
let noRender = false;
renderer.setAnimationLoop(frame);

// ---------------------------------------------------------------- start
function start() {
  initAudio();
  if (started) return; started = true;
  $('overlay').classList.add('hidden');
  intro.t = 0; sfx('crumble', 0, 1.3, 0); setTimeout(() => sfx('chime', 0, 1.5, 0), 3300);
  setTimeout(greet, 3800);
  loadWall();
}
fetch('dialog.json').then(r => r.json()).then(d => { Object.assign(D, d); $('status').textContent = ''; }).catch(e => { $('status').textContent = 'Could not load the lines: ' + e.message; });
$('walkBtn').onclick = () => start();
const vrBtn = $('vrBtn');
if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then(ok => { if (ok) { vrBtn.style.display = ''; } }).catch(() => {});
vrBtn.onclick = async () => {
  initAudio();
  try {
    const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    renderer.xr.setSession(s); camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
    rig.rotation.y = 0; s.addEventListener('end', () => { camera.position.y = 1.62; });
    start();
  } catch (e) { $('status').textContent = 'VR did not start: ' + e.message; }
};
W.U.uAsm.value = 0;

// test + debug hooks
window.__gtb = {
  get state() { return { started, fps: Math.round(fps), voxels: W.voxels, drawCalls: renderer.info.render.calls, tris: renderer.info.render.triangles, busy, bitsRun, lastBit, lastLine, linesSpoken, milesFrozen: !!MI.frozen, milesPokes, notes: notes.size, wall: WALL, held: held && held.kind, tv: TV.state, tvEp: TV.ep && TV.ep.number, music: MUSIC.on, stroops, roombaAte: RO.ate || 0, roombaStaring: !!RO.staring, lastBump: RO.lastBump || null, mayaSitting, sitting: isSitting(), voicesLoaded: Object.keys(buffers).length, asm: W.U.uAsm.value, log: log.slice(-30) }; },
  renderOff: v => { noRender = v; },
  snap: () => { rig.updateMatrixWorld(true); const t0 = performance.now(); renderer.render(scene, camera); const u = renderer.domElement.toDataURL('image/jpeg', 0.85); return { u, ms: performance.now() - t0 }; }, start, interact: (kind, extra) => interact({ object: Object.assign({ userData: Object.assign({ kind }, extra || {}) }, extra && extra.object || {}), point: extra && extra.point }, 'mouse'),
  startBit: name => startBit(D.bits.find(b => b.name === name)), setIdle: ms => { lastActive = performance.now() - ms; },
  teleport: (x, z, yw) => { rig.position.set(x, 0, z); if (yw != null) yaw = yw; }, crouch: v => { crouch = v; }, sit: () => sitDown(), stand: () => { sitToggle = false; rig.position.set(-0.6, 0, -0.4); },
  look: (y, p) => { yaw = y; pitch = p || 0; }, W, RB, D, notes, dropHeld: () => { if (held) { const h = held; held = null; if (h.kind === 'note') dropNote(h, false); else release(); } }
};
})();
