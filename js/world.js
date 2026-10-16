// Global Tribe Basement VR: the voxel world (room, furniture, robots). app.js runs the life in it.
// Everything is cubes: one instanced cube geometry, a tiny shader that can scatter (assemble / break apart / local burst).
(function () {
'use strict';
const T = THREE;
const W = window.GTB = { meshes: [], hit: [], robots: {} };
const R = Math.random;
const X0 = -4, X1 = 4, Z0 = -3.5, Z1 = 3.5, H = 2.6;
W.ROOM = { x0: X0, x1: X1, z0: Z0, z1: Z1, h: H };
const U = W.U = {
  uTime: { value: 0 }, uAsm: { value: 0 }, uHit: { value: new T.Vector3(0, -99, 0) }, uHitT: { value: -99 },
  uFog: { value: new T.Color(0x07060a) }
};
const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const jit = (c, a) => { const k = 1 + (R() - 0.5) * a; return [c[0] * k, c[1] * k, c[2] * k]; };
W.hex = hex; W.mix = mix;

// ---------------------------------------------------------------- baked light: a bare bulb, the TV, the vending machine, the window
const LIGHTS = [
  { p: [0.2, 2.2, -0.3], c: [1.0, 0.8, 0.52], i: 1.25, r: 6.2 },
  { p: [-3.2, 0.95, -0.5], c: [0.45, 0.62, 1.0], i: 0.45, r: 2.4 },
  { p: [3.2, 1.2, 1.4], c: [1.0, 0.38, 0.5], i: 0.55, r: 2.3 },
  { p: [2.5, 2.1, -3.3], c: [0.62, 0.78, 1.0], i: 0.5, r: 2.8 },
  { p: [-2.6, 2.1, 2.4], c: [1.0, 0.75, 0.45], i: 0.35, r: 3.0 }
];
function bake(c, x, y, z) {
  let r = 0.34, g = 0.32, b = 0.36;
  for (const L of LIGHTS) {
    const dx = L.p[0] - x, dy = L.p[1] - y, dz = L.p[2] - z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const f = L.i * Math.max(0, 1 - d / L.r) ** 2;
    r += L.c[0] * f; g += L.c[1] * f; b += L.c[2] * f;
  }
  const ds = [x - X0, X1 - x, z - Z0, Z1 - z, y, H - y].sort((a, b) => a - b);
  const ao = 0.62 + 0.38 * Math.min(1, ds[1] / 0.45);
  return [c[0] * r * ao, c[1] * g * ao, c[2] * b * ao];
}
W.bake = bake;

// ---------------------------------------------------------------- voxel builder
class Vox {
  constructor(s, baked) { this.s = s || 0.05; this.P = []; this.S = []; this.C = []; this.R = []; this.baked = baked !== false; }
  add(x, y, z, c, s) {
    s = s || this.s; if (this.baked && this.base) c = bake(c, x + this.base[0], y + this.base[1], z + this.base[2]);
    else if (this.baked && !this.base) c = bake(c, x, y, z);
    this.P.push(x, y, z); this.S.push(s); this.C.push(c[0], c[1], c[2]); this.R.push(R(), R(), R(), R());
  }
  // filled box, shell only by default. col: [r,g,b] (jittered) or fn(x,y,z,i,j,k,nx,ny,nz) -> [r,g,b] or null to skip
  box(x0, y0, z0, x1, y1, z1, col, o) {
    o = o || {}; const s = o.s || this.s;
    const nx = Math.max(1, Math.round((x1 - x0) / s)), ny = Math.max(1, Math.round((y1 - y0) / s)), nz = Math.max(1, Math.round((z1 - z0) / s));
    const sx = (x1 - x0) / nx, sy = (y1 - y0) / ny, sz = (z1 - z0) / nz, sz0 = Math.max(sx, sy, sz) * (o.gap || 0.965);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
      const shell = i === 0 || i === nx - 1 || j === 0 || j === ny - 1 || k === 0 || k === nz - 1;
      if (!shell && !o.solid) continue;
      if (!o.keepBottom && j === 0 && ny > 1 && y0 < 0.02) continue;
      const x = x0 + (i + 0.5) * sx, y = y0 + (j + 0.5) * sy, z = z0 + (k + 0.5) * sz;
      let c = typeof col === 'function' ? col(x, y, z, i, j, k, nx, ny, nz) : jit(col, o.j == null ? 0.1 : o.j);
      if (!c) continue;
      this.add(x, y, z, c, sz0);
    }
  }
  // flat ellipse/disc (cylinder) along y
  cyl(cx, y0, cz, rx, rz, y1, col, o) {
    o = o || {}; const s = o.s || this.s;
    for (let x = cx - rx + s / 2; x < cx + rx; x += s) for (let z = cz - rz + s / 2; z < cz + rz; z += s) {
      const e = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2; if (e > 1) continue;
      const rim = e > (1 - 2.2 * s / Math.min(rx, rz));
      for (let y = y0 + s / 2; y < y1; y += s) {
        const cap = y - s / 2 <= y0 + 1e-4 || y + s / 2 >= y1 - 1e-4;
        if (!rim && !cap && !o.solid) continue;
        const c = typeof col === 'function' ? col(x, y, z, rim, cap, e) : jit(col, o.j == null ? 0.1 : o.j); if (!c) continue;
        this.add(x, y, z, c, s * 0.965);
      }
    }
  }
  sphere(cx, cy, cz, r, col, o) {
    o = o || {}; const s = o.s || this.s;
    for (let x = -r + s / 2; x < r; x += s) for (let y = -r + s / 2; y < r; y += s) for (let z = -r + s / 2; z < r; z += s) {
      const d = Math.sqrt(x * x + y * y + z * z); if (d > r || d < r - s * 1.5) continue;
      const c = typeof col === 'function' ? col(x, y, z, d) : jit(col, 0.1); if (!c) continue;
      this.add(cx + x, cy + y, cz + z, c, s * 0.965);
    }
  }
}
W.Vox = Vox;

const VS = `
attribute vec3 aPos; attribute float aSize; attribute vec3 aCol; attribute vec4 aRnd;
uniform float uBreak, uAsm, uTime, uHitT, uLocal, uGlow, uFly;
uniform vec3 uHit, uTint;
varying vec3 vCol; varying float vDist;
void main(){
  float a = clamp(uAsm * 1.8 - aRnd.w * 0.8, 0., 1.); a = a * a * (3. - 2. * a);
  a = mix(1., a, uFly);
  vec3 dir = aRnd.xyz * 2. - 1.;
  float k = max(1. - a, uBreak * (0.6 + 0.4 * aRnd.w));
  vec3 wc = (modelMatrix * vec4(aPos, 1.)).xyz;
  float hk = 0.;
  float ht = uTime - uHitT;
  if (uLocal > 0.5 && ht > 0. && ht < 3.2) {
    float d = distance(wc, uHit);
    if (d < 0.75) { float e = ht < 0.3 ? ht / 0.3 : 1. - smoothstep(0.3, 3.0 - aRnd.w * 0.6, ht); hk = e * (1. - d / 0.75); }
  }
  vec3 off = dir * (k * vec3(2.4, 1.5, 2.4) + hk * 0.5) + vec3(0., k * 1.1 * aRnd.y + hk * 0.25 * aRnd.y, 0.);
  float ang = (k + hk) * 7. * (aRnd.x - .5);
  float c = cos(ang), s = sin(ang);
  mat2 rm = mat2(c, -s, s, c);
  vec3 p = position * aSize * (1. - 0.3 * k);
  p.xz = rm * p.xz; p.xy = rm * p.xy;
  vec3 n = normal; n.xz = rm * n.xz; n.xy = rm * n.xy;
  n = normalize(mat3(modelMatrix) * n);
  float sh = 0.8 + 0.2 * n.y + 0.07 * n.x;
  if (n.y < -0.5) sh = 0.62;
  vCol = aCol * sh * uTint + aCol * uGlow;
  vec4 mv = viewMatrix * modelMatrix * vec4(aPos + off + p, 1.);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
uniform vec3 uFog; uniform float uAlpha;
varying vec3 vCol; varying float vDist;
void main(){
  float f = 1. - exp(-vDist * 0.05);
  gl_FragColor = vec4(mix(vCol, uFog, f * 0.4), uAlpha);
}`;
const CUBE = new T.BoxGeometry(1, 1, 1);
function mat(o) {
  o = o || {};
  const m = new T.ShaderMaterial({
    uniforms: {
      uTime: U.uTime, uAsm: U.uAsm, uHit: U.uHit, uHitT: U.uHitT, uFog: U.uFog,
      uBreak: { value: 0 }, uGlow: { value: o.glow || 0 }, uTint: { value: new T.Color(1, 1, 1) }, uAlpha: { value: o.alpha == null ? 1 : o.alpha },
      uLocal: { value: o.local ? 1 : 0 }, uFly: { value: o.fly == null ? 1 : o.fly }
    }, vertexShader: VS, fragmentShader: FS, transparent: o.alpha != null, depthWrite: o.alpha == null
  });
  return m;
}
W.mat = mat;
function mesh(v, m) {
  const g = new T.InstancedBufferGeometry();
  g.index = CUBE.index; g.setAttribute('position', CUBE.attributes.position); g.setAttribute('normal', CUBE.attributes.normal);
  g.setAttribute('aPos', new T.InstancedBufferAttribute(new Float32Array(v.P), 3));
  g.setAttribute('aSize', new T.InstancedBufferAttribute(new Float32Array(v.S), 1));
  g.setAttribute('aCol', new T.InstancedBufferAttribute(new Float32Array(v.C), 3));
  g.setAttribute('aRnd', new T.InstancedBufferAttribute(new Float32Array(v.R), 4));
  g.instanceCount = v.S.length;
  const me = new T.Mesh(g, m || mat()); me.frustumCulled = false; me.userData.count = v.S.length;
  W.meshes.push(me);
  return me;
}
W.mesh = mesh;
function proxy(kind, x0, y0, z0, x1, y1, z1, parent, extra) {
  const p = new T.Mesh(new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), new T.MeshBasicMaterial({ visible: false }));
  p.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); p.userData = Object.assign({ kind }, extra || {});
  (parent || W.scene).add(p); W.hit.push(p); return p;
}
W.proxy = proxy;
function canvasTex(w, h, draw, nearest) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new T.CanvasTexture(c); if (nearest) { t.magFilter = T.NearestFilter; t.minFilter = T.LinearFilter; }
  t.userData = { canvas: c, g }; return t;
}
W.canvasTex = canvasTex;
function plane(w, h, tex, o) {
  o = o || {};
  const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, transparent: !!o.transparent, toneMapped: false, side: o.double ? T.DoubleSide : T.FrontSide, depthWrite: o.depthWrite !== false }));
  return m;
}
W.plane = plane;

