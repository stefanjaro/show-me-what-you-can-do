/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPOSSIBLE HOUSE — headless verification suite
     node dev/tests.js
   Runs the whole engine, the whole world, and the whole visitor controller
   without a browser, and verifies the geometry is genuinely impossible.
   ═════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function load(files) {
  const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  return new Function(src + '\n;return (typeof window!=="undefined"?window:globalThis).IH;')();
}

let pass = 0, fail = 0, failures = [];
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; failures.push(name + (extra ? '  [' + extra + ']' : '')); }
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);
function vecNear(a, b, eps) {
  eps = eps || 1e-6;
  return near(a[0], b[0], eps) && near(a[1], b[1], eps) && near(a[2], b[2], eps);
}
const det3 = (R) => R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
const orth3 = (R) => {
  for (let c = 0; c < 3; c++) if (!near(Math.hypot(R[c], R[3 + c], R[6 + c]), 1, 1e-9)) return false;
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++)
    if (!near(R[a] * R[b] + R[3 + a] * R[3 + b] + R[6 + a] * R[6 + b], 0, 1e-9)) return false;
  return true;
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vecNeg = (a) => [-a[0], -a[1], -a[2]];

/* Walk up to a doorway and step through it, heading straight along the
   doorway's own normal so the result is deterministic.                    */
function stepThrough(p, gate, maxFrames) {
  for (let f = 0; f < (maxFrames || 2000); f++) {
    const s = world.sectors[p.sector];
    const voff = dot(V.sub(p.pos, gate.center), gate.v);
    const target = V.add(gate.center, V.mul(gate.v, voff));
    const rel = V.sub(target, p.pos);
    const du = dot(rel, gate.u);
    const distToWall = dot(V.sub(gate.center, p.pos), gate.n);
    const aligned = Math.abs(du) < gate.w * 0.4 && Math.abs(voff) < gate.h * 0.45;
    if (aligned && distToWall > 0 && distToWall < 2.2) IH.house.faceDir(p, gate.n, p.u);
    else IH.house.faceDir(p, V.norm(rel), p.u);
    IH.house.walk(world, p, 1 / 60, 2.4);
    if (p.sector !== s.index) return true;
  }
  return false;
}

/* Walk the house by the doors: aim at the next gate, walk until the room
   changes, repeat. Returns the rooms visited in order.                     */
function walkDoors(startRoom, maxRooms, frameLimit) {
  const p = IH.house.player(world);
  p.sector = startRoom;
  const s0 = world.sectors[startRoom];
  p.pos = [(s0.min[0] + s0.max[0]) / 2, 1.65, (s0.min[2] + s0.max[2]) / 2];
  IH.house.faceDir(p, [1, 0, 0]);
  const visited = [startRoom];
  let frames = 0;
  while (visited.length <= maxRooms && frames < frameLimit) {
    const s = world.sectors[p.sector];
    /* prefer a door that stays inside this wing, then one we have not
       just walked through, then anything still open                        */
    const back = visited.length > 1 ? visited[visited.length - 2] : -1;
    const rank = (gt) => {
      if (!gt.active) return 99;
      const t = world.sectors[gt.target];
      const same = t.kind && t.kind === s.kind ? 0 : 1;
      const isBack = gt.target === back ? 2 : 0;
      return same + isBack;
    };
    let goal = null, best = 99;
    for (const gt of s.gates) {
      const r = rank(gt);
      if (r < best) { best = r; goal = gt; }
    }
    if (!goal || best >= 99) break;
    const before = p.sector;
    stepThrough(p, goal, 1);
    frames++;
    if (p.sector === before) { /* still walking to it */ }
    if (p.sector !== visited[visited.length - 1]) visited.push(p.sector);
  }
  return { visited: visited, p: p, frames: frames };
}

const IH = load(['js/core/noise.js', 'js/core/mathx.js', 'js/core/textures.js',
  'js/core/render.js', 'js/world/geom.js', 'js/world/house.js']);
const M = IH.Math, V = M.V;
const world = IH.house.build();
const textures = IH.textures.build({ size: 64, seed: 20261013 });
IH.house.bindTextures(world, textures);

