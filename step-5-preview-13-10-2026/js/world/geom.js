/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPOSSIBLE HOUSE — geom.js
   Authoring layer for the house. A room is an axis-aligned brush; each of
   its six faces can carry one or more openings, and an opening can be a
   doorway — a portal to an opening in another room, with an optional
   impossible twist. Everything is built from convex quads, which is all the
   renderer eats.
   ═════════════════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  const IH = (g.IH = g.IH || {});
  const M = IH.Math;
  const V = M.V;

  /* ── the six faces of a brush ─────────────────────────────────────────── */
  /* For each face: the outward normal n, the in-plane axes u (horizontal)
     and v (vertical), the origin corner (the quad's u=0,v=0 corner), and
     the extents.  The quad is [P(0,0), P(W,0), P(W,H), P(0,H)] and is wound
     counter-clockwise when seen from outside, so n = u x v points out.    */
  const FACES = {
    nx: { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], o: (b) => [b[0][0], b[0][1], b[0][2]],
          W: (b) => b[1][2] - b[0][2], H: (b) => b[1][1] - b[0][1] },
    px: { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], o: (b) => [b[1][0], b[0][1], b[1][2]],
          W: (b) => b[1][2] - b[0][2], H: (b) => b[1][1] - b[0][1] },
    ny: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], o: (b) => [b[0][0], b[0][1], b[0][2]],
          W: (b) => b[1][0] - b[0][0], H: (b) => b[1][2] - b[0][2] },
    py: { n: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, 1], o: (b) => [b[1][0], b[1][1], b[0][2]],
          W: (b) => b[1][0] - b[0][0], H: (b) => b[1][2] - b[0][2] },
    nz: { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], o: (b) => [b[1][0], b[0][1], b[0][2]],
          W: (b) => b[1][0] - b[0][0], H: (b) => b[1][1] - b[0][1] },
    pz: { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], o: (b) => [b[0][0], b[0][1], b[1][2]],
          W: (b) => b[1][0] - b[0][0], H: (b) => b[1][1] - b[0][1] },
  };

  function facePoint(f, b, u, v) {
    const o = f.o(b);
    return [o[0] + f.u[0] * u + f.v[0] * v,
            o[1] + f.u[1] * u + f.v[1] * v,
            o[2] + f.u[2] * u + f.v[2] * v];
  }

  /* a quad from four points, with explicit uv */
  function quad(p0, p1, p2, p3, tex, uv, rgb, flags) {
    let n = V.cross(V.sub(p1, p0), V.sub(p2, p0));
    const l = V.len(n);
    if (l < 1e-9) n = [0, 1, 0]; else n = [n[0] / l, n[1] / l, n[2] / l];
    if (!uv) uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    return {
      pts: [p0, p1, p2, p3],
      u: [uv[0][0], uv[1][0], uv[2][0], uv[3][0]],
      v: [uv[0][1], uv[1][1], uv[2][1], uv[3][1]],
      nrm: n, tex: tex, rgb: rgb || [1, 1, 1], flags: flags || 0,
    };
  }

  /* a quad on a brush face, given coordinates in that face's own frame */
  function faceQuad(faceKey, b, u0, v0, u1, v1, tex, tile, rgb) {
    const f = FACES[faceKey];
    const p0 = facePoint(f, b, u0, v0), p1 = facePoint(f, b, u1, v0);
    const p2 = facePoint(f, b, u1, v1), p3 = facePoint(f, b, u0, v1);
    let uv;
    if (tile) uv = [[u0 / tile, v0 / tile], [u1 / tile, v0 / tile], [u1 / tile, v1 / tile], [u0 / tile, v1 / tile]];
    return quad(p0, p1, p2, p3, tex, uv, rgb);
  }

  const E = 1e-4;

  /* The six faces of a brush bound the room, so the surface the visitor
     sees is the inside one: the face normals are reversed after the quad is
     built.  Props (columns, blocks) keep their outward normals.           */
  function flip(p) { p.nrm = [-p.nrm[0], -p.nrm[1], -p.nrm[2]]; return p; }

  /* ── build one room ──────────────────────────────────────────────────── */
  /* spec = { name, min, max, faces: { nx: {tex, openings:[...], skip} },
              ambient, fog, extras: fn|object, lights: [...] }              */
  function room(spec) {
    const b = [spec.min.slice(), spec.max.slice()];
    const s = {
      name: spec.name || 'room',
      polys: [], gates: [], walls: [],
      ambient: spec.ambient || [0.10, 0.10, 0.13],
      fog: spec.fog || [12, 13, 18, 0.008, -0.4],
      lights: spec.lights || [],
      sprites: spec.sprites || [],
      min: spec.min.slice(), max: spec.max.slice(),
      kind: spec.kind || null,
      note: spec.note || null,
      loop: spec.loop === undefined ? null : spec.loop,
      index: spec.index === undefined ? null : spec.index,
    };

    for (const key of Object.keys(FACES)) {
      const f = FACES[key];
      const fs = spec.faces && spec.faces[key];
      const W = f.W(b), H = f.H(b);
      const o = f.o(b);
      const plane = [f.n[0], f.n[1], f.n[2], -(f.n[0] * o[0] + f.n[1] * o[1] + f.n[2] * o[2])];
      const wall = { plane: plane, face: key, gate: null };
      if (!fs || fs.skip) { s.walls.push(wall); continue; }
      const tex = fs.tex || 'stone';
      const tile = fs.tile || 4;
      const openings = (fs.openings || []).slice().sort((a, c) => a.v0 - c.v0);

      if (openings.length === 0) {
        s.polys.push(flip(faceQuad(key, b, 0, 0, W, H, tex, tile, fs.rgb)));
        s.walls.push(wall);
        continue;
      }

      /* split the face into vertical bands delimited by the openings */
      const vs = [0];
      for (const op of openings) { vs.push(Math.max(0, op.v0), Math.min(H, op.v1)); }
      vs.push(H);
      const uniq = [];
      vs.sort((a, c) => a - c).forEach((v) => { if (uniq.indexOf(v) < 0) uniq.push(v); });

      for (let bi = 0; bi < uniq.length - 1; bi++) {
        const v0 = uniq[bi], v1 = uniq[bi + 1];
        if (v1 - v0 < 1e-4) continue;
        /* openings that fully span this band become holes */
        const holes = openings.filter((op) => op.v0 <= v0 + E && op.v1 >= v1 - E)
          .sort((a, c) => a.u0 - c.u0);
        let u = 0;
        for (const op of holes) {
          const ou0 = Math.max(0, op.u0), ou1 = Math.min(W, op.u1);
          if (ou1 - ou0 < 1e-4) continue;
          if (ou0 > u) s.polys.push(flip(faceQuad(key, b, u, v0, ou0, v1, tex, tile, fs.rgb)));
          /* the hole itself */
          if (op.gate) {
            const gq = faceQuad(key, b, ou0, v0, ou1, v1, null, null, [1, 1, 1]);
            const gate = {
              id: op.gate, quad: gq.pts, center: [
                (gq.pts[0][0] + gq.pts[2][0]) * 0.5,
                (gq.pts[0][1] + gq.pts[2][1]) * 0.5,
                (gq.pts[0][2] + gq.pts[2][2]) * 0.5],
              yaw: (op.yaw || 0) * M.DEG, roll: (op.roll || 0) * M.DEG,
              face: key, w: ou1 - ou0, h: v1 - v0,
            };
            wall.gate = s.gates.length;
            s.gates.push(gate);
          } else if (op.plug) {
            s.polys.push(flip(faceQuad(key, b, ou0, v0, ou1, v1, op.plug, op.tile || 2, op.rgb)));
          }
          u = ou1;
        }
        if (u < W) s.polys.push(flip(faceQuad(key, b, u, v0, W, v1, tex, tile, fs.rgb)));
      }
      s.walls.push(wall);
    }

    /* a bounding sphere, so the renderer can reject a whole room without
       clipping its polygons one by one                                   */
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of s.polys) for (const v of p.pts) for (let k = 0; k < 3; k++) {
      if (v[k] < lo[k]) lo[k] = v[k];
      if (v[k] > hi[k]) hi[k] = v[k];
    }
    s.centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    s.radius = Math.max(1e-3, V.dist(s.centre, hi));

    if (spec.extras) {
      const extra = typeof spec.extras === 'function' ? spec.extras(b) : spec.extras;
      if (extra.polys) s.polys = s.polys.concat(extra.polys);
      if (extra.lights) s.lights = s.lights.concat(extra.lights);
      if (extra.sprites) s.sprites = s.sprites.concat(extra.sprites);
    }
    return s;
  }

  /* ── pair up gates by id and compute their transforms ────────────────── */
  function link(sectors) {
    const byId = {};
    sectors.forEach((s, si) => {
      s.index = si;
      s.gates.forEach((gt) => {
        gt.sector = si;
        const f = M.gateFrame(gt.quad);
        gt.o = f.o; gt.u = f.u; gt.v = f.v; gt.n = f.n;
        gt.w = f.w; gt.h = f.h; gt.center = [0, 1, 2].map((k) => (gt.quad[0][k] + gt.quad[2][k]) * 0.5);
        gt.plane = [gt.n[0], gt.n[1], gt.n[2],
          -(gt.n[0] * gt.center[0] + gt.n[1] * gt.center[1] + gt.n[2] * gt.center[2])];
        (byId[gt.id] = byId[gt.id] || []).push({ s: si, g: gt });
      });
    });
    let paired = 0, problems = [];
    for (const id of Object.keys(byId)) {
      const list = byId[id];
      if (list.length !== 2) { problems.push(id + ' has ' + list.length + ' ends'); continue; }
      const A = list[0], B = list[1];
      const XAB = M.gateTransform(A.g, B.g);
      const XBA = M.gateTransform(B.g, A.g);
      const yaw = (A.g.yaw !== 0 ? A.g.yaw : -B.g.yaw) || 0;
      const roll = (A.g.roll !== 0 ? A.g.roll : -B.g.roll) || 0;
      const twAB = M.gateTwist(B.g, yaw, roll);
      const twBA = M.gateTwist(A.g, -yaw, -roll);
      A.g.target = B.s; B.g.target = A.s;
      A.g.xf = twAB ? M.xfMul(twAB, XAB) : XAB;
      B.g.xf = twBA ? M.xfMul(twBA, XBA) : XBA;
      A.g.targetQuad = B.g.quad.map((p) => p.slice());
      B.g.targetQuad = A.g.quad.map((p) => p.slice());
      A.g.twin = B.g; B.g.twin = A.g;
      paired++;
    }
    return { paired: paired, problems: problems };
  }

  /* ── props ───────────────────────────────────────────────────────────── */
  function column(x, z, y0, y1, rad, sides, tex, tile) {
    sides = sides || 8;
    const polys = [];
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * M.TAU;
      pts.push([x + Math.cos(a) * rad, y0, z + Math.sin(a) * rad]);
    }
    for (let i = 0; i < sides; i++) {
      const a = pts[i], c = pts[(i + 1) % sides];
      const nrm = V.norm(V.cross([c[0] - a[0], 0, c[2] - a[2]], [0, 1, 0]));
      polys.push({
        pts: [[a[0], y0, a[2]], [c[0], y0, c[2]], [c[0], y1, c[2]], [a[0], y1, a[2]]],
        u: [0, 1, 1, 0], v: [0, 0, 1, 1],
        nrm: [nrm[0], 0, nrm[2]], tex: tex, rgb: [1, 1, 1], flags: 0,
      });
    }
    /* capital and base */
    const r2 = rad * 1.35, h = 0.16;
    for (const yy of [y0 - h, y1 - h]) {
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * M.TAU, a1 = ((i + 1) / sides) * M.TAU;
        polys.push(quad(
          [x + Math.cos(a0) * r2, yy, z + Math.sin(a0) * r2],
          [x + Math.cos(a1) * r2, yy, z + Math.sin(a1) * r2],
          [x + Math.cos(a1) * r2, yy + h, z + Math.sin(a1) * r2],
          [x + Math.cos(a0) * r2, yy + h, z + Math.sin(a0) * r2], tex, [[0, 0], [1, 0], [1, 1], [0, 1]]));
      }
    }
    return { polys: polys };
  }

  function block(x0, y0, z0, x1, y1, z1, tex, tile) {
    const polys = [];
    for (const key of Object.keys(FACES)) {
      const f = FACES[key];
      polys.push(faceQuad(key, [[x0, y0, z0], [x1, y1, z1]], 0, 0, f.W([[x0, y0, z0], [x1, y1, z1]]),
        f.H([[x0, y0, z0], [x1, y1, z1]]), tex, tile || 2));
    }
    return { polys: polys };
  }

  /* a wall torch: light + the flame sprite anchor */
  function torch(x, y, z, color, intensity, radius) {
    return {
      lights: [{ p: [x, y, z], r: radius || 7, c: color || [1.0, 0.62, 0.28], i: intensity || 1.5 }],
      sprites: [{ kind: 'flame', p: [x, y, z], size: 0.55 }],
    };
  }

  /* a hanging banner: a flat cloth quad a hair in front of a wall face */
  function banner(b, faceKey, u0, v0, u1, v1, tex, tile) {
    const f = FACES[faceKey];
    const off = [f.n[0] * 0.06, f.n[1] * 0.06, f.n[2] * 0.06];
    const p0 = facePoint(f, b, u0, v0), p1 = facePoint(f, b, u1, v0);
    const p2 = facePoint(f, b, u1, v1), p3 = facePoint(f, b, u0, v1);
    const shift = (p) => [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
    let uv;
    if (tile) {
      uv = [[u0 / tile, v0 / tile], [u1 / tile, v0 / tile], [u1 / tile, v1 / tile], [u0 / tile, v1 / tile]];
    }
    return { polys: [quad(shift(p0), shift(p1), shift(p2), shift(p3), tex, uv)] };
  }

  IH.geom = {
    FACES: FACES, room: room, link: link, quad: quad, faceQuad: faceQuad,
    facePoint: facePoint, column: column, block: block, torch: torch, banner: banner,
  };
})(typeof window !== 'undefined' ? window : globalThis);