// ---------------------------------------------------------------- the room
W.solids = [];   // [x0,z0,x1,z1] where Unity can't walk
function solid(x0, z0, x1, z1) { W.solids.push([x0, z0, x1, z1]); }
function buildRoom(scene) {
  const v = new Vox(0.1);
  const WS = 0.1;
  // floor: concrete with stains, a drain, a rug in front of the couch
  const rugC = [hex('#8a3b24'), hex('#c2702e'), hex('#e3b25a'), hex('#5b2a1e')];
  for (let x = X0 + WS / 2; x < X1; x += WS) for (let z = Z0 + WS / 2; z < Z1; z += WS) {
    let c = mix(hex('#5f5c58'), hex('#77736c'), (Math.sin(x * 1.7) * Math.cos(z * 1.3) + 1) / 2 * 0.6 + R() * 0.4);
    const st = Math.sin(x * 0.9 + 2) * Math.sin(z * 0.7 - 1); if (st > 0.72) c = mix(c, hex('#3b3833'), 0.45);
    let y = -0.05 + (R() - 0.5) * 0.006;
    if (x > -3.15 && x < -0.75 && z > -1.9 && z < 0.9) {   // rug
      const ring = Math.max(Math.abs(x + 1.95) / 1.2, Math.abs(z + 0.5) / 1.4);
      c = rugC[Math.floor(ring * 7) % 4]; c = jit(c, 0.12); y = -0.04;
    }
    v.add(x, y, z, c, WS * 0.985);
  }
  // walls: painted cinderblock (blocks 0.4 x 0.2), wood paneling on the lower part of the couch wall
  const block = (u, y, base) => {
    const row = Math.floor(y / 0.2), col = Math.floor((u + (row % 2) * 0.2) / 0.4);
    const mort = (y % 0.2) < 0.1 && ((u + (row % 2) * 0.2) % 0.4) < 0.1;
    const k = 0.92 + ((row * 7 + col * 13) % 5) * 0.025;
    let c = [base[0] * k, base[1] * k, base[2] * k];
    if (mort) c = mix(c, [0.25, 0.24, 0.23], 0.25);
    return jit(c, 0.05);
  };
  const wallBase = hex('#b9b2a2'), panel = hex('#7a5232');
  const wallVox = (x, y, z, c) => v.add(x, y, z, c, WS * 0.985);
  for (let u = X0 + WS / 2; u < X1; u += WS) for (let y = WS / 2; y < H; y += WS) {
    const dz = (R() - 0.5) * 0.012;
    if (!(u > 2.15 && u < 2.85 && y > 1.85 && y < 2.35)) wallVox(u, y, Z0 - 0.05 + dz, block(u - X0, y, wallBase));    // back wall (window gap)
    wallVox(u, y, Z1 + 0.05 + dz, block(u - X0, y, wallBase));                                                           // front wall
  }
  for (let u = Z0 + WS / 2; u < Z1; u += WS) for (let y = WS / 2; y < H; y += WS) {
    const dz = (R() - 0.5) * 0.012;
    let cl = block(u - Z0, y, wallBase);
    if (y < 1.1) { const plank = Math.floor((u - Z0) / 0.2); cl = jit(mix(panel, hex('#5a3a22'), (plank % 3) * 0.2), 0.08); if (Math.abs(y - 1.05) < 0.06) cl = hex('#3e2716'); }
    wallVox(X0 - 0.05 + dz, y, u, cl);
    wallVox(X1 + 0.05 + dz, y, u, block(u - Z0, y, mix(wallBase, hex('#a9a89a'), 0.4)));
  }
  // window (back wall, high): frame + glass glow
  v.box(2.1, 1.8, Z0 - 0.02, 2.9, 1.86, Z0 + 0.06, hex('#d9d3c4'));
  v.box(2.1, 2.34, Z0 - 0.02, 2.9, 2.4, Z0 + 0.06, hex('#d9d3c4'));
  // ceiling joists + subfloor
  const subfloor = new T.Mesh(new T.PlaneGeometry(X1 - X0, Z1 - Z0), new T.MeshBasicMaterial({ color: 0x2a2219 }));
  subfloor.rotation.x = Math.PI / 2; subfloor.position.set(0, H + 0.02, 0); scene.add(subfloor);
  const vj = new Vox(0.05);
  for (let x = X0 + 0.3; x < X1; x += 0.6) vj.box(x - 0.04, H - 0.24, Z0, x + 0.04, H, Z1, hex('#8a6440'), { j: 0.12, s: 0.1 });
  vj.box(X0, H - 0.32, -0.06, X1, H - 0.22, 0.04, hex('#6f5034'), { s: 0.1 });                    // beam
  vj.box(X0, H - 0.34, 2.2, X1, H - 0.3, 2.24, hex('#b06a3a'), { j: 0.05 });          // copper pipe
  vj.box(X0, H - 0.4, -2.0, X1, H - 0.34, -1.94, hex('#9a9a9a'), { j: 0.05 });        // water pipe
  // the bulb on its cord
  vj.box(0.18, 2.12, -0.32, 0.22, H - 0.22, -0.28, hex('#222'), { j: 0 });
  // furniture
  buildFurniture(v, vj);
  const room = mesh(v, mat({ local: true })); scene.add(room);
  const fine = mesh(vj, mat({ local: true })); scene.add(fine);
  const bulb = mesh((() => { const b = new Vox(0.03, false); b.sphere(0.2, 2.08, -0.3, 0.06, [2.2, 1.8, 1.1]); return b; })(), mat({ glow: 0 })); scene.add(bulb);
  const winGlow = plane(0.7, 0.48, null); winGlow.material.color.set(0x6f8fb8); winGlow.position.set(2.5, 2.1, Z0 - 0.04); scene.add(winGlow);
  W.roomMeshes = [room, fine, bulb];
  // walls/floor are hit targets for the cube burst
  proxy('wall', X0 - 0.2, 0, Z0 - 0.2, X1 + 0.2, H, Z0, scene);
  proxy('wall', X0 - 0.2, 0, Z1, X1 + 0.2, H, Z1 + 0.2, scene);
  proxy('wall', X0 - 0.2, 0, Z0, X0, H, Z1, scene);
  proxy('wall', X1, 0, Z0, X1 + 0.2, H, Z1, scene);
  proxy('wall', X0, -0.2, Z0, X1, 0, Z1, scene);
}

