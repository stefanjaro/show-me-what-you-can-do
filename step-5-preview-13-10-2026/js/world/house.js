/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPOSSIBLE HOUSE — house.js
   The house itself: an atrium, four wings — each breaking geometry in a
   different way — and a core. Everything is plain data built with the brush
   and doorway language of geom.js. No assets, no network, no libraries.
   ═════════════════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  const IH = (g.IH = g.IH || {});
  const M = IH.Math;
  const V = M.V;
  const G = IH.geom;

  const EYE = 1.65;
  const RAD = 0.36;

  /* fog: [r,g,b, scale, bias] with k = (iz - bias) * scale, iz = 1/depth */
  function fog(r, gg, b, start, end) {
    return [r, gg, b, 1 / (end - start), start];
  }

  /* A doorway. `w0,w1` are the door's extent along the wall's horizontal
     axis in world coordinates; `v0,v1` its height above the floor.        */
  function door(faceKey, b, w0, w1, id, v0, v1, extra) {
    let u0, u1;
    switch (faceKey) {
      case 'nx': u0 = w0 - b[0][2]; u1 = w1 - b[0][2]; break;
      case 'px': u0 = b[1][2] - w1; u1 = b[1][2] - w0; break;
      case 'ny': u0 = w0 - b[0][0]; u1 = w1 - b[0][0]; break;
      case 'py': u0 = b[1][0] - w1; u1 = b[1][0] - w0; break;
      case 'nz': u0 = b[1][0] - w1; u1 = b[1][0] - w0; break;
      case 'pz': u0 = w0 - b[0][0]; u1 = w1 - b[0][0]; break;
    }
    const op = { _f: faceKey, gate: id, u0: u0, u1: u1,
      v0: v0 === undefined ? 0.1 : v0, v1: v1 === undefined ? 2.32 : v1 };
    if (extra) for (const k in extra) op[k] = extra[k];
    return op;
  }

  /* The same, but centred on the face: `width` metres wide, with its sill
     `vc` metres above the floor (a 2.22 m tall doorway by default).      */
  function doorCenter(faceKey, b, width, id, vc, extra) {
    const horiz = (faceKey === 'nx' || faceKey === 'px') ? 2 : 0;   /* index of the horizontal axis */
    const lo = b[0][horiz], hi = b[1][horiz];
    const mid = (lo + hi) * 0.5;
    const v0 = vc === undefined ? 0.1 : Math.max(0, vc - 1.11);
    return door(faceKey, b, mid - width * 0.5, mid + width * 0.5, id, v0, v0 + 2.22, extra);
  }

  function withDoors(base, doors) {
    const f = { ny: { tex: 'tile', tile: 4 }, py: { tex: 'plaster', tile: 4 } };
    for (const k of ['nx', 'px', 'nz', 'pz']) {
      const ds = doors.filter((d) => d._f === k);
      const sp = base[k] || {};
      f[k] = { tex: sp.tex || 'stone', tile: sp.tile || 4,
        openings: ds.length ? ds : null, rgb: sp.rgb };
    }
    return f;
  }

  /* ══════════════════════════════ THE ATRIUM ══════════════════════════ */
  function atrium() {
    const min = [-9, 0, -5], max = [9, 7.2, 5];
    const b = [min, max];
    const cols = [];
    for (const x of [-6, -2, 2, 6]) for (const z of [-2.6, 2.6]) {
      const c = G.column(x, z, 0, 6.4, 0.5, 8, 'marble', 1.6);
      for (const p of c.polys) cols.push(p);
    }
    const doors = [
      doorCenter('nx', b, 2.4, 'd-atrium-turning'),
      doorCenter('px', b, 2.4, 'd-atrium-stairs'),
      doorCenter('nz', b, 2.4, 'd-atrium-gallery'),
      doorCenter('pz', b, 2.4, 'd-atrium-annex'),
    ];
    const s = G.room({
      name: 'THE ATRIUM', min: min, max: max, kind: 'atrium',
      ambient: [0.22, 0.16, 0.12], fog: fog(22, 16, 14, 11, 52),
      lights: [
        { p: [0, 6.0, 0], r: 18, c: [1.0, 0.76, 0.45], i: 1.6 },
        { p: [-6.2, 4.3, -2.6], r: 12, c: [1.0, 0.62, 0.28], i: 1.0 },
        { p: [6.2, 4.3, 2.6], r: 12, c: [1.0, 0.62, 0.28], i: 1.0 },
      ],
      faces: withDoors({}, doors),
      extras: { polys: cols },
    });
    facesOverride(s, b);
    s.polys = s.polys.concat(G.banner(b, 'nz', 5.4, 1.1, 7.2, 5.8, 'tapestry', 2).polys);
    s.polys = s.polys.concat(G.banner(b, 'nz', 8.8, 1.1, 10.6, 5.8, 'tapestry', 2).polys);
    s.sprites.push({ kind: 'flame', p: [-6.2, 4.5, -2.6], size: 0.66 });
    s.sprites.push({ kind: 'flame', p: [6.2, 4.5, 2.6], size: 0.66 });
    s.note = { id: 'note-atrium', title: 'THE IMPOSSIBLE HOUSE',
      text: 'Five doors. Four of them lead somewhere you cannot walk to from where you are standing. The house was built around a room no surveyor could agree on. Find the four seals; the core will open.' };
    return s;
  }

  /* give a sector explicit textures (used by the atrium floor/ceiling) */
  function facesOverride(s, b) {
    /* the base room() already laid tile/coffer; keep it */
  }

  /* ═══════════════════════════════ ANNEX ══════════════════════════════ */
  function annex() {
    const min = [-4, 0, 5], max = [4, 4.4, 9];
    const b = [min, max];
    const doors = [
      doorCenter('nz', b, 2.4, 'd-atrium-annex'),
      doorCenter('px', b, 2.4, 'd-annex-chapel'),
      doorCenter('pz', b, 2.4, 'd-core'),
    ];
    const s = G.room({
      name: 'THE ANNEX', min: min, max: max, kind: 'annex',
      ambient: [0.21, 0.18, 0.17], fog: fog(20, 17, 16, 7, 30),
      lights: [{ p: [0, 3.6, 7], r: 9, c: [1.0, 0.7, 0.4], i: 1.2 }],
      faces: withDoors({}, doors),
    });
    s.sprites.push({ kind: 'flame', p: [3.4, 3.4, 7], size: 0.6 });
    s.note = { id: 'note-core', title: 'THE SEALED DOOR',
      text: 'Beyond it, the core. It answers only to four seals.' };
    return s;
  }

  /* ═════════════════ WING I — THE HALL OF TURNING ════════════════════ */
  /* Four rooms in a ring. Three doors are ordinary; the fourth is twisted a
     quarter turn about its own vertical, so the ring carries holonomy.   */
  function turning() {
    const R = [
      { n: 'THE BLUE ROOM', min: [-30, 0, -5], max: [-22, 3.6, 5] },
      { n: 'THE GOLD ROOM', min: [-22, 0, -5], max: [-14, 3.6, 5] },
      { n: 'THE RED ROOM', min: [-22, 0, 5], max: [-14, 3.6, 15] },
      { n: 'THE GREEN ROOM', min: [-30, 0, 5], max: [-22, 3.6, 15] },
    ];
    const tint = [
      { rgb: [0.66, 0.82, 1.0], amb: [0.13, 0.18, 0.26] },
      { rgb: [1.0, 0.86, 0.55], amb: [0.24, 0.19, 0.10] },
      { rgb: [1.0, 0.62, 0.56], amb: [0.24, 0.13, 0.12] },
      { rgb: [0.68, 1.0, 0.76], amb: [0.13, 0.22, 0.16] },
    ];
    const out = [];
    R.forEach((r, i) => {
      const b = [r.min, r.max];
      const doors = [];
      if (i === 0) {
        doors.push(doorCenter('px', b, 2.4, 'd-atrium-turning'));
        doors.push(door('px', b, -4.6, -2.2, 'd-turn-10', 0.1, 2.32, { yaw: 90 }));
        doors.push(doorCenter('pz', b, 2.4, 'd-turn-03'));
      } else if (i === 1) {
        doors.push(door('nx', b, -4.6, -2.2, 'd-turn-10', 0.1, 2.32));
        doors.push(doorCenter('pz', b, 2.4, 'd-turn-12'));
      } else if (i === 2) {
        doors.push(doorCenter('nz', b, 2.4, 'd-turn-12'));
        doors.push(doorCenter('nx', b, 2.4, 'd-turn-23'));
      } else {
        doors.push(doorCenter('px', b, 2.4, 'd-turn-23'));
        doors.push(doorCenter('nz', b, 2.4, 'd-turn-03'));
      }
      const s = G.room({
        name: r.n, min: r.min, max: r.max, kind: 'turning', index: i,
        ambient: [tint[i].amb[0] + 0.07, tint[i].amb[1] + 0.07, tint[i].amb[2] + 0.07],
        fog: fog(20, 20, 30, 10, 46),
        lights: [{ p: [(r.min[0] + r.max[0]) / 2, 3.0, (r.min[2] + r.max[2]) / 2],
          r: 14, c: tint[i].rgb, i: 1.6 }],
        faces: withDoors({}, doors),
      });
      const col = G.column((r.min[0] + r.max[0]) / 2 + 2.4, (r.min[2] + r.max[2]) / 2 - 1.7,
        0, 3.3, 0.42, 6, 'basalt', 2);
      s.polys = s.polys.concat(col.polys);
      /* a banner so that a turned-around room is obvious */
      s.polys = s.polys.concat(G.banner(b, i === 0 ? 'pz' : (i === 3 ? 'nz' : 'nx'), 6.0, 1.0, 7.8, 5.6,
        'tapestry', 2).polys);
      s.tint = tint[i].rgb;
      s.place = { pos: [(r.min[0] + r.max[0]) / 2, EYE, (r.min[2] + r.max[2]) / 2], f: [1, 0, 0] };
      out.push(s);
    });
    out[2].items = [{ id: 'frag-1', name: 'THE FIRST SEAL',
      pos: [out[2].place.pos[0], 1.15, out[2].place.pos[2] - 2.2] }];
    out[0].note = { id: 'note-turning', title: 'HOLONOMY',
      text: 'The ring turns four times and should bring you back facing the way you came. Walk it and count.' };
    return out;
  }

  /* ══════════ WING II — THE PENROSE ASCENT (ascent forever) ══════════ */
  function stairs() {
    const D = 1.8, W = 3.2, H = 2.5, RISE = 0.26, FL = 3, LOOPS = 3;
    const dirs = ['n', 'e', 's', 'w'];
    const out = [];
    let n = 0;

    for (let loop = 0; loop < LOOPS; loop++) {
      const ox = 12 + loop * 14, oz = -8, oy = loop * FL * 4 * RISE;
      /* the four flight anchor points */
      const A = [ox, oz];                       /* flight 'n' start            */
      const B = [ox + W, oz + (FL - 1) * D];    /* flight 'e' start            */
      const C = [ox + W + (FL - 1) * D, oz + (FL - 1) * D]; /* flight 's' start */
      const E = [ox + W + FL * D, oz - (FL - 1) * D];       /* flight 'w' start */
      const anchor = [A, B, C, E];
      for (let fl = 0; fl < 4; fl++) {
        const dir = dirs[fl];
        for (let j = 0; j < FL; j++) {
          let minx, minz, maxx, maxz;
          if (dir === 'n') { const X = anchor[fl][0], Z = anchor[fl][1] + j * D;
            minx = X; maxx = X + W; minz = Z; maxz = Z + D; }
          else if (dir === 's') { const X = anchor[fl][0], Z = anchor[fl][1] - j * D;
            minx = X; maxx = X + W; minz = Z - D; maxz = Z; }
          else if (dir === 'e') { const X = anchor[fl][0] + j * D, Z = anchor[fl][1];
            minx = X; maxx = X + D; minz = Z; maxz = Z + W; }
          else { const X = anchor[fl][0] - j * D, Z = anchor[fl][1];
            minx = X - D; maxx = X; minz = Z; maxz = Z + W; }
          const y = oy + fl * (FL * RISE) + j * RISE;
          const b = [[minx, y, minz], [maxx, y + H, maxz]];
          const doors = [];
          /* entry from behind */
          const back = { n: 'nz', e: 'nx', s: 'pz', w: 'px' }[dir];
          const front = { n: 'pz', e: 'px', s: 'nz', w: 'nx' }[dir];
          if (loop === 0 && fl === 0 && j === 0) doors.push(doorCenter(back, b, 2.2, 'd-atrium-stairs'));
          else if (fl === 0 && j === 0) doors.push(doorCenter(back, b, 2.2, 'd-loop-' + (loop - 1)));
          else doors.push(doorCenter(back, b, 2.2, 'd-step-' + (n - 1)));
          /* exit ahead */
          if (loop === LOOPS - 1 && fl === 3 && j === FL - 1) {
            doors.push(doorCenter(front, b, 2.2, 'd-stairs-core'));
          } else if (fl === 3 && j === FL - 1) {
            doors.push(doorCenter(front, b, 2.2, 'd-loop-' + loop));
          } else if (j === FL - 1) {
            /* the corner: the doorway turns with the flight, so it sits in
               the wall the next flight runs along                         */
            const side = { n: 'px', e: 'nz', s: 'nx', w: 'pz' }[dir];
            doors.push(doorCenter(side, b, 2.2, 'd-step-' + n));
          } else {
            doors.push(doorCenter(front, b, 2.2, 'd-step-' + n));
          }
          const s = G.room({
            name: 'ASCENT ' + (n + 1), min: [minx, y, minz], max: [maxx, y + H, maxz],
            kind: 'stairs', step: n, loop: loop,
            ambient: [0.18, 0.20, 0.25], fog: fog(16, 18, 30, 9, 42),
            lights: [{ p: [(minx + maxx) / 2, y + H - 0.45, (minz + maxz) / 2],
              r: 9, c: [1.0, 0.78, 0.5], i: 1.7 }],
            faces: withDoors({}, doors),
          });
          /* iron railings along the outer edges so the tower reads */
          const rails = [];
          if (dir === 'n' || dir === 's') {
            rails.push(G.block(minx - 0.14, y + 0.85, minz - 0.1, minx, y + 1.02, maxz + 0.1, 'iron', 2).polys);
            rails.push(G.block(maxx, y + 0.85, minz - 0.1, maxx + 0.14, y + 1.02, maxz + 0.1, 'iron', 2).polys);
          } else {
            rails.push(G.block(minx - 0.1, y + 0.85, minz - 0.14, maxx + 0.1, y + 1.02, minz, 'iron', 2).polys);
          }
          for (const rr of rails) s.polys = s.polys.concat(rr);
          s.sprites.push({ kind: 'flame', p: [(minx + maxx) / 2, y + H - 0.25, (minz + maxz) / 2], size: 0.5 });
          out.push(s);
          n++;
        }
      }
    }
    /* the seal sits on a landing a little over halfway up */
    const land = out[Math.floor(out.length * 0.6)];
    const c = [(land.min[0] + land.max[0]) / 2, (land.min[2] + land.max[2]) / 2];
    land.items = [{ id: 'frag-2', name: 'THE SECOND SEAL', pos: [c[0], land.min[1] + 1.0, c[1]] }];
    out[0].note = { id: 'note-stairs', title: 'THE PENROSE ASCENT',
      text: 'Twelve steps to a flight, four flights to a circuit, and the last landing of every circuit opens onto the first step of the next — one landing higher than the last time you stood there.' };
    return out;
  }

  /* ═══════════ WING III — THE RECESSIONAL (infinite regress) ═════════ */
  function gallery() {
    const N = 7, SHRINK = 0.8;
    let cx = 0, cz = -15, scale = 1;
    const out = [];
    for (let i = 0; i < N; i++) {
      const half = 3.6 * scale;
      const x0 = cx - half, x1 = cx + half, z0 = cz - half, z1 = cz + half;
      const b = [[x0, 0, z0], [x1, 2.7, z1]];
      const doors = [];
      const east = (i % 2) === 0;
      const outFace = east ? 'pz' : 'px';
      const inFace = east ? 'nz' : 'nx';
      if (i === 0) doors.push(doorCenter(inFace, b, 2.2, 'd-atrium-gallery'));
      if (i < N - 1) doors.push(doorCenter(outFace, b, 2.2, 'd-recess-' + i));
      if (i > 0) doors.push(doorCenter(inFace, b, 2.2, 'd-recess-' + (i - 1)));
      const s = G.room({
        name: 'RECESS ' + (i + 1), min: [x0, 0, z0], max: [x1, 2.7, z1], kind: 'gallery', index: i,
        ambient: [0.26, 0.23, 0.20], fog: fog(28, 24, 22, 6, 30),
        lights: [{ p: [cx, 2.25, cz], r: 8 + 9 * (1 - i / N), c: [1.0, 0.86, 0.62], i: 1.5 }],
        faces: withDoors({}, doors),
      });
      const col = G.column(cx + half * 0.46, cz + half * 0.46, 0, 1.0 + 1.3 * scale, 0.2 + 0.17 * scale,
        6, 'gilt', 1.4);
      s.polys = s.polys.concat(col.polys);
      s.place = { pos: [cx, EYE, cz], f: east ? [0, 0, 1] : [1, 0, 0] };
      /* spiral outwards, shrinking */
      const nxt = 3.6 * scale * SHRINK;
      if (east) cz += half + nxt; else cx += half + nxt;
      scale *= SHRINK;
      out.push(s);
    }
    out[out.length - 1].items = [{ id: 'frag-3', name: 'THE THIRD SEAL',
      pos: out[out.length - 1].place.pos.slice() }];
    out[0].note = { id: 'note-gallery', title: 'THE RECESSIONAL',
      text: 'Seven rooms, each four fifths of the last, each turned a quarter. Descend as far as you can: the far wall is always the same distance away.' };
    return out;
  }

  /* ══════════ WING IV — THE INVERTED CHAPEL (turn you over) ══════════ */
  function chapel() {
    const out = [];
    const amin = [-4, 0, 6], amax = [4, 3.4, 12];
    const ab = [amin, amax];
    const ante = G.room({
      name: 'THE ANTEROOM', min: amin, max: amax, kind: 'chapel',
      ambient: [0.21, 0.18, 0.21], fog: fog(25, 20, 24, 7, 30),
      lights: [{ p: [0, 2.9, 9], r: 13, c: [1.0, 0.66, 0.38], i: 1.9 }],
      faces: withDoors({
        nx: { tex: 'stone' }, px: { tex: 'stone' }, nz: { tex: 'stone' }, pz: { tex: 'stone' },
      }, [
        doorCenter('nx', ab, 2.0, 'd-annex-chapel'),
        door('px', ab, 7.8, 10.2, 'd-chapel-flip', 0.78, 3.0),
      ]),
    });
    ante.place = { pos: [0, EYE, 9], f: [1, 0, 0] };
    ante.note = { id: 'note-chapel', title: 'THE INVERSION',
      text: 'The east door is hinged about nothing at all. Go through and let the floor decide where it went.' };
    out.push(ante);

    const cmin = [4, 0, 7], cmax = [18, 4.6, 16];
    const cb = [cmin, cmax];
    const props = [];
    for (let i = 0; i < 4; i++) {
      const bb = G.block(5.8 + i * 2.5, 3.15, 10.0, 7.4 + i * 2.5, 3.4, 14.6, 'wood', 1.6);
      for (const p of bb.polys) props.push(p);
    }
    for (let i = 0; i < 5; i++) {
      const c = G.column(5.6 + i * 3.1, 9.2, 0, 4.0, 0.34, 6, 'basalt', 2);
      for (const p of c.polys) props.push(p);
    }
    const rel = G.block(10.5, 2.9, 11.8, 11.7, 4.4, 13.2, 'gilt', 1.2);
    for (const p of rel.polys) props.push(p);
    const cage = G.block(10.2, 3.55, 11.5, 12.0, 3.75, 13.5, 'iron', 1.4);
    for (const p of cage.polys) props.push(p);
    const vault = G.room({
      name: 'THE INVERTED CHAPEL', min: cmin, max: cmax, kind: 'chapel',
      ambient: [0.15, 0.13, 0.16], fog: fog(28, 20, 25, 10, 42),
      lights: [
        { p: [11, 1.1, 12.2], r: 14, c: [0.82, 0.62, 1.0], i: 1.2 },
        { p: [11, 3.9, 12.2], r: 14, c: [1.0, 0.76, 0.46], i: 1.1 },
      ],
      faces: withDoors({
        nx: { tex: 'basalt' }, px: { tex: 'basalt' }, nz: { tex: 'basalt' }, pz: { tex: 'basalt' },
        py: { tex: 'iron' },
      }, [
        /* the same doorway, seen from the vault as a hatch cut high in the
           west wall: half a turn about its own face, which stands the
           visitor on the vault without turning them round at all.        */
        door('nx', cb, 7.8, 10.2, 'd-chapel-flip', 3.4, 4.6, { yaw: 0, roll: 180 }),
      ]),
    });
    vault.polys = vault.polys.concat(props);
    vault.items = [{ id: 'frag-4', name: 'THE FOURTH SEAL', pos: [11, 3.65, 12.5] }];
    vault.sprites.push({ kind: 'flame', p: [6.2, 4.2, 9], size: 0.7 });
    vault.place = { pos: [11, EYE, 12.2], f: [1, 0, 0] };
    out.push(vault);
    return out;
  }

  /* ═══════════════════════════ THE CORE ═════════════════════════════ */
  function core() {
    const min = [-7, 0, 14], max = [7, 7.5, 26];
    const b = [min, max];
    const props = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * M.TAU;
      const c = G.column(Math.cos(a) * 5.4, 20 + Math.sin(a) * 5.4, 0, 6.6, 0.42, 8, 'marble', 2);
      for (const p of c.polys) props.push(p);
    }
    const inl = G.block(-3.4, 0.02, 16.6, 3.4, 0.07, 19.4, 'gilt', 3);
    for (const p of inl.polys) props.push(p);
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * M.TAU, a1 = ((i + 1) / 4) * M.TAU, R = 180;
      props.push({
        pts: [[Math.cos(a0) * R, 26, 20 + Math.sin(a0) * R],
              [Math.cos(a1) * R, 26, 20 + Math.sin(a1) * R],
              [Math.cos(a1) * R, 170, 20 + Math.sin(a1) * R],
              [Math.cos(a0) * R, 170, 20 + Math.sin(a0) * R]],
        u: [0, 1, 1, 0], v: [0, 0, 1, 1], nrm: [0, 1, 0], tex: null,
        rgb: [0.20, 0.23, 0.44], flags: 1,
      });
    }
    const s = G.room({
      name: 'THE CORE', min: min, max: max, kind: 'core',
      ambient: [0.19, 0.185, 0.25], fog: fog(20, 20, 34, 13, 74),
      lights: [{ p: [0, 5.4, 20], r: 24, c: [0.92, 0.88, 1.0], i: 1.7 }],
      faces: withDoors({
        nx: { tex: 'marble' }, px: { tex: 'marble' }, nz: { tex: 'marble' }, pz: { tex: 'marble' },
        ny: { tex: 'gilt' }, py: { tex: 'starfield', skip: true },
      }, [doorCenter('nz', b, 2.8, 'd-core'), doorCenter('px', b, 2.4, 'd-stairs-core')]),
    });
    s.polys = s.polys.concat(props);
    s.sprites.push({ kind: 'flame', p: [0, 6.2, 20], size: 0.85 });
    s.place = { pos: [0, EYE, 22.5], f: [0, 0, -1] };
    return s;
  }

  /* ═══════════════════════════════ build ═════════════════════════════ */
  function build() {
    const sectors = [];
    const wings = {};
    const push = (list, key) => {
      if (!list.length) return;
      wings[key] = { start: sectors.length, count: list.length };
      for (const s of list) sectors.push(s);
    };
    sectors.push(atrium());
    push(annex ? [annex()] : [], 'annex');
    push(turning(), 'turning');
    push(stairs(), 'stairs');
    push(gallery(), 'gallery');
    push(chapel(), 'chapel');
    push(core ? [core()] : [], 'core');
    const info = G.link(sectors);
    /* both ways into the core stay shut until the four seals are gathered */
    for (const s of sectors) for (const gt of s.gates) {
      if (gt.id === 'd-core' || gt.id === 'd-stairs-core') gt.active = false;
    }
    /* every gate is live unless said otherwise */
    for (const s of sectors) for (const gt of s.gates) if (gt.active === undefined) gt.active = true;
    const items = [];
    for (const s of sectors) if (s.items) for (const it of s.items) {
      it.sector = s.index; items.push(it);
      /* every seal sits on a plinth and carries its own light, so it can be
         seen from across the room — or from the ceiling, as the case is  */
      const h = it.pos[1] - s.min[1];
      if (h > 0.55 && h < 2.6) {
        const pl = G.block(it.pos[0] - 0.26, s.min[1], it.pos[2] - 0.26,
          it.pos[0] + 0.26, it.pos[1] - 0.1, it.pos[2] + 0.26, 'gilt', 1);
        for (const p of pl.polys) s.polys.push(p);
      }
      s.sprites.push({ kind: 'seal', p: it.pos.slice(), size: 0.42 });
      s.lights.push({ p: it.pos, r: 5.5, c: [1.0, 0.86, 0.5], i: 1.35 });
    }
    /* dust, so the still air is not quite still */
    for (const s of sectors) {
      const n = 7;
      for (let i = 0; i < n; i++) {
        const h1 = IH.noise.hash2(s.index * 31 + i, 17, 91);
        const h2 = IH.noise.hash2(s.index * 31 + i, 23, 17);
        const h3 = IH.noise.hash2(s.index * 31 + i, 29, 33);
        const h4 = IH.noise.hash2(s.index * 31 + i, 31, 57);
        s.sprites.push({
          kind: 'dust',
          p: [s.min[0] + h1 * (s.max[0] - s.min[0]),
              s.min[1] + 0.4 + h2 * (s.max[1] - s.min[1] - 0.6),
              s.min[2] + h3 * (s.max[2] - s.min[2])],
          size: 0.035 + h4 * 0.05,
        });
      }
    }
    const notes = [];
    for (const s of sectors) if (s.note) { s.note.sector = s.index; notes.push(s.note); }
    return {
      sectors: sectors, wings: wings, info: info, items: items, notes: notes,
      start: { sector: 0, pos: [0, EYE, 2.4], r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, -1] },
      wing: function (k) { return wings[k]; },
    };
  }

  /* ═══════════════════════════ the visitor ═══════════════════════════ */
  function player(world) {
    const st = world.start;
    const p = {
      sector: st.sector, pos: st.pos.slice(),
      r: st.r.slice(), u: st.u.slice(), f: st.f.slice(),
      radius: RAD, yaw: Math.PI, pitch: 0, ignore: null, ignoreT: 0,
      look: st.f.slice(),
      bob: 0, dist: 0, speed: 0, flipped: 0,
    };
    return p;
  }

  /* rotate the three basis vectors about `axis` by `ang` */
  function turnBasis(p, axis, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const ax = axis[0], ay = axis[1], az = axis[2];
    const rot = (v) => [
      v[0] * c + (ay * v[2] - az * v[1]) * s + ax * (ax * v[0] + ay * v[1] + az * v[2]) * (1 - c),
      v[1] * c + (az * v[0] - ax * v[2]) * s + ay * (ax * v[0] + ay * v[1] + az * v[2]) * (1 - c),
      v[2] * c + (ax * v[1] - ay * v[0]) * s + az * (ax * v[0] + ay * v[1] + az * v[2]) * (1 - c)];
    p.r = rot(p.r); p.u = rot(p.u); p.f = rot(p.f);
    /* yaw is about the visitor's own vertical, so the level walking
       direction follows it; pitch is not, and must not               */
    const onU = Math.abs(ax - p.u[0]) < 1e-6 && Math.abs(ay - p.u[1]) < 1e-6 && Math.abs(az - p.u[2]) < 1e-6;
    if (onU && p.look) p.look = rot(p.look);
  }

  /* Walking uses the level direction the visitor is facing, not the way they
     are looking: tilt the head and the feet stay where they were.       */
  function walkDir(p) {
    let v = p.look;
    if (!v) {
      const d = V.dot(p.f, p.u);
      v = [p.f[0] - p.u[0] * d, p.f[1] - p.u[1] * d, p.f[2] - p.u[2] * d];
    }
    const dd = V.dot(v, p.u);
    v = [v[0] - p.u[0] * dd, v[1] - p.u[1] * dd, v[2] - p.u[2] * dd];
    const l = V.len(v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  function look(p, dyaw, dpitch) {
    if (dyaw) turnBasis(p, p.u, dyaw);
    if (dpitch) {
      const cur = Math.asin(Math.max(-1, Math.min(1, V.dot(p.f, p.u))));
      const want = Math.max(-1.35, Math.min(1.35, cur + dpitch));
      turnBasis(p, p.r, want - cur);
    }
  }

  function faceDir(p, dir, up) {
    const b = V.basis(dir, up || [0, 1, 0]);
    p.f = b.f; p.r = b.r; p.u = b.u;
    if (p.u) {
      const d = V.dot(dir, p.u);
      const v = [dir[0] - p.u[0] * d, dir[1] - p.u[1] * d, dir[2] - p.u[2] * d];
      p.look = V.len(v) > 1e-6 ? V.norm(v) : p.look;
    }
  }

  /* one movement step with collision against walls and doorways */
  function step(world, p, dir, dt, speed) {
    const sect = world.sectors[p.sector];
    let remain = speed * dt;
    const MAXS = 0.12;
    while (remain > 1e-6) {
      const s = Math.min(remain, MAXS);
      remain -= s;
      const np = [p.pos[0] + dir[0] * s, p.pos[1] + dir[1] * s, p.pos[2] + dir[2] * s];
      /* Doorways first. A doorway is a window, and a visitor who is inside
         the window's frame and has reached its plane is through it — that
         holds whether they walked in forwards or backed out again.      */
      let moved = false;
      for (let i = 0; i < sect.gates.length; i++) {
        const gt = sect.gates[i];
        if (!gt.active) continue;
        const d1 = gt.n[0] * np[0] + gt.n[1] * np[1] + gt.n[2] * np[2] + gt.plane[3];
        if (d1 < 0) continue;
        const du = (np[0] - gt.center[0]) * gt.u[0] + (np[1] - gt.center[1]) * gt.u[1] + (np[2] - gt.center[2]) * gt.u[2];
        const dv = (np[0] - gt.center[0]) * gt.v[0] + (np[1] - gt.center[1]) * gt.v[1] + (np[2] - gt.center[2]) * gt.v[2];
        const MU = 0.05;
        if (du < -gt.w * 0.5 - MU || du > gt.w * 0.5 + MU ||
            dv < -gt.h * 0.5 - MU || dv > gt.h * 0.5 + MU) continue;
        /* through the looking glass, with a shove into the room beyond so
           the visitor is never left standing just outside its walls   */
        p.pos = M.pointApply(gt.xf, np);
        const inwards = gt.twin ? gt.twin.n : gt.n;
        p.pos = [p.pos[0] - inwards[0] * p.radius * 0.8,
                 p.pos[1] - inwards[1] * p.radius * 0.8,
                 p.pos[2] - inwards[2] * p.radius * 0.8];
        p.r = M.dirApply(gt.xf, p.r);
        p.u = M.dirApply(gt.xf, p.u);
        p.f = M.dirApply(gt.xf, p.f);
        p.look = M.dirApply(gt.xf, p.look);
        p.sector = gt.target;
        p.ignore = null; p.ignoreT = 0;
        p.flipped = p.flipped + (Math.abs(V.dot(p.u, [0, 1, 0])) < 0.5 ? 1 : 0);
        moved = true;
        break;
      }
      if (moved) continue;

      /* Walls. A doorway frame is negotiable; everything else is not. */
      const walls = world.sectors[p.sector].walls;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < walls.length; i++) {
          const w = walls[i];
          const n = w.plane;
          const d = n[0] * np[0] + n[1] * np[1] + n[2] * np[2] + n[3];
          if (d <= -p.radius) continue;
          if (w.gate !== null && world.sectors[p.sector].gates[w.gate].active) {
            const gt = world.sectors[p.sector].gates[w.gate];
            const du = (np[0] - gt.center[0]) * gt.u[0] + (np[1] - gt.center[1]) * gt.u[1] + (np[2] - gt.center[2]) * gt.u[2];
            const dv = (np[0] - gt.center[0]) * gt.v[0] + (np[1] - gt.center[1]) * gt.v[1] + (np[2] - gt.center[2]) * gt.v[2];
            if (Math.abs(du) <= gt.w * 0.5 + 0.05 && Math.abs(dv) <= gt.h * 0.5 + 0.05) continue;
          }
          const push = d + p.radius;
          np[0] -= n[0] * push; np[1] -= n[1] * push; np[2] -= n[2] * push;
        }
      }
      const before = p.pos;
      p.pos = np;
      p.dist += V.dist(before, np);
      moved = true;
    }
    return p;
  }

  function walk(world, p, dt, speed) {
    if (p.ignoreT > 0) {
      p.ignoreT -= dt;
      if (p.ignoreT <= 0) p.ignore = null;
    }
    const dir = walkDir(p);
    const before = p.dist;
    step(world, p, dir, dt, speed);
    p.speed = (p.dist - before) / Math.max(dt, 1e-4);
    return p;
  }

  function upWorld(p) { return p.u; }
  function forwardWorld(p) { return p.f; }

  /* swap the texture names in the polygons for the generated images */
  function bindTextures(world, table) {
    let n = 0;
    for (const s of world.sectors) {
      for (const p of s.polys) {
        if (typeof p.tex === 'string') {
          p.tex = table[p.tex] || null;
          if (p.tex) n++;
        }
      }
      s.texTable = table;
    }
    return n;
  }

  IH.house = {
    bindTextures: bindTextures,
    build: build, player: player, walk: walk, step: step, look: look,
    faceDir: faceDir, walkDir: walkDir, turnBasis: turnBasis,
    upWorld: upWorld, forwardWorld: forwardWorld,
    EYE: EYE, fog: fog, door: door,
  };
})(typeof window !== 'undefined' ? window : globalThis);
