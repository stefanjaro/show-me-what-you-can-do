/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPOSSIBLE HOUSE — render.js
   A software 3D renderer written from scratch: portal-based view culling,
   a z-buffered, perspective-correct, textured polygon rasteriser with
   per-vertex coloured lighting and distance fog. No WebGL, no libraries.
   ═════════════════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  const IH = (g.IH = g.IH || {});
  IH.render = IH.render || {};
  const M = IH.Math;

  const MAXV = 256;           // scratch vertices
  const FOGN = 1024;          // depth/fog lookup resolution
  const MAXDEPTH = 6;        // portal recursion limit
  const FLAG_SKY = 1;         // vertical gradient, no depth write
  const FLAG_ADD = 2;         // additive blend, no depth write
  const FLAG_FLAT = 4;        // untextured: shade poly.rgb
  const FLAG_NOLIT = 8;       // emissive: skip vertex lighting

  function create(w, h) {
    const r = {
      w: 0, h: 0, buf: null, zbuf: null,
      cx: 0, cy: 0, focal: 1, aspect: 1.6,
      fovY: 72 * M.DEG, near: 0.08, far: 320,
      cam: null, world: null, sector: null, sectorIdx: 0,
      stats: { polys: 0, px: 0, recursion: 0, portals: 0 },
    };
    r._sx = new Float64Array(MAXV);
    r._sy = new Float64Array(MAXV);
    r._iz = new Float64Array(MAXV);
    r._uz = new Float64Array(MAXV);
    r._wz = new Float64Array(MAXV);
    r._lr = new Float32Array(MAXV);
    r._lg = new Float32Array(MAXV);
    r._lb = new Float32Array(MAXV);
    r._out = [];
    for (let i = 0; i < MAXV; i++) r._out.push([0, 0, 0]);
    r._sh = [0, 0, 0];
    r._fogT = new Float32Array(FOGN * 2);
    r._fogScale = 1; r._fogBias = 0; r._fogSector = null;
    setSize(r, w, h);
    return r;
  }

  function setSize(r, w, h) {
    w = Math.max(16, w | 0); h = Math.max(16, h | 0);
    r.w = w; r.h = h;
    r.buf = new Uint32Array(w * h);
    r.zbuf = new Float32Array(w * h);
    r.cx = w * 0.5; r.cy = h * 0.5;
    r.focal = h * 0.5 / Math.tan(r.fovY * 0.5);
    const H = h + 2;
    r._XL = new Float32Array(H); r._XR = new Float32Array(H);
    r._ZL = new Float32Array(H); r._ZR = new Float32Array(H);
    r._UL = new Float32Array(H); r._UR = new Float32Array(H);
    r._WL = new Float32Array(H); r._WR = new Float32Array(H);
    r._LL = new Float32Array(H); r._RL = new Float32Array(H);
    r._LG = new Float32Array(H); r._RG = new Float32Array(H);
    r._LB = new Float32Array(H); r._RB = new Float32Array(H);
  }

  /* ─────────────────────── per-vertex lighting model ──────────────────── */
  function shadeAt(world, sect, p, n, out) {
    let ar = sect.ambient[0], ag = sect.ambient[1], ab = sect.ambient[2];
    const lights = sect.lights;
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i];
      const dx = L.p[0] - p[0], dy = L.p[1] - p[1], dz = L.p[2] - p[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > L.r * L.r) continue;
      const d = Math.sqrt(d2) || 1e-5;
      const inv = 1 / d;
      /* wrapped diffuse keeps big flat walls from going dead black */
      let nd = (dx * inv) * n[0] + (dy * inv) * n[1] + (dz * inv) * n[2];
      nd = nd * 0.5 + 0.5; nd *= nd;
      const t = 1 - d / L.r;
      const att = t * t * (0.55 + 0.45 * nd) * L.i;
      ar += L.c[0] * att; ag += L.c[1] * att; ab += L.c[2] * att;
    }
    out[0] = ar; out[1] = ag; out[2] = ab;
  }

  /* ─────────────────────────── polygon rasteriser ─────────────────────── */
  function drawPoly(r, poly, pts, n) {
    const w = r.w, h = r.h, cx = r.cx, cy = r.cy, focal = r.focal;
    const cam = r.cam, sect = r.sector;

    const px = cam.p[0], py = cam.p[1], pz = cam.p[2];
    const rx = cam.r[0], ry = cam.r[1], rz = cam.r[2];
    const ux = cam.u[0], uy = cam.u[1], uz = cam.u[2];
    const fx = cam.f[0], fy = cam.f[1], fz = cam.f[2];

    let miny = 1e9, maxy = -1e9;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const dx = p[0] - px, dy = p[1] - py, dz = p[2] - pz;
      const vz = dx * fx + dy * fy + dz * fz;
      const vx = dx * rx + dy * ry + dz * rz;
      const vy = dx * ux + dy * uy + dz * uz;
      const iz = 1 / vz;
      const s = focal * iz;
      r._sx[i] = cx + vx * s;
      r._sy[i] = cy - vy * s;
      r._iz[i] = iz;
      r._uz[i] = poly.u[i] * iz;
      r._wz[i] = poly.v[i] * iz;
      if (r._sy[i] < miny) miny = r._sy[i];
      if (r._sy[i] > maxy) maxy = r._sy[i];
    }
    if (maxy < 0 || miny > h - 1) return;

    const y0 = Math.max(0, Math.ceil(miny - 0.5));
    const y1 = Math.min(h - 1, Math.floor(maxy - 0.5));
    if (y1 < y0) return;

    const flags = poly.flags;
    const sky = (flags & FLAG_SKY) !== 0;
    if (sky || (flags & FLAG_NOLIT) !== 0) {
      for (let i = 0; i < n; i++) { r._lr[i] = 1; r._lg[i] = 1; r._lb[i] = 1; }
    } else {
      const nrm = poly.nrm;
      for (let i = 0; i < n; i++) {
        shadeAt(r.world, sect, pts[i], nrm, r._sh);
        r._lr[i] = r._sh[0]; r._lg[i] = r._sh[1]; r._lb[i] = r._sh[2];
      }
    }

    const XL = r._XL, XR = r._XR, ZL = r._ZL, ZR = r._ZR;
    const UL = r._UL, UR = r._UR, WL = r._WL, WR = r._WR;
    const LL = r._LL, RL = r._RL, LG = r._LG, RG = r._RG, LB = r._LB, RB = r._RB;
    for (let y = y0; y <= y1; y++) { XL[y] = 1e30; XR[y] = -1e30; }

    /* edge walk: per-row spans and all interpolated attributes */
    for (let i = 0; i < n; i++) {
      const j = (i + 1) === n ? 0 : i + 1;
      const ax = r._sx[i], ay = r._sy[i], bx = r._sx[j], by = r._sy[j];
      if (ay === by) continue;
      const step = 1 / (by - ay);
      const ylo = Math.max(y0, Math.ceil(Math.min(ay, by) - 0.5));
      const yhi = Math.min(y1, Math.ceil(Math.max(ay, by) - 0.5) - 1);
      const aiz = r._iz[i], biz = r._iz[j];
      const auz = r._uz[i], buz = r._uz[j];
      const awz = r._wz[i], bwz = r._wz[j];
      const alr = r._lr[i], blr = r._lr[j];
      const alg = r._lg[i], blg = r._lg[j];
      const alb = r._lb[i], blb = r._lb[j];
      for (let y = ylo; y <= yhi; y++) {
        const t = (y + 0.5 - ay) * step;
        if (t < 0 || t > 1) continue;
        const x = ax + (bx - ax) * t;
        if (x < XL[y]) {
          XL[y] = x;
          ZL[y] = aiz + (biz - aiz) * t;
          UL[y] = auz + (buz - auz) * t;
          WL[y] = awz + (bwz - awz) * t;
          LL[y] = alr + (blr - alr) * t;
          LG[y] = alg + (blg - alg) * t;
          LB[y] = alb + (blb - alb) * t;
        }
        if (x > XR[y]) {
          XR[y] = x;
          ZR[y] = aiz + (biz - aiz) * t;
          UR[y] = auz + (buz - auz) * t;
          WR[y] = awz + (bwz - awz) * t;
          RL[y] = alr + (blr - alr) * t;
          RG[y] = alg + (blg - alg) * t;
          RB[y] = alb + (blb - alb) * t;
        }
      }
    }

    const tex = poly.tex ? poly.tex.img : null;
    const tw = poly.tex ? poly.tex.w : 0;
    const tmask = tw - 1;
    const tshift = tsShift(tw);

    const fog = sect.fog;
    const fr = fog[0], fg = fog[1], fb = fog[2];
    /* one division-free lookup for depth and fog, rebuilt when the room
       changes: the alternative is a divide and a clamp on every pixel    */
    let fogT = r._fogT, fogScale = r._fogScale, fogBias = r._fogBias;
    if (r._fogSector !== sect) {
      r._fogSector = sect;
      const iz0 = 1 / r.far, iz1 = 1 / r.near;
      fogScale = (FOGN - 1) / (iz1 - iz0);
      fogBias = -iz0 * fogScale;
      for (let i = 0; i < FOGN; i++) {
        const d = 1 / (iz0 + (iz1 - iz0) * (i / (FOGN - 1)));
        let kf = (d - fog[4]) * fog[3];
        kf = kf < 0 ? 0 : kf > 1 ? 1 : kf;
        fogT[i * 2] = d;
        fogT[i * 2 + 1] = kf;
      }
      r._fogScale = fogScale; r._fogBias = fogBias;
    }
    const noDepth = sky || (flags & FLAG_ADD) !== 0;
    const additive = (flags & FLAG_ADD) !== 0;
    const buf = r.buf, zbuf = r.zbuf;
    const base = poly.rgb;
    let drawn = 0;

    for (let y = y0; y <= y1; y++) {
      const xls = XL[y], xrs = XR[y];
      if (xls > xrs) continue;
      const span = xrs - xls;
      if (span < 1e-4) continue;
      let xa = Math.ceil(xls - 0.5), xb = Math.floor(xrs - 0.5);
      if (xa < 0) xa = 0;
      if (xb > w - 1) xb = w - 1;
      if (xb < xa) continue;
      const invSpan = 1 / span;
      const yxc = (xa + 0.5 - xls) * invSpan;
      let iz = ZL[y] + (ZR[y] - ZL[y]) * yxc;
      let uz = UL[y] + (UR[y] - UL[y]) * yxc;
      let wz = WL[y] + (WR[y] - WL[y]) * yxc;
      let lr = LL[y] + (RL[y] - LL[y]) * yxc;
      let lg = LG[y] + (RG[y] - LG[y]) * yxc;
      let lb = LB[y] + (RB[y] - LB[y]) * yxc;
      const diz = (ZR[y] - ZL[y]) * invSpan;
      const duz = (UR[y] - UL[y]) * invSpan;
      const dwz = (WR[y] - WL[y]) * invSpan;
      const dlr = (RL[y] - LL[y]) * invSpan;
      const dlg = (RG[y] - LG[y]) * invSpan;
      const dlb = (RB[y] - LB[y]) * invSpan;
      let idx = y * w + xa;

      if (sky) {
        const t = 1 - (y / h);
        const gg = 0.46 + 0.54 * t;
        const crv = (base[0] * gg) | 0, cgv = (base[1] * gg) | 0, cbv = (base[2] * gg) | 0;
        const col = 0xff000000 | (cbv << 16) | (cgv << 8) | crv;
        for (let x = xa; x <= xb; x++, idx++) buf[idx] = col;
        r.stats.px += xb - xa + 1;
        continue;
      }

      for (let x = xa; x <= xb; x++, idx++) {
        if (iz <= zbuf[idx]) {
          iz += diz; uz += duz; wz += dwz; lr += dlr; lg += dlg; lb += dlb;
          continue;
        }
        if (!noDepth) zbuf[idx] = iz;
        drawn++;
        let fi = (iz * fogScale + fogBias) | 0;
        if (fi < 0) fi = 0; else if (fi > FOGN - 1) fi = FOGN - 1;
        const depth = fogT[fi * 2];
        const kf = fogT[fi * 2 + 1];
        const omf = 1 - kf;
        if (tex) {
          const c = tex[((((wz * depth) | 0) & tmask) << tshift) | (((uz * depth) | 0) & tmask)];
          const crv = ((c & 255) * lr * omf + fr * kf) | 0;
          const cgv = (((c >> 8) & 255) * lg * omf + fg * kf) | 0;
          const cbv = (((c >> 16) & 255) * lb * omf + fb * kf) | 0;
          if (additive) {
            const o = buf[idx];
            let or = (o & 255) + crv, og = ((o >> 8) & 255) + cgv, ob = ((o >> 16) & 255) + cbv;
            if (or > 255) or = 255; if (og > 255) og = 255; if (ob > 255) ob = 255;
            buf[idx] = 0xff000000 | (ob << 16) | (og << 8) | or;
          } else {
            buf[idx] = 0xff000000 | (cbv << 16) | (cgv << 8) | crv;
          }
        } else {
          const crv = (base[0] * lr * omf + fr * kf) | 0;
          const cgv = (base[1] * lg * omf + fg * kf) | 0;
          const cbv = (base[2] * lb * omf + fb * kf) | 0;
          buf[idx] = 0xff000000 | (cbv << 16) | (cgv << 8) | crv;
        }
        iz += diz; uz += duz; wz += dwz; lr += dlr; lg += dlg; lb += dlb;
      }
    }
    r.stats.px += drawn;
  }

  function tsShift(tw) {
    let s = 0;
    while ((1 << s) < tw) s++;
    return s;
  }

  /* ───────────────────────── portal traversal ─────────────────────────── */
  function renderSector(r, depth) {
    const world = r.world, sect = world.sectors[r.sectorIdx];
    r.sector = sect;
    if (depth > r.stats.recursion) r.stats.recursion = depth;

    /* a room whose bounding sphere is wholly outside the view cone is not
       worth clipping polygon by polygon                                   */
    if (depth > 0 && sect.radius) {
      const c = sect.centre, rad = sect.radius;
      const pl = r._planes;
      let out = false;
      for (let i = 0; i < pl.length; i++) {
        if (pl[i][0] * c[0] + pl[i][1] * c[1] + pl[i][2] * c[2] + pl[i][3] < -rad) { out = true; break; }
      }
      if (out) return;
    }

    const planes = r._planes;
    const polys = sect.polys;
    const out = r._out;
    for (let i = 0; i < polys.length; i++) {
      const poly = polys[i];
      const n = M.clipPoly(poly.pts, poly.pts.length, planes, out, planes.length);
      if (n >= 3) { r.stats.polys++; drawPoly(r, poly, out, n); }
    }

    if (depth >= MAXDEPTH) return;
    const cam = r.cam;
    const gates = sect.gates;
    for (let i = 0; i < gates.length; i++) {
      const gt = gates[i];
      if (!gt.active) continue;
        /* The camera must be inside the sector that owns this gate, looking
           out through it: the only configuration in which the gate is a
           window onto the room beyond.                                    */
        const dx = cam.p[0] - gt.center[0], dy = cam.p[1] - gt.center[1], dz = cam.p[2] - gt.center[2];
        if (gt.n[0] * dx + gt.n[1] * dy + gt.n[2] * dz >= 0) continue;
        if (gt.n[0] * cam.f[0] + gt.n[1] * cam.f[1] + gt.n[2] * cam.f[2] <= 0) continue;

      const childCam = M.poseApply(gt.xf, cam);
      const childPlanes = M.frustumPlanes(childCam, r.near, r.far, r.fovY, r.aspect, []);
      M.conePlanes(childCam.p, gt.targetQuad, childPlanes);

      const saveSector = r.sectorIdx, savePlanes = r._planes;
      r._planes = childPlanes;
      r.sectorIdx = gt.target;
      r.stats.portals++;
      renderSector(r, depth + 1);
      r._planes = savePlanes;
      r.sectorIdx = saveSector;
      r.sector = world.sectors[saveSector];
    }
  }

  function render(r, world, cam, sectorIdx, opts) {
    opts = opts || {};
    r.world = world;
    r.cam = cam;
    r.sectorIdx = sectorIdx === undefined ? 0 : sectorIdx;
    r.aspect = opts.aspect || r.w / r.h;
    r.fovY = opts.fovY || 74 * M.DEG;
    r.near = opts.near || 0.08;
    r.far = opts.far || 320;
    r.focal = r.h * 0.5 / Math.tan(r.fovY * 0.5);
    r._planes = M.frustumPlanes(cam, r.near, r.far, r.fovY, r.aspect, []);
    r.stats.polys = 0; r.stats.px = 0; r.stats.recursion = 0; r.stats.portals = 0;
    r.buf.fill(opts.clear === undefined ? 0xff0a0a0c : opts.clear);
    r.zbuf.fill(0);
    renderSector(r, 0);
    return r.buf;
  }

  /* ───────────────────────────── sprites ──────────────────────────────── */
  function drawSprite(r, tex, worldPos, size, rgb, additive) {
    const cam = r.cam;
    const dx = worldPos[0] - cam.p[0], dy = worldPos[1] - cam.p[1], dz = worldPos[2] - cam.p[2];
    const depth = dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2];
    if (depth < 0.15) return;
    const hw = size * 0.5, hh = size * 0.5;
    const ax = cam.r[0] * hw, ay = cam.r[1] * hw, az = cam.r[2] * hw;
    const bx = cam.u[0] * hh, by = cam.u[1] * hh, bz = cam.u[2] * hh;
    const x = worldPos[0], y = worldPos[1], z = worldPos[2];
    const pts = [
      [x - ax + bx, y - ay + by, z - az + bz],
      [x + ax + bx, y + ay + by, z + az + bz],
      [x + ax - bx, y + ay - by, z + az - bz],
      [x - ax - bx, y - ay - by, z - az - bz],
    ];
    const poly = {
      pts: pts, u: [0, 1, 1, 0], v: [1, 1, 0, 0],
      nrm: cam.f, tex: tex, rgb: rgb, flags: FLAG_FLAT | FLAG_NOLIT | (additive ? FLAG_ADD : 0),
    };
    const n = M.clipPoly(pts, 4, r._planes, r._out, r._planes.length);
    if (n >= 3) drawPoly(r, poly, r._out, n);
  }

  IH.render.create = create;
  IH.render.setSize = setSize;
  IH.render.render = render;
  IH.render.drawSprite = drawSprite;
  IH.render.drawPoly = drawPoly;
  IH.render.shadeAt = shadeAt;
  IH.render.FLAG_SKY = FLAG_SKY;
  IH.render.FLAG_ADD = FLAG_ADD;
  IH.render.FLAG_FLAT = FLAG_FLAT;
  IH.render.FLAG_NOLIT = FLAG_NOLIT;
})(typeof window !== 'undefined' ? window : globalThis);