function buildFurniture(v, f) {
  // ---- couch (70s brown corduroy), facing the TV on the left wall
  const cord = hex('#7b5a35'), cord2 = hex('#6a4b2b');
  const corduroy = (x, y, z, i, j, k) => jit(k % 2 ? cord : cord2, 0.08);
  f.box(-2.15, 0.0, -1.55, -1.3, 0.12, 0.55, hex('#3a2a1a'), { s: 0.1 });            // base
  f.box(-2.15, 0.12, -1.55, -1.3, 0.42, 0.55, corduroy, { s: 0.07 });                 // seat block
  f.box(-1.5, 0.42, -1.55, -1.25, 0.95, 0.55, corduroy, { s: 0.07 });                 // backrest
  f.box(-2.2, 0.12, -1.75, -1.25, 0.66, -1.5, corduroy, { s: 0.07 });                 // arms
  f.box(-2.2, 0.12, 0.5, -1.25, 0.66, 0.75, corduroy, { s: 0.07 });
  for (const [z0, z1, stain] of [[-1.5, -0.84, false], [-0.82, -0.16, true], [-0.14, 0.5, false]])
    f.box(-2.12, 0.42, z0, -1.5, 0.55, z1, (x, y, z) => { let c = jit(hex('#8c6a40'), 0.08); if (stain && (x + 1.8) ** 2 + (z + 0.45) ** 2 < 0.03 && y > 0.5) c = mix(c, hex('#4a3420'), 0.6); return c; }, { s: 0.065 });
  solid(-2.25, -1.8, -1.2, 0.8);
  W.couch = { x0: -2.15, x1: -1.3, z0: -1.55, z1: 0.55, seatY: 0.55, seats: [[-1.8, -1.15], [-1.8, -0.45], [-1.8, 0.2]] };
  proxy('couch', -2.15, 0.1, -1.55, -1.3, 0.6, 0.55);
  // ---- TV cabinet + CRT with wood-grain sides, console with a cartridge slot
  f.box(-3.95, 0, -1.2, -3.35, 0.55, 0.2, (x, y, z, i, j) => jit(mix(hex('#6b4426'), hex('#7d5330'), (j % 3) / 3), 0.06), { s: 0.07 });
  f.box(-3.85, 0.55, -0.95, -3.2, 1.12, -0.05, (x, y, z) => {
    const front = x > -3.26; if (front && y > 0.62 && y < 1.06 && z > -0.88 && z < -0.12) return null;   // screen hole
    return front ? jit(hex('#2b2723'), 0.06) : jit(mix(hex('#7a4f2b'), hex('#5e3b1f'), R()), 0.04);
  });
  f.box(-3.88, 0.6, -0.9, -3.84, 1.08, -0.1, hex('#111'));                 // back of the tube
  f.box(-3.24, 0.62, 0.0, -3.21, 0.66, 0.06, hex('#c9a227'));              // knob
  f.box(-3.6, 0.55, 0.0, -3.3, 0.62, 0.2, hex('#3a3a40'));                 // console
  f.box(-3.5, 0.62, 0.06, -3.38, 0.64, 0.16, hex('#111'));                 // slot
  solid(-4, -1.25, -3.15, 0.25);
  W.tv = { screen: [-3.205, 0.84, -0.5], console: [-3.45, 0.64, 0.11] };
  proxy('tv', -3.9, 0.5, -1.0, -3.15, 1.15, 0.22);
  // ---- message wall (corkboard, back wall)
  f.box(-0.75, 0.88, Z0, 2.35, 2.12, Z0 + 0.08, (x, y, z, i, j, k, nx, ny) => (i < 2 || i >= nx - 2 || j < 2 || j >= ny - 2) ? jit(hex('#6e4a2a'), 0.08) : jit(mix(hex('#b88a55'), hex('#a0703f'), R()), 0.05), { s: 0.06 });
  W.board = { x0: -0.6, x1: 2.2, y0: 1.0, y1: 2.0, z: Z0 + 0.1 };
  // a wobbly guest chair under it
  f.box(1.6, 0, -3.0, 1.62 + 0.04, 0.45, -2.96, hex('#9a6b3c')); f.box(2.0, 0, -3.0, 2.04, 0.4, -2.96, hex('#9a6b3c'));
  f.box(1.6, 0, -2.6, 1.64, 0.45, -2.56, hex('#9a6b3c')); f.box(2.0, 0, -2.6, 2.04, 0.45, -2.56, hex('#9a6b3c'));
  f.box(1.58, 0.45, -3.02, 2.06, 0.5, -2.54, hex('#b07a45')); f.box(1.58, 0.5, -3.08, 2.06, 0.95, -3.02, hex('#b07a45'));
  solid(1.5, -3.5, 2.15, -2.45);
  // ---- scoreboard: DRAW in red LEDs with a bite out of the corner
  const font = { D: ['110', '101', '101', '101', '110'], R: ['110', '101', '110', '101', '101'], A: ['010', '101', '111', '101', '101'], W: ['10001', '10001', '10101', '10101', '01010'] };
  const sx0 = -2.75, sy0 = 1.62, ss = 0.04, bite = (x, y) => (x - (-1.43)) ** 2 + (y - 2.12) ** 2 < 0.035;
  f.box(-2.95, 1.5, Z0, -1.35, 2.15, Z0 + 0.06, (x, y) => bite(x, y) ? null : jit(hex('#15151a'), 0.05));
  let cx = 0;
  for (const ch of 'DRAW') {
    const g = font[ch];
    for (let r = 0; r < 5; r++) for (let q = 0; q < g[r].length; q++) if (g[r][q] === '1') {
      const x = sx0 + 0.1 + (cx + q) * ss * 1.6, y = sy0 + 0.38 - r * ss * 1.6;
      if (!bite(x, y)) f.add(x, y, Z0 + 0.075, [1.6, 0.18, 0.12], ss);
    }
    cx += g[0].length + 1;
  }
  // ---- Krautrock corner: table + turntable + record crate
  f.box(3.1, 0, -2.0, 3.9, 0.72, -1.0, (x, y, z, i, j, k, nx, ny) => (j >= ny - 1 || ((i < 1 || i >= nx - 1) && (k < 1 || k >= 19))) ? jit(hex('#5b3d26'), 0.06) : null);
  f.box(3.2, 0.72, -1.85, 3.75, 0.8, -1.2, hex('#23201d'));          // deck
  f.box(3.66, 0.8, -1.32, 3.7, 0.86, -1.26, hex('#c0c0c0'));         // tonearm base
  solid(3.0, -2.1, 4, -0.9);
  W.turntable = { c: [3.45, 0.81, -1.52] };
  proxy('turntable', 3.1, 0.6, -2.0, 3.9, 1.0, -1.0);
  f.box(3.35, 0, -0.75, 3.85, 0.38, -0.3, (x, y, z, i, j, k, nx, ny, nz) => (k === 0 || k === nz - 1 || i === 0 || i === nx - 1 || j === 0) ? jit(hex('#8a6a43'), 0.08) : null);
  const sleeves = ['#d43c2c', '#e8d24a', '#2c6fd4', '#111111', '#e9e2cf', '#3aa36b', '#c45ad1', '#ff8a1f'];
  for (let q = 0; q < 8; q++) f.box(3.39 + q * 0.055, 0.04, -0.7, 3.42 + q * 0.055, 0.42 - (q % 3) * 0.02, -0.35, hex(sleeves[q]), { s: 0.03, j: 0.06 });
  solid(3.3, -0.8, 4, -0.25);
  W.records = { c: [3.6, 0.4, -0.52] };
  proxy('records', 3.3, 0, -0.8, 3.9, 0.5, -0.25);
  // ---- haunted vending machine
  const items = ['#e04a3a', '#f2c94c', '#56ccf2', '#6fcf97', '#bb6bd9', '#f2994a'];
  f.box(3.3, 0, 0.95, 3.95, 1.85, 1.85, (x, y, z, i, j, k) => {
    const front = x < 3.34;
    if (front && y > 0.65 && y < 1.62 && z > 1.02 && z < 1.58) {
      const row = Math.floor((y - 0.65) / 0.16), col = Math.floor((z - 1.02) / 0.09);
      return ((y - 0.65) % 0.16) < 0.06 ? hex('#cfcfcf') : jit(hex(items[(row + col * 2) % 6]), 0.15);
    }
    if (front && y > 1.66 && y < 1.8) return [1.5, 0.42, 0.62];
    if (front && y > 0.18 && y < 0.36 && z > 1.05 && z < 1.55) return hex('#0c0c0c');
    return jit(front ? hex('#8c1d2a') : hex('#701622'), 0.06);
  }, { s: 0.06 });
  solid(3.2, 0.85, 4, 1.95);
  W.vending = { tray: [3.28, 0.24, 1.3], c: [3.3, 1.0, 1.4] };
  // ---- stairs up to the house (front right)
  for (let q = 0; q < 12; q++) {
    const x0 = 1.0 + q * 0.24, y1 = 0.2 * (q + 1);
    f.box(x0, y1 - 0.05, 2.75, x0 + 0.26, y1, 3.5, hex('#9a7046'), { j: 0.1 });
    f.box(x0, y1 - 0.2, 2.75, x0 + 0.03, y1 - 0.05, 3.5, hex('#6b4a2c'), { j: 0.06 });
  }
  f.box(1.0, 0, 2.7, 3.95, 0.05, 2.75, hex('#5a3d22'));
  for (let q = 0; q < 6; q++) f.box(1.1 + q * 0.5, 0.2 * (q * 2 + 1) + 0.0, 2.68, 1.13 + q * 0.5, 0.2 * (q * 2 + 1) + 0.9, 2.71, hex('#c9a46a'), { j: 0.05 });   // rail posts
  solid(0.9, 2.6, 4, 3.5);
  // ---- furnace + shelf with boxes + paint cans (front left)
  f.box(-3.9, 0, 2.5, -3.1, 1.75, 3.4, (x, y, z, i, j) => jit(j % 5 === 0 ? hex('#6c6c6c') : hex('#8e8f8c'), 0.05), { s: 0.08 });
  f.box(-3.6, 1.75, 2.8, -3.4, H - 0.2, 3.0, hex('#9c9c9c'), { j: 0.04 });
  f.box(-3.12, 0.3, 2.75, -3.08, 0.5, 2.95, [1.6, 0.6, 0.2]);           // pilot light
  solid(-4, 2.4, -3.0, 3.5);
  f.box(-2.9, 0, 3.15, -1.3, 1.6, 3.48, (x, y, z, i, j, k, nx, ny) => (j % 10 === 0 || i === 0 || i === nx - 1) ? jit(hex('#5c5f63'), 0.05) : null, { s: 0.05 });
  const bx = ['#b08a5a', '#a37b4c', '#c49b68'];
  for (let q = 0; q < 5; q++) f.box(-2.85 + q * 0.31, 0.52 + (q % 2) * 0.5, 3.18, -2.6 + q * 0.31, 0.78 + (q % 2) * 0.5, 3.45, hex(bx[q % 3]));
  f.cyl(-2.4, 0.05, 3.3, 0.09, 0.09, 0.27, hex('#d8d8d8'), { s: 0.03 }); f.cyl(-2.15, 0.05, 3.3, 0.09, 0.09, 0.27, hex('#3a74c4'), { s: 0.03 });
  solid(-3.0, 3.05, -1.2, 3.5);
  // ---- the basement laptop on a crate by the couch
  f.box(-1.1, 0, 0.75, -0.7, 0.36, 1.15, hex('#8a6a43'));
  f.box(-1.05, 0.36, 0.82, -0.75, 0.38, 1.08, hex('#3b3e45'), { s: 0.025 });
  f.box(-1.05, 0.38, 1.05, -0.75, 0.58, 1.08, (x, y) => y > 0.41 && y < 0.56 ? [0.4, 0.75, 1.3] : hex('#3b3e45'), { s: 0.025 });
  solid(-1.15, 0.7, -0.65, 1.2);
}