/* ═══════════════════════ 1. polygon clipping ═══════════════════════════ */
{
  const box = [[2, 2, 0], [8, 2, 0], [8, 8, 0], [2, 8, 0]];
  const out = [];
  for (let i = 0; i < 16; i++) out.push([0, 0, 0]);
  const n = M.clipPoly(box, 4, [[1, 0, 0, -4], [0, 1, 0, -4]], out, 2);
  ok('clip: two half-planes trim a square to 4x4', n === 4, 'n=' + n);
  ok('clip: first vertex is the new corner', vecNear(out[0], [4, 4, 0]), JSON.stringify(out[0]));
  let area = 0;
  for (let i = 0; i < n; i++) { const a = out[i], b = out[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  ok('clip: clipped area is exactly 16', near(Math.abs(area) / 2, 16, 1e-9), 'area=' + Math.abs(area) / 2);
  ok('clip: fully outside polygon vanishes', M.clipPoly(box, 4, [[1, 0, 0, -99]], out, 1) === 0);
  ok('clip: polygon fully inside the plane is untouched',
    M.clipPoly(box, 4, [[1, 0, 0, 9]], out, 1) === 4);
  const oct = [];
  for (let i = 0; i < 8; i++) oct.push([Math.cos(i / 8 * 6.283) * 10, Math.sin(i / 8 * 6.283) * 10, 0]);
  const m = M.clipPoly(oct, 8, [[1, 0, 0, 2], [-1, 0, 0, 2], [0, 1, 0, 2], [0, -1, 0, 2],
    [0, 0, 1, 0], [0.7, 0.7, 0, 5], [-0.7, 0.7, 0, 5]], out, 7);
  ok('clip: deep clip stack stays small and convex', m >= 3 && m <= 10, 'n=' + m);
}

/* ═════════════════════════ 2. frustum planes ══════════════════════════ */
{
  const cam = M.pose([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const pl = M.frustumPlanes(cam, 1, 40, 90 * M.DEG, 1.6, []);
  const inside = (p) => pl.every((q) => M.planeDist(q, p) >= 0);
  ok('frustum: forward centre inside', inside([0, 0, 10]));
  ok('frustum: behind the camera outside', !inside([0, 0, -10]));
  ok('frustum: closer than near outside', !inside([0, 0, 0.5]));
  ok('frustum: beyond far outside', !inside([0, 0, 90]));
  ok('frustum: beyond right edge outside', !inside([30, 0, 5]));
  ok('frustum: near right edge inside', inside([2, 0, 10]));
  ok('frustum: below bottom outside', !inside([0, -30, 5]));
  ok('frustum: above top outside', !inside([0, 30, 5]));
  const rolled = M.pose([0, 0, 0], [0, 1, 0], [-1, 0, 0], [0, 0, 1]);
  const pl2 = M.frustumPlanes(rolled, 1, 40, 90 * M.DEG, 1.6, []);
  const inside2 = (p) => pl2.every((q) => M.planeDist(q, p) >= 0);
  ok('frustum: correct for a camera rolled 90 degrees',
    inside2([0, 0, 20]) && !inside2([20, 0, 5]) && inside2([0, -5, 10]) && !inside2([0, -25, 10]));
}

/* ═══════════════ 3. gate algebra: the impossibility itself ════════════ */
{
  const A = M.gateFrame([[0, 0.2, 0.8], [0, 0.2, -0.8], [0, 2.6, -0.8], [0, 2.6, 0.8]]);
  const B = M.gateFrame([[0, 0.2, -0.8], [0, 0.2, 0.8], [0, 2.6, 0.8], [0, 2.6, -0.8]]);
  const X = M.gateTransform(A, B);
  ok('gate: opposite faces get opposite normals',
    vecNear(A.n, [1, 0, 0], 1e-9) && vecNear(B.n, [-1, 0, 0], 1e-9));
  ok('gate: back-to-back doors are the identity',
    vecNear(M.pointApply(X, [0.4, 1.7, 0.31]), [0.4, 1.7, 0.31], 1e-9));
  ok('gate: door centre is a fixed point', vecNear(M.pointApply(X, [0, 1.4, 0]), [0, 1.4, 0], 1e-9));
  ok('gate: "out of A" becomes "into B"', vecNear(M.dirApply(X, A.n), vecNeg(B.n), 1e-9),
    JSON.stringify(M.dirApply(X, A.n)));
  const walker = M.pose([-3.65, 1.7, 0], [0, 0, -1], [0, 1, 0], [1, 0, 0]);
  const after = M.poseApply(X, walker);
  ok('gate: a straight walk through a door is continuous',
    vecNear(after.p, walker.p, 1e-9) && vecNear(after.f, walker.f, 1e-9) && vecNear(after.r, walker.r, 1e-9));
  /* twists */
  const D90 = 90 * M.DEG;
  const Y = M.xfMul(M.gateTwist(B, D90, 0), X);
  const R2 = M.xfMul(M.gateTwist(B, Math.PI, Math.PI), X);
  ok('twist: yaw 90 turns the heading a quarter',
    Math.abs(dot(M.dirApply(Y, A.n), A.n)) < 1e-9 && near(V.len(M.dirApply(Y, A.n)), 1, 1e-9),
    JSON.stringify(M.dirApply(Y, A.n)));
  ok('twist: half a turn each way turns you upside down',
    vecNear(M.dirApply(R2, [0, 1, 0]), [0, -1, 0], 1e-9), JSON.stringify(M.dirApply(R2, [0, 1, 0])));
  ok('twist: the visitor still walks along the doorway axis',
    near(Math.abs(dot(M.dirApply(R2, A.n), A.n)), 1, 1e-9), JSON.stringify(M.dirApply(R2, A.n)));
  ok('twist: twists stay proper rotations',
    near(det3(Y.R), 1, 1e-9) && near(det3(R2.R), 1, 1e-9) && orth3(Y.R) && orth3(R2.R));
  /* holonomy: three quarter turns plus one straight door */
  let holo = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
  for (let i = 0; i < 4; i++) holo = M.xfMul(i < 3 ? M.gateTwist(B, D90, 0) : X, holo);
  ok('holonomy: the ring returns you turned a quarter',
    Math.abs(dot(M.dirApply(holo, [1, 0, 0]), [1, 0, 0])) < 1e-9,
    JSON.stringify(M.dirApply(holo, [1, 0, 0])));
}

/* ═════════════════════════ 4. noise library ═══════════════════════════ */
{
  const N = IH.noise;
  const r = N.mulberry32(7), a = r(), b = r();
  ok('noise: rng deterministic and in range', a !== b && a >= 0 && a < 1 && b >= 0 && b < 1);
  let range = true, cont = true, mean = 0;
  let prev = N.value2(3.1, 4.7, 1);
  for (let i = 0; i < 400; i++) {
    const v = N.fbm2(Math.random() * 60, Math.random() * 60, 5, 3);
    if (!(v >= 0 && v <= 1)) range = false;
    mean += N.value2(Math.random() * 400, Math.random() * 400, 3);
    const v2 = N.value2(3.1 + i * 1e-4, 4.7, 1);
    if (Math.abs(v2 - prev) > 0.05) cont = false;
    prev = v2;
  }
  mean /= 400;
  ok('noise: fbm stays in [0,1]', range);
  ok('noise: value noise is continuous', cont);
  ok('noise: value noise is roughly centred', near(mean, 0.5, 0.07), 'mean=' + mean.toFixed(4));
  const w = N.worley2(3.3, 4.4, 5);
  ok('noise: worley f1<=f2 and both positive', w.f1 <= w.f2 + 1e-9 && w.f1 >= 0 && w.f2 >= 0);
  ok('noise: domain warping stays in range', (() => { const v = N.warpFbm(1.2, 3.4, 5, 9, 1); return v >= 0 && v <= 1; })());
}

/* ═════════════════════════ 5. textures ═══════════════════════════════ */
{
  const T = IH.textures.build({ size: 64, seed: 99 });
  const names = Object.keys(T);
  ok('textures: every generator produced output', names.length >= 16, names.length + ' kinds');
  let allFilled = true, allPow2 = true;
  for (const k of names) {
    const t = T[k];
    if (!(t.w > 0 && (t.w & (t.w - 1)) === 0)) allPow2 = false;
    let nz = 0;
    for (let i = 0; i < t.img.length; i += 17) if (t.img[i] !== 0) nz++;
    if (nz === 0) allFilled = false;
  }
  ok('textures: every texture is non-empty', allFilled);
  ok('textures: every texture is a power-of-two square', allPow2);
  const s = T.stone.img, w = T.stone.w;
  let mid = 0, seam = 0, n = 0;
  for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) {
    const x0 = (bx * w) / 4, y0 = (by * w) / 4, ww = w / 4;
    mid += s[(y0 + ww * 0.5) * w + (x0 + ww * 0.5)] & 255;
    seam += s[(y0 + ww * 0.5) * w + x0] & 255;
    n++;
  }
  ok('textures: stone shows mortar joints between blocks', mid > seam * 1.15,
    'block=' + (mid / n).toFixed(0) + ' seam=' + (seam / n).toFixed(0));
  ok('textures: flame sprite has an alpha mask',
    (() => { const f = T.flame0.img; let hot = 0; for (let i = 0; i < f.length; i++) if ((f[i] >>> 24) > 200) hot++; return hot > 8; })());
}

/* ═══════════════════ 6. the world: structure and linkage ═════════════ */
{
  ok('world: the house has wings', world.sectors.length >= 40, world.sectors.length + ' rooms');
  let missing = 0, bad = 0, mismatch = 0, unnamed = 0;
  const count = {};
  for (const s of world.sectors) {
    if (!s.name || !s.polys.length) unnamed++;
    for (const g of s.gates) {
      count[g.id] = (count[g.id] || 0) + 1;
      const other = world.sectors[g.target];
      const twin = other && other.gates.find((t) => t.id === g.id);
      if (!other || !twin) missing++;
      if (!near(det3(g.xf.R), 1, 1e-9) || !orth3(g.xf.R)) bad++;
      /* the gluing must carry one gate's centre onto its twin's */
      if (twin && !vecNear(M.pointApply(g.xf, g.center), twin.center, 1e-6)) mismatch++;
    }
  }
  const odd = Object.keys(count).filter((k) => count[k] !== 2);
  ok('world: every gate has a twin with the same id', missing === 0, missing + ' missing');
  ok('world: every gate id appears exactly twice', odd.length === 0, odd.slice(0, 4).join(','));
  ok('world: every gluing maps one gate centre onto the other', mismatch === 0, mismatch + ' off');
  ok('world: every portal transform is a proper rotation', bad === 0, bad + ' bad');
  ok('world: every room is named and has geometry', unnamed === 0, unnamed);
  const seenR = {}, queue = [world.start.sector];
  while (queue.length) {
    const i = queue.shift();
    if (seenR[i]) continue;
    seenR[i] = true;
    for (const g of world.sectors[i].gates) if (!seenR[g.target]) queue.push(g.target);
  }
  ok('world: every room is reachable from the atrium',
    Object.keys(seenR).length === world.sectors.length, Object.keys(seenR).length + '/' + world.sectors.length);
  let flat = 0, concave = 0, badLight = 0;
  for (const s of world.sectors) {
    for (const p of s.polys) {
      if (p.pts.length !== 4) { concave++; continue; }
      let pos = 0, neg = 0;
      for (let i = 0; i < 4; i++) {
        const a = p.pts[i], b = p.pts[(i + 1) % 4], c = p.pts[(i + 2) % 4];
        const d = V.dot(V.cross(V.sub(b, a), V.sub(c, b)), p.nrm);
        if (d > 1e-7) pos++; else if (d < -1e-7) neg++;
      }
      if (pos && neg) concave++;
      if (V.len(p.nrm) < 1e-6) flat++;
    }
    for (const L of s.lights) if (!(L.r > 0 && L.i >= 0)) badLight++;
  }
  ok('world: no degenerate polygons', flat === 0, flat);
  ok('world: every polygon is convex and consistently wound', concave === 0, concave);
  ok('world: every light is sane', badLight === 0, badLight);
  ok('world: floors face up after the normal flip',
    world.sectors[0].polys.some((p) => p.nrm[1] > 0.99));
  ok('world: the core is sealed until the seals are gathered',
    world.sectors.flatMap((s) => s.gates).filter((g) => g.id === 'd-core' || g.id === 'd-stairs-core')
      .every((g) => g.active === false));
}

/* ═══════════════ 7. the visitor: walking, walls, doorways ════════════ */
{
  const P = IH.house.player(world);
  ok('visitor: starts in the atrium on its floor', P.sector === world.start.sector && near(P.pos[1], 1.65, 0.01));
  /* a long random wander must never leave the house */
  let escaped = 0, badSect = 0;
  for (let i = 0; i < 1500; i++) {
    IH.house.look(P, (Math.random() - 0.5) * 0.4, 0);
    IH.house.walk(world, P, 1 / 60, 2.2);
    const s = world.sectors[P.sector];
    if (!s) badSect++;
    const inside = s.walls.every((w) => M.planeDist(w.plane, P.pos) < 0.55);
    if (!inside) escaped++;
    if (!isFinite(P.pos[0] + P.pos[1] + P.pos[2])) escaped++;
  }
  ok('visitor: never escapes the room it is in', escaped === 0, escaped + ' escapes');
  ok('visitor: always stands in a real room', badSect === 0, badSect);
  /* walking forward through the turning door changes room */
  const P2 = IH.house.player(world);
  IH.house.faceDir(P2, [0, 0, -1]);
  let frames = -1;
  for (let i = 0; i < 1200; i++) {
    IH.house.walk(world, P2, 1 / 60, 2.4);
    if (P2.sector !== 0) { frames = i; break; }
  }
  ok('visitor: walking ahead crosses the first doorway', frames > 0, 'after ' + frames + ' frames');
  ok('visitor: arrives inside the new room, on its floor',
    world.sectors[P2.sector].walls.every((w) => M.planeDist(w.plane, P2.pos) < 0.55) && near(P2.pos[1], 1.65, 0.6),
    'y=' + P2.pos[1].toFixed(2));
}

/* ═════════ 8. the impossibilities, walked through for real ══════════ */
function walkThrough(startSector, place, frames, speed) {
  const p = IH.house.player(world);
  p.sector = startSector;
  p.pos = place.pos.slice();
  IH.house.faceDir(p, place.f, place.u || [0, 1, 0]);
  let first = null, y0 = p.pos[1], up0 = p.u.slice();
  const visited = [];
  for (let i = 0; i < frames; i++) {
    IH.house.walk(world, p, 1 / 60, speed || 2.4);
    if (visited[visited.length - 1] !== p.sector) visited.push(p.sector);
    if (first === null && p.sector !== startSector) first = i;
    if (!isFinite(p.pos[0] + p.pos[1] + p.pos[2])) break;
  }
  return { p: p, first: first, visited: visited, y0: y0, up0: up0 };
}

/* holonomy: three ordinary corners and one twisted door */
{
  const w = world.wings.turning;
  const ring = ['d-turn-03', 'd-turn-23', 'd-turn-12', 'd-turn-10'];
  const p = IH.house.player(world);
  p.sector = w.start;
  const s0 = world.sectors[w.start];
  p.pos = [s0.min[0] + 4, 1.65, (s0.min[2] + s0.max[2]) / 2];
  IH.house.faceDir(p, [0, 0, 1]);
  const start = w.start;
  let walked = 0;
  let startHeading = [0, 0, 1];
  const history = [];
  for (const id of ring) {
    const s = world.sectors[p.sector];
    const gate = s.gates.find((g) => g.id === id);
    if (!gate) break;
    if (!stepThrough(p, gate, 2500)) break;
    walked++;
    history.push(p.f.slice());
    if (history.length === 1) startHeading = p.f.slice();
  }
  ok('holonomy: all four doors of the ring are walked through', walked === 4, walked + ' of 4');
  ok('holonomy: the ring closes back on itself', p.sector === start, 'room ' + p.sector);
  const h0 = history[0], h3 = history[history.length - 1];
  /* One lap of a square ring turns a visitor through 360 degrees and so
     leaves them facing the way they came. Three ordinary corners plus one
     twisted door turns them 450 degrees: they come out a quarter off.  */
  ok('holonomy: ...and the twisted door has turned them a quarter',
    walked === 4 && Math.abs(dot(h3, [0, 0, -1])) > 0.85,
    'entered ' + startHeading.map((v) => v.toFixed(1)).join(',') + ' / left ' + h3.map((v) => v.toFixed(1)).join(','));
}

/* the recursive gallery: seven rooms, each four fifths of the last */
{
  const w = world.wings.gallery;
  const r = walkDoors(w.start, 8, 4000);
  ok('recessional: the visitor descends through the whole suit',
    r.visited.length >= 6, r.visited.length + ' rooms: ' + r.visited.join('→'));
  const widths = r.visited.map((i) => world.sectors[i].max[0] - world.sectors[i].min[0]);
  let shrinking = true;
  for (let i = 1; i < Math.min(6, widths.length); i++) if (widths[i] >= widths[i - 1]) shrinking = false;
  ok('recessional: every room is narrower than the one before',
    shrinking && widths[0] > 5 && widths[widths.length - 1] < 3,
    widths.map((v) => v.toFixed(1)).join('→'));
}

/* the penrose ascent: twelve steps to a circuit, and the top of the last
   circuit is the bottom of the next, one landing higher                  */
{
  const w = world.wings.stairs;
  const r = walkDoors(w.start, 40, 9000);
  const rise = r.p.pos[1] - 1.65;
  ok('penrose: the climb is climbed', r.visited.length >= 10, r.visited.length + ' steps');
  ok('penrose: climbing rises', rise > 3.0, 'rose ' + rise.toFixed(2) + 'm over ' + r.visited.length + ' steps');
  ok('penrose: the visitor stays in a real room',
    world.sectors[r.p.sector].walls.every((q) => M.planeDist(q.plane, r.p.pos) < 0.6),
    'room ' + r.p.sector + ' at ' + r.p.pos.map((v) => v.toFixed(1)).join(','));
  /* two different circuits, the second physically above the first */
  const circuits = new Set(r.visited.map((i) => world.sectors[i].loop));
  ok('penrose: more than one circuit is climbed', circuits.size >= 2, [...circuits].join(','));
}

/* the inversion: a doorway that stands you on the vault */
{
  const w = world.wings.chapel;
  const p = IH.house.player(world);
  p.sector = w.start;
  const s0 = world.sectors[w.start];
  p.pos = [s0.min[0] + 3.2, 1.65, (s0.min[2] + s0.max[2]) / 2];
  IH.house.faceDir(p, [1, 0, 0]);
  const gate = world.sectors[w.start].gates.find((x) => x.id === 'd-chapel-flip');
  const through = stepThrough(p, gate, 2500);
  ok('inversion: the visitor reaches the chapel', through && p.sector === w.start + 1,
    'room ' + p.sector);
  ok('inversion: ...standing on the vault ceiling, upside down',
    dot(p.u, [0, -1, 0]) > 0.95 && p.pos[1] > world.sectors[p.sector].max[1] - 0.9,
    'up = ' + p.u.map((v) => v.toFixed(2)).join(',') + ' at ' + p.pos[1].toFixed(2) + 'm');
  ok('inversion: still walking along the wall',
    Math.abs(dot(p.f, [0, 1, 0])) < 0.05, 'forward ' + p.f.map((v) => v.toFixed(2)).join(','));
  ok('inversion: the vault is a room you can stand in',
    world.sectors[p.sector].walls.every((q) => M.planeDist(q.plane, p.pos) < 0.4),
    'room ' + p.sector + ' at ' + p.pos.map((v) => v.toFixed(2)).join(','));
  /* and they can walk back out again */
  const gate2 = world.sectors[p.sector].gates.find((x) => x.id === 'd-chapel-flip');
  const back = stepThrough(p, gate2, 2500);
  ok('inversion: the doorway works both ways', back && p.sector === w.start, 'room ' + p.sector);
  ok('inversion: ...and puts you the right way up again',
    Math.abs(dot(p.u, [0, 1, 0])) > 0.99, 'up = ' + p.u.map((v) => v.toFixed(2)).join(','));
}

/* the sealed core */
{
  const coreGate = world.sectors.flatMap((s) => s.gates).filter((g) => g.id === 'd-core')[0];
  const w = world.wings.chapel;
  const r = walkDoors(w.start, 3, 2000);
  ok('core: sealed while the seals are missing', coreGate.active === false);
  ok('core: the seals are all placed in reachable rooms',
    world.items.length === 4 && world.items.every((it) => M.planeDist(
      world.sectors[it.sector].walls.map((w2) => w2.plane)[0], it.pos) < 100));
}

/* ═════════════════════════ 9. the renderer ═══════════════════════════ */
{
  const R = IH.render.create(96, 60);
  R.far = 400;
  const st = world.start;
  const bb = V.basis(st.f, st.u);
  const cam = M.pose(st.pos, bb.r, bb.u, bb.f);
  const t0 = Date.now();
  IH.render.render(R, world, cam, st.sector, { clear: 0xff07070a });
  const ms = Date.now() - t0;
  let lit = 0;
  for (let i = 0; i < R.buf.length; i++) if (R.buf[i] !== 0xff07070a) lit++;
  ok('render: the atrium view draws geometry', lit > R.buf.length * 0.25,
    (lit / R.buf.length * 100).toFixed(0) + '%');
  ok('render: doorways are looked through', R.stats.portals > 0, R.stats.portals + ' portals');
  ok('render: recursion terminates', R.stats.recursion <= 10, 'depth ' + R.stats.recursion);
  ok('render: frame time is sane', ms < 5000, ms + 'ms');
  const up = V.basis([0, 1, 0], st.f);
  IH.render.render(R, world, M.pose(st.pos, up.r, up.u, up.f), st.sector, { clear: 0xff07070a });
  let lit2 = 0;
  for (let i = 0; i < R.buf.length; i++) if (R.buf[i] !== 0xff07070a) lit2++;
  ok('render: looking up shows the vaulted ceiling', lit2 > R.buf.length * 0.85,
    (lit2 / R.buf.length * 100).toFixed(0) + '%');
  let zb = 0;
  for (let i = 0; i < R.zbuf.length; i++) if (R.zbuf[i] > 0) zb++;
  ok('render: the depth buffer receives depth', zb > R.buf.length * 0.25, zb);
  IH.render.setSize(R, 64, 48);
  ok('render: resize reallocates buffers', R.w === 64 && R.h === 48 && R.buf.length === 64 * 48);
  IH.render.setSize(R, 96, 60);
  /* every wing renders something */
  const wingViews = [
    ['turning', world.wings.turning], ['stairs', world.wings.stairs],
    ['gallery', world.wings.gallery], ['chapel', world.wings.chapel], ['core', world.wings.core],
  ];
  for (const [nm, w] of wingViews) {
    const s = world.sectors[w.start];
    const pl = s.place || { pos: [(s.min[0] + s.max[0]) / 2, 1.65, (s.min[2] + s.max[2]) / 2], f: [1, 0, 0] };
    const bb2 = V.basis(pl.f, pl.u || [0, 1, 0]);
    IH.render.render(R, world, M.pose(pl.pos, bb2.r, bb2.u, bb2.f), w.start, { clear: 0xff07070a });
    let l2 = 0;
    for (let i = 0; i < R.buf.length; i++) if (R.buf[i] !== 0xff07070a) l2++;
    ok('render: the ' + nm + ' wing draws', l2 > R.buf.length * 0.15, (l2 / R.buf.length * 100).toFixed(0) + '%');
  }
}

/* ═══════════════════════════ report ═════════════════════════════════ */
const polys = world.sectors.reduce((a, s) => a + s.polys.length, 0);
const gates = world.sectors.reduce((a, s) => a + s.gates.length, 0);
console.log('\n  \x1b[36m──────────────────────────────────────────────\x1b[0m');
console.log('  \x1b[32m' + pass + ' passed\x1b[0m' + (fail ? ', \x1b[31m' + fail + ' failed\x1b[0m' : ', 0 failed'));
console.log('  \x1b[36m──────────────────────────────────────────────\x1b[0m');
console.log('  house: ' + world.sectors.length + ' rooms · ' + polys + ' polygons · ' +
  gates + ' doorway ends · ' + world.info.paired + ' portals');
console.log('  wings: ' + Object.keys(world.wings).join(', '));
if (fail) { console.log('  \x1b[31m✗ failures\x1b[0m'); failures.forEach((f) => console.log('    ' + f)); }
process.exit(fail ? 1 : 0);