// ---------------------------------------------------------------- robots: groups of voxel parts, each robot one material (shared break)
function part(v, m, px, py, pz) { const me = mesh(v, m); const g = new T.Group(); g.position.set(px || 0, py || 0, pz || 0); g.add(me); return g; }
function robotBase(name, m) { const g = new T.Group(); g.name = name; return { name, g, m, parts: {}, x: 0, z: 0, yaw: 0, tx: 0, tz: 0, speed: 0.6, walk: 0, talk: 0 }; }

function buildCharlie() {
  const m = mat({ fly: 1 }), r = robotBase('charlie', m), s = 0.03;
  const beige = hex('#cbbd9e'), dark = hex('#3b3a3a');
  let v = new Vox(s, false); v.box(-0.07, 0, -0.06, 0.07, 0.13, 0.06, dark); r.parts.legL = part(v, m, -0.1, 0, 0);
  v = new Vox(s, false); v.box(-0.07, 0, -0.06, 0.07, 0.13, 0.06, dark); r.parts.legR = part(v, m, 0.1, 0, 0);
  r.parts.legL.children[0].position.y = -0.13; r.parts.legR.children[0].position.y = -0.13; r.parts.legL.position.y = r.parts.legR.position.y = 0.13;
  v = new Vox(s, false);
  v.box(-0.21, 0.13, -0.16, 0.21, 0.5, 0.16, (x, y, z) => {
    if (z > 0.14 && Math.abs(x) < 0.15 && Math.abs(y - 0.3) < 0.1) return (Math.floor((x + 1) / 0.06) % 2) ? hex('#3c3a35') : hex('#5d5a52');
    return jit(beige, 0.06);
  });
  v.add(0.12, 0.42, 0.17, [1.4, 0.3, 0.2], 0.03); v.add(0.16, 0.42, 0.17, [0.3, 1.2, 0.4], 0.03);
  r.parts.body = part(v, m);
  v = new Vox(s, false);
  v.box(-0.22, 0, -0.2, 0.22, 0.34, 0.17, (x, y, z) => { if (z > 0.15 && Math.abs(x) < 0.16 && y > 0.05 && y < 0.29) return null; return jit(hex('#d9cfb6'), 0.05); });
  v.box(-0.16, 0.05, 0.1, 0.16, 0.29, 0.13, hex('#0b120c'), { j: 0 });
  v.box(0.12, 0.34, -0.02, 0.15, 0.46, 0.01, dark); v.add(0.135, 0.47, -0.005, [1.4, 0.5, 0.2], 0.035);
  r.parts.head = part(v, m, 0, 0.5, 0);
  const face = canvasTex(64, 48, () => {}, true);
  const fp = plane(0.31, 0.235, face); fp.position.set(0, 0.17, 0.142); r.parts.head.add(fp); r.face = face;
  for (const sd of [-1, 1]) {
    v = new Vox(s, false); v.box(-0.035, -0.26, -0.04, 0.035, 0, 0.04, beige); v.box(-0.045, -0.31, -0.045, 0.045, -0.25, 0.05, dark);
    r.parts[sd < 0 ? 'armL' : 'armR'] = part(v, m, sd * 0.255, 0.47, 0);
  }
  for (const k in r.parts) r.g.add(r.parts[k]);
  r.headY = 0.72; r.speed = 0.55; r.height = 0.85;
  proxy('charlie', -0.25, 0, -0.22, 0.25, 0.86, 0.22, r.g);
  return r;
}
function buildMiles() {
  const m = mat({ fly: 1 }), r = robotBase('miles', m), s = 0.03;
  const bronze = (x, y, z) => { let c = mix(hex('#9c6532'), hex('#c58a4a'), R()); if (R() < 0.07) c = mix(c, hex('#4f9e86'), 0.7); return c; };
  for (const sd of [-1, 1]) {
    const v = new Vox(s, false); v.box(-0.035, -0.86, -0.04, 0.035, 0, 0.04, bronze); v.box(-0.05, -0.9, -0.05, 0.05, -0.84, 0.08, hex('#6a4220'));
    v.box(-0.045, -0.47, -0.045, 0.045, -0.41, 0.045, hex('#5b3a1d'));
    r.parts[sd < 0 ? 'legL' : 'legR'] = part(v, m, sd * 0.08, 0.9, 0);
  }
  let v = new Vox(s, false);
  v.box(-0.14, 0.88, -0.08, 0.14, 1.4, 0.08, bronze);
  v.box(-0.03, 1.4, -0.03, 0.03, 1.48, 0.03, hex('#5b3a1d'));
  v.add(0, 1.2, 0.09, [0.5, 1.5, 1.2], 0.035);
  r.parts.body = part(v, m);
  v = new Vox(s, false);
  v.box(-0.1, 0, -0.1, 0.1, 0.22, 0.1, bronze);
  v.box(-0.085, 0.09, 0.09, 0.085, 0.13, 0.11, [0.45, 1.7, 1.45], { j: 0 });   // the teal visor
  v.box(-0.01, 0.22, -0.01, 0.01, 0.32, 0.01, hex('#5b3a1d')); v.add(0, 0.33, 0, [1.8, 1.2, 0.5], 0.03);
  r.parts.head = part(v, m, 0, 1.48, 0);
  for (const sd of [-1, 1]) {
    v = new Vox(s, false); v.box(-0.03, -0.62, -0.03, 0.03, 0, 0.03, bronze); v.box(-0.04, -0.68, -0.04, 0.04, -0.6, 0.05, hex('#6a4220'));
    r.parts[sd < 0 ? 'armL' : 'armR'] = part(v, m, sd * 0.18, 1.38, 0);
  }
  for (const k in r.parts) r.g.add(r.parts[k]);
  r.headY = 1.6; r.speed = 0.7; r.height = 1.82;
  proxy('miles', -0.22, 0, -0.15, 0.22, 1.85, 0.15, r.g);
  // "not responding" box
  const nr = canvasTex(512, 200, (g, w, h) => {
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, w, h); g.fillStyle = '#2f5fb3'; g.fillRect(0, 0, w, 40);
    g.fillStyle = '#fff'; g.font = 'bold 24px monospace'; g.fillText('MILES.EXE', 14, 28);
    g.fillStyle = '#111'; g.font = '26px monospace'; g.fillText('Miles is not responding.', 22, 88);
    g.strokeStyle = '#333'; g.lineWidth = 3; g.fillStyle = '#d0d0d0';
    g.fillRect(40, 120, 190, 56); g.strokeRect(40, 120, 190, 56); g.fillRect(282, 120, 190, 56); g.strokeRect(282, 120, 190, 56);
    g.fillStyle = '#111'; g.font = 'bold 28px monospace'; g.fillText('Wait', 100, 158); g.fillText('Force Quit', 294, 158);
  });
  const box = plane(0.62, 0.242, nr, { double: true }); box.position.set(0, 2.18, 0); box.visible = false; r.g.add(box); r.nrBox = box;
  const bw = new T.Mesh(new T.PlaneGeometry(0.23, 0.07), new T.MeshBasicMaterial({ visible: false })); bw.position.set(-0.17, -0.06, 0.01); box.add(bw);
  const bf = new T.Mesh(new T.PlaneGeometry(0.23, 0.07), new T.MeshBasicMaterial({ visible: false })); bf.position.set(0.17, -0.06, 0.01); box.add(bf);
  bw.userData = { kind: 'nr_wait' }; bf.userData = { kind: 'nr_quit' }; W.hit.push(bw, bf);
  return r;
}
function buildMaya() {
  const m = mat({ fly: 1 }), r = robotBase('maya', m), s = 0.03;
  const warm = () => jit(mix(hex('#e0704f'), hex('#f0915c'), R()), 0.05);
  for (const sd of [-1, 1]) { const v = new Vox(s, false); v.box(-0.05, -0.5, -0.05, 0.05, 0, 0.05, hex('#b4553d')); v.box(-0.06, -0.54, -0.06, 0.06, -0.48, 0.08, hex('#5a2f22')); r.parts[sd < 0 ? 'legL' : 'legR'] = part(v, m, sd * 0.09, 0.54, 0); }
  let v = new Vox(s, false);
  v.box(-0.18, 0.52, -0.12, 0.18, 0.62, 0.12, hex('#b4553d'));
  v.box(-0.2, 0.62, -0.13, 0.2, 1.02, 0.13, warm);
  v.box(-0.15, 1.02, -0.1, 0.15, 1.08, 0.1, warm);
  v.add(0, 0.85, 0.14, [1.8, 1.1, 0.6], 0.04);
  r.parts.body = part(v, m);
  v = new Vox(s, false);
  v.box(-0.14, 0, -0.13, 0.14, 0.27, 0.13, (x, y, z) => z > 0.11 && y < 0.22 && Math.abs(x) < 0.11 ? jit(hex('#f4c7a1'), 0.04) : jit(hex('#c4562f'), 0.06));
  v.add(-0.055, 0.13, 0.135, [1.9, 1.4, 0.55], 0.04); v.add(0.055, 0.13, 0.135, [1.9, 1.4, 0.55], 0.04);
  v.box(-0.04, 0.05, 0.13, 0.04, 0.07, 0.14, hex('#b2443a'), { j: 0 });
  r.parts.head = part(v, m, 0, 1.1, 0);
  for (const sd of [-1, 1]) { v = new Vox(s, false); v.box(-0.035, -0.38, -0.035, 0.035, 0, 0.035, warm); v.box(-0.045, -0.44, -0.045, 0.045, -0.37, 0.05, hex('#f4c7a1')); r.parts[sd < 0 ? 'armL' : 'armR'] = part(v, m, sd * 0.24, 1.0, 0); }
  for (const k in r.parts) r.g.add(r.parts[k]);
  r.headY = 1.24; r.speed = 0.6; r.height = 1.38;
  proxy('maya', -0.24, 0, -0.16, 0.24, 1.4, 0.16, r.g);
  return r;
}
function buildSimone() {
  const m = mat({ fly: 1 }), r = robotBase('simone', m), s = 0.028;
  const plum = () => jit(hex('#4a3a58'), 0.08);
  for (const sd of [-1, 1]) { const v = new Vox(s, false); v.box(-0.03, -0.72, -0.035, 0.03, 0, 0.035, plum); r.parts[sd < 0 ? 'legL' : 'legR'] = part(v, m, sd * 0.06, 0.74, 0); }
  let v = new Vox(s, false);
  v.box(-0.11, 0.72, -0.07, 0.11, 1.18, 0.07, plum);
  v.box(-0.025, 1.18, -0.025, 0.025, 1.3, 0.025, hex('#2a2a2e'));
  r.parts.body = part(v, m);
  v = new Vox(0.03, false);
  v.sphere(0, 0.2, 0, 0.2, (x, y, z) => { if (Math.abs(y) < 0.03) return hex('#3fbf6a'); return ((Math.round((x + 1) / 0.03) + Math.round((y + 1) / 0.03) + Math.round((z + 1) / 0.03)) % 2) ? hex('#c8ccd2') : hex('#5d636b'); }, { s: 0.03 });
  v.add(0.0, 0.32, 0.17, [1.9, 0.15, 0.1], 0.035);
  r.parts.head = part(v, m, 0, 1.3, 0);
  for (const sd of [-1, 1]) { v = new Vox(s, false); v.box(-0.025, -0.5, -0.025, 0.025, 0, 0.025, plum); r.parts[sd < 0 ? 'armL' : 'armR'] = part(v, m, sd * 0.14, 1.15, 0); }
  for (const k in r.parts) r.g.add(r.parts[k]);
  // books orbiting her
  r.books = [];
  const cols = ['#c0392b', '#2e86de', '#f6b93b', '#38ada9', '#8e44ad', '#e58e26'];
  for (let q = 0; q < 6; q++) {
    const bv = new Vox(0.02, false); bv.box(-0.06, -0.08, -0.02, 0.06, 0.08, 0.02, (x, y, z) => Math.abs(x) > 0.05 ? hex('#efe6cf') : jit(hex(cols[q]), 0.05));
    const b = new T.Group(); b.add(mesh(bv, m)); r.g.add(b);
    const px = proxy('book', -0.09, -0.11, -0.05, 0.09, 0.11, 0.05, b, { book: q });
    r.books.push({ g: b, a: q / 6 * Math.PI * 2, held: false, back: 0 });
  }
  r.headY = 1.5; r.speed = 0.45; r.height = 1.7;
  proxy('simone', -0.2, 0, -0.2, 0.2, 1.7, 0.2, r.g);
  return r;
}
function buildRoomba(small) {
  const m = mat({ fly: 1 }), r = robotBase(small ? 'lawyer' : 'roomba', m), s = small ? 0.016 : 0.02;
  const rad = small ? 0.12 : 0.17, h = small ? 0.065 : 0.085;
  const v = new Vox(s, false);
  v.cyl(0, 0.01, 0, rad, rad, h, (x, y, z, rim, cap, e) => rim ? (z > 0 && y < h * 0.6 ? hex('#1a1a1a') : hex('#8b8f96')) : (e < 0.15 ? hex('#3a3d42') : jit(hex('#2b2d31'), 0.06)), { s });
  v.add(0, h * 0.6, rad - s * 0.6, [0.3, 1.8, 0.6], s * 1.1);
  if (!small) { // the crown: ROOMBA KING
    for (let q = 0; q < 10; q++) { const a = q / 10 * Math.PI * 2; v.add(Math.cos(a) * 0.05, h + 0.01, Math.sin(a) * 0.05, [1.7, 1.25, 0.3], s); if (q % 2 === 0) v.add(Math.cos(a) * 0.05, h + 0.03, Math.sin(a) * 0.05, [1.8, 1.35, 0.35], s); }
    v.add(0, h + 0.012, 0, [1.4, 0.2, 0.3], s);
  } else { // tie + briefcase
    v.box(-0.012, h, 0.03, 0.012, h + 0.012, 0.09, [1.3, 0.12, 0.12], { s: 0.012, j: 0 });
    v.box(-0.05, h, -0.08, 0.05, h + 0.07, -0.04, hex('#5a3a1e'), { s: 0.014 });
    v.box(-0.015, h + 0.07, -0.065, 0.015, h + 0.085, -0.055, hex('#c9a227'), { s: 0.01, j: 0 });
  }
  const body = part(v, m); r.g.add(body); r.parts.body = body;
  r.headY = 0.1; r.speed = small ? 0.5 : 0.55; r.height = h;
  if (small) proxy('lawyer', -0.13, 0, -0.13, 0.13, 0.18, 0.13, r.g); else proxy('roomba', -0.18, 0, -0.18, 0.18, 0.15, 0.18, r.g);
  return r;
}
function buildGhost() {
  const m = mat({ alpha: 0, fly: 0, glow: 0.3 }), v = new Vox(0.025, false);
  v.sphere(0, 0.12, 0, 0.09, [1.6, 1.6, 1.75]);
  v.box(-0.09, -0.02, -0.09, 0.09, 0.12, 0.09, (x, y, z, i, j, k, nx, ny, nz) => (j === 0 && (i + k) % 2) ? null : [1.5, 1.5, 1.7], { s: 0.025 });
  v.add(-0.035, 0.14, 0.09, [0.05, 0.05, 0.1], 0.03); v.add(0.035, 0.14, 0.09, [0.05, 0.05, 0.1], 0.03);
  const g = new T.Group(); g.add(mesh(v, m)); return { g, m };
}
function cartMesh(colHex, label) {
  const v = new Vox(0.012, false);
  v.box(-0.05, 0, -0.012, 0.05, 0.12, 0.012, (x, y, z) => (y > 0.03 && y < 0.1 && Math.abs(x) < 0.038 && Math.abs(z) > 0.006) ? jit(hex(colHex), 0.04) : jit(hex('#2b2b30'), 0.05), { s: 0.012 });
  const g = new T.Group(); g.add(mesh(v, mat({ fly: 0 })));
  if (label) {
    const t = canvasTex(128, 64, (c, w, h) => { c.fillStyle = '#e8c45a'; c.fillRect(0, 0, w, h); c.fillStyle = '#2a1a05'; c.font = 'bold 40px monospace'; c.textAlign = 'center'; c.fillText(label, w / 2, 46); });
    const p = plane(0.075, 0.04, t, { double: true }); p.position.set(0, 0.065, 0.0135); g.add(p);
  }
  return g;
}
W.cartMesh = cartMesh;
function buildCrate(scene, x, z) {
  const v = new Vox(0.03);
  v.base = [x, 0, z];
  v.box(-0.26, 0, -0.18, 0.26, 0.28, 0.18, (px, py, pz, i, j, k, nx, ny, nz) => (j === 0 || i === 0 || i === nx - 1 || k === 0 || k === nz - 1) ? jit(mix(hex('#9a7246'), hex('#7d5a35'), (j % 3) / 3), 0.06) : null);
  const me = mesh(v, mat({ local: true })); me.position.set(x, 0, z); scene.add(me);
  W.crate = { x, z, carts: [] };
  const eps = window.GTB_EPISODES || [];
  for (let q = 0; q < 7; q++) {
    const gold = q === 6, col = gold ? '#e8c45a' : (eps[q] ? eps[q].color : '#888');
    const g = cartMesh(col, gold ? 'MILES' : null);
    g.position.set(x - 0.2 + q * 0.065, 0.2, z + (q % 2 ? 0.05 : -0.05)); g.rotation.y = Math.PI / 2 + (R() - 0.5) * 0.2; g.rotation.z = (R() - 0.5) * 0.15;
    scene.add(g);
    const p = proxy(gold ? 'cart_s2' : 'crate', -0.03, 0, -0.06, 0.03, 0.13, 0.06, g, { cart: q });
    W.crate.carts.push(g);
  }
  proxy('crate', x - 0.27, 0, z - 0.19, x + 0.27, 0.3, z + 0.19, scene);
  solid(x - 0.3, z - 0.22, x + 0.3, z + 0.22);
}

W.build = function (scene) {
  W.scene = scene;
  buildRoom(scene);
  buildCrate(scene, -3.1, 1.25);
  const rb = W.robots;
  rb.charlie = buildCharlie(); rb.miles = buildMiles(); rb.maya = buildMaya(); rb.simone = buildSimone();
  rb.roomba = buildRoomba(false); rb.lawyer = buildRoomba(true);
  for (const k in rb) scene.add(rb[k].g);
  W.ghost = buildGhost(); scene.add(W.ghost.g); W.ghost.g.visible = false;
  // record on the platter, stroopwafel stack, briefcase scorecard
  const rv = new Vox(0.015, false); rv.cyl(0, 0, 0, 0.15, 0.15, 0.015, (x, y, z, rim, cap, e) => e < 0.08 ? hex('#e8d24a') : jit(hex('#151515'), 0.2), { s: 0.015 });
  W.record = new T.Group(); W.record.add(mesh(rv, mat({ fly: 0 }))); W.record.position.set(...W.turntable.c); W.record.visible = false; scene.add(W.record);
  const sv = new Vox(0.012, false); sv.cyl(0, 0, 0, 0.06, 0.06, 0.018, (x, y, z, rim) => rim ? hex('#a8692c') : ((Math.round(x / 0.012) + Math.round(z / 0.012)) % 3 ? hex('#c98a3e') : hex('#8a5522')), { s: 0.012 });
  W.stroop = []; for (let q = 0; q < 5; q++) { const g = new T.Group(); g.add(mesh(sv, mat({ fly: 0 }))); g.visible = false; g.position.set(W.vending.tray[0], W.vending.tray[1] - 0.06 + q * 0.02, W.vending.tray[2] + (q % 2) * 0.01); scene.add(g); W.stroop.push(g); }
  const sc = canvasTex(256, 160, (g, w, h) => {
    g.fillStyle = '#f3ecd6'; g.fillRect(0, 0, w, h); g.fillStyle = '#222'; g.font = 'bold 22px monospace'; g.fillText('SCORECARD', 60, 30);
    g.font = '17px monospace'; g.fillText('CHARLIE vs MILES', 46, 62); g.fillText('Rd 1  ??   Rd 2  ??', 30, 92);
    g.fillStyle = '#b3261e'; g.font = 'bold 30px monospace'; g.fillText('DRAW', 92, 138);
    g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(w, 0, 46, 0, 7); g.fill(); g.beginPath(); g.arc(w - 50, 10, 22, 0, 7); g.fill();
  });
  W.scorecard = plane(0.3, 0.19, sc, { transparent: true, double: true }); W.scorecard.visible = false; scene.add(W.scorecard);
  let n = 0; for (const me of W.meshes) n += me.userData.count; W.voxels = n;
  return W;
};
})();
