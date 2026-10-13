/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPOSSIBLE HOUSE — mathx.js
   Vectors, 4x4 matrices, camera poses, view-volume planes, convex polygon
   clipping, and the gate-frame algebra that makes portals possible.
   Everything is plain JS and allocation-light where it matters.
   ═════════════════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  const IH = (g.IH = g.IH || {});

  /* ───────────────────────────── vectors ──────────────────────────────── */
  const V = {
    make: (x, y, z) => [x || 0, y || 0, z || 0],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ],
    len: (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
    dist: (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2),
    norm: (a) => {
      const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    },
    lerp: (a, b, t) => [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ],
    /* orthonormal basis looking along dir with the given world-up reference */
    basis: (dir, upRef) => {
      const f = V.norm(dir);
      let r = V.cross(f, upRef || [0, 1, 0]);
      if (V.len(r) < 1e-4) r = V.cross(f, [0, 0, 1]);
      r = V.norm(r);
      const u = V.cross(r, f);
      return { r: r, u: u, f: f };
    },
  };

  /* ───────────────────────────── matrices ─────────────────────────────── */
  /* Row-major 4x4. m[r*4+c].                                            */
  const M = {
    identity: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],

    mul: (a, b) => {
      const o = new Array(16);
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++) {
          let s = 0;
          for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
          o[r * 4 + c] = s;
        }
      return o;
    },

    fromPose: (pos, basis) => [
      basis.r[0], basis.r[1], basis.r[2], 0,
      basis.u[0], basis.u[1], basis.u[2], 0,
      basis.f[0], basis.f[1], basis.f[2], 0,
      pos[0], pos[1], pos[2], 1,
    ],

    mulPoint: (m, p) => [
      m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
      m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
      m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
      m[12] * p[0] + m[13] * p[1] + m[14] * p[2] + m[15],
    ],

    mulDir: (m, v) => [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
      m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
    ],

    invert: (m) => {
      const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
      const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
      const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
      const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
      const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
      const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
      const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
      const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return M.identity();
      det = 1 / det;
      return [
        (a11 * b11 - a12 * b10 + a13 * b09) * det,
        (a02 * b10 - a01 * b11 - a03 * b09) * det,
        (a31 * b05 - a32 * b04 + a33 * b03) * det,
        (a22 * b04 - a21 * b05 - a23 * b03) * det,
        (a12 * b08 - a10 * b11 - a13 * b07) * det,
        (a00 * b11 - a02 * b08 + a03 * b07) * det,
        (a32 * b07 - a30 * b05 - a33 * b02) * det,
        (a20 * b05 - a22 * b07 + a23 * b02) * det,
        (a10 * b10 - a11 * b08 + a13 * b06) * det,
        (a01 * b08 - a00 * b10 - a03 * b06) * det,
        (a30 * b04 - a31 * b03 + a33 * b01) * det,
        (a21 * b03 - a20 * b04 - a23 * b01) * det,
        (a11 * b07 - a10 * b09 - a12 * b06) * det,
        (a00 * b09 - a01 * b07 + a02 * b06) * det,
        (a31 * b02 - a30 * b03 - a32 * b01) * det,
        (a20 * b03 - a21 * b02 + a22 * b01) * det,
      ];
    },

    rotateY: (rad) => {
      const c = Math.cos(rad), s = Math.sin(rad);
      return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
    },
  };

  /* ───────────────────────────── camera ───────────────────────────────── */
  /* A pose: worldFromCamera. Orthonormal basis r,u,f plus a position.     */
  function pose(pos, right, up, forward) {
    return { p: [pos[0], pos[1], pos[2]], r: right, u: up, f: forward };
  }
  /* Apply a rigid transform {R (3x3 rows), t} to a pose. */
  function poseApply(xf, ph) {
    const R = xf.R, t = xf.t;
    return {
      p: [R[0] * ph.p[0] + R[1] * ph.p[1] + R[2] * ph.p[2] + t[0],
          R[3] * ph.p[0] + R[4] * ph.p[1] + R[5] * ph.p[2] + t[1],
          R[6] * ph.p[0] + R[7] * ph.p[1] + R[8] * ph.p[2] + t[2]],
      r: [R[0] * ph.r[0] + R[1] * ph.r[1] + R[2] * ph.r[2],
          R[3] * ph.r[0] + R[4] * ph.r[1] + R[5] * ph.r[2],
          R[6] * ph.r[0] + R[7] * ph.r[1] + R[8] * ph.r[2]],
      u: [R[0] * ph.u[0] + R[1] * ph.u[1] + R[2] * ph.u[2],
          R[3] * ph.u[0] + R[4] * ph.u[1] + R[5] * ph.u[2],
          R[6] * ph.u[0] + R[7] * ph.u[1] + R[8] * ph.u[2]],
      f: [R[0] * ph.f[0] + R[1] * ph.f[1] + R[2] * ph.f[2],
          R[3] * ph.f[0] + R[4] * ph.f[1] + R[5] * ph.f[2],
          R[6] * ph.f[0] + R[7] * ph.f[1] + R[8] * ph.f[2]],
    };
  }
  function pointApply(xf, p) {
    const R = xf.R, t = xf.t;
    return [R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + t[0],
            R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + t[1],
            R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + t[2]];
  }
  function dirApply(xf, d) {
    const R = xf.R;
    return [R[0] * d[0] + R[1] * d[1] + R[2] * d[2],
            R[3] * d[0] + R[4] * d[1] + R[5] * d[2],
            R[6] * d[0] + R[7] * d[1] + R[8] * d[2]];
  }
  function xfMul(a, b) { /* a ∘ b  (apply b first) */
    return { R: mat3MulRows(a.R, b.R), t: vecAdd(mat3MulVec(a.R, b.t), a.t) };
  }
  function mat3MulRows(a, b) {
    const o = new Array(9);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    return o;
  }
  function mat3MulVec(a, v) {
    return [a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
            a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
            a[6] * v[0] + a[7] * v[1] + a[8] * v[2]];
  }
  const vecAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const vecSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vecScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

  /* ──────────────────────────── rotX ───────────────────────────────────── */
  function rotX(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return [1, 0, 0, 0, c, -s, 0, s, c];
  }
  function rotY(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return [c, 0, s, 0, 1, 0, -s, 0, c];
  }
  function rotZ(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return [c, -s, 0, s, c, 0, 0, 0, 1];
  }
  /* R2 * R1 */
  function mat3Mul(a, b) {
    const o = new Array(9);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
        o[r * 3 + c] = s;
      }
    return o;
  }

  /* ─────────────────────────────── planes ────────────────────────────── */
  /* A plane is stored as a flat 4-tuple [nx,ny,nz,d]; inside means
     n·p + d >= 0.  */
  function planeFromNormal(n, dist) { return [n[0], n[1], n[2], dist]; }

  /* Plane through three points, oriented so that `ref` is on the inside. */
  function planeFromTri(a, b, c, ref) {
    let n = V.cross(V.sub(b, a), V.sub(c, a));
    const l = V.len(n) || 1;
    n = [n[0] / l, n[1] / l, n[2] / l];
    let d = -(n[0] * a[0] + n[1] * a[1] + n[2] * a[2]);
    if (ref && n[0] * ref[0] + n[1] * ref[1] + n[2] * ref[2] + d < 0) {
      n = [-n[0], -n[1], -n[2]];
      d = -d;
    }
    return [n[0], n[1], n[2], d];
  }

  function planeDist(pl, p) {
    return pl[0] * p[0] + pl[1] * p[1] + pl[2] * p[2] + pl[3];
  }

  /* ────────────────────────── polygon clipping ───────────────────────── */
  /* Sutherland–Hodgman against a list of planes. `out` receives the
     surviving vertices (by reference); returns the vertex count.          */
  const _pool = [];
  for (let i = 0; i < 4096; i++) _pool.push([0, 0, 0]);
  let _poolTop = 0;
  const scratch = [];
  const clipBuf = [];

  function clipPoly(pts, n, planes, out, pcount) {
    let count = n;
    if (count === 0) return 0;
    _poolTop = 0;
    scratch.length = 0;
    for (let i = 0; i < count; i++) scratch.push(pts[i]);
    for (let pi = 0; pi < pcount && count > 0; pi++) {
      const pl = planes[pi];
      const nx = pl[0], ny = pl[1], nz = pl[2], d = pl[3];
      let prev = scratch[count - 1];
      let pv = nx * prev[0] + ny * prev[1] + nz * prev[2] + d;
      clipBuf.length = 0;
      for (let i = 0; i < count; i++) {
        const p = scratch[i];
        const v = nx * p[0] + ny * p[1] + nz * p[2] + d;
        if (v >= 0) {
          if (pv < 0) {
            const t = pv / (pv - v);
            const s = _pool[_poolTop++];
            s[0] = prev[0] + (p[0] - prev[0]) * t;
            s[1] = prev[1] + (p[1] - prev[1]) * t;
            s[2] = prev[2] + (p[2] - prev[2]) * t;
            clipBuf.push(s);
          }
          clipBuf.push(p);
        } else if (pv >= 0) {
          const t = pv / (pv - v);
          const s = _pool[_poolTop++];
          s[0] = prev[0] + (p[0] - prev[0]) * t;
          s[1] = prev[1] + (p[1] - prev[1]) * t;
          s[2] = prev[2] + (p[2] - prev[2]) * t;
          clipBuf.push(s);
        }
        prev = p; pv = v;
      }
      scratch.length = 0;
      for (let i = 0; i < clipBuf.length; i++) scratch.push(clipBuf[i]);
      count = scratch.length;
    }
    for (let i = 0; i < count && i < out.length; i++) out[i] = scratch[i];
    return count;
  }

  /* ────────────────────────────── frustum ─────────────────────────────── */
  /* Builds the world-space planes of a camera's view volume. FOV given in
     radians (vertical). `planes` receives: near, far, left, right, top,
     bottom (order is irrelevant to the clipper).                          */
  function frustumPlanes(cam, near, far, fovY, aspect, planes) {
    const F = cam.f, R = cam.r, U = cam.u, c = cam.p;
    const sy = Math.tan(fovY * 0.5);
    const sx = sy * aspect;
    planes.length = 0;
    /* near / far */
    planes.push([F[0], F[1], F[2], -(F[0] * (c[0] + F[0] * near) + F[1] * (c[1] + F[1] * near) + F[2] * (c[2] + F[2] * near))]);
    planes.push([-F[0], -F[1], -F[2], (F[0] * (c[0] + F[0] * far) + F[1] * (c[1] + F[1] * far) + F[2] * (c[2] + F[2] * far))]);
    /* side planes: n = sin(a)*F - cos(a)*Side */
    function side(axis, a, sign) {
      const s = Math.sin(a), co = Math.cos(a);
      const n = [s * F[0] - co * axis[0] * sign, s * F[1] - co * axis[1] * sign, s * F[2] - co * axis[2] * sign];
      const d = -(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]);
      planes.push([n[0], n[1], n[2], d]);
    }
    side(R, Math.atan(sx), 1);
    side(R, Math.atan(sx), -1);
    side(U, Math.atan(sy), 1);
    side(U, Math.atan(sy), -1);
    return planes;
  }

  /* Pyramid of planes from a point to a convex quad (used for portal
     windows). The quad must be wound consistently.                        */
  function conePlanes(camPos, quad, planes) {
    for (let i = 0; i < quad.length; i++) {
      const a = quad[i], b = quad[(i + 1) % quad.length];
      /* ref = half-way along the next edge, guaranteed inside the cone */
      const ref = quad[(i + 2) % quad.length];
      planes.push(planeFromTri(camPos, a, b, ref));
    }
  }

  /* ─────────────────── gate frames & portal transforms ────────────────── */
  /* A gate is a rectangular window in a wall. We derive an orthonormal
     frame (origin o, axes u (width), v (height), n (outward)) from its four
     corners, which must be wound counter-clockwise when viewed from the
     OUTSIDE of the room (i.e. the side the normal points to).             */
  function gateFrame(corners) {
    const p0 = corners[0], p1 = corners[1], p3 = corners[3];
    const u = V.norm(V.sub(p1, p0));
    const v = V.norm(V.sub(p3, p0));
    let n = V.cross(u, v);
    if (V.len(n) < 1e-6) n = V.cross(u, [0, 0, 1]);
    n = V.norm(n);
    return { o: p0, u: u, v: v, n: n, w: V.dist(p0, p1), h: V.dist(p0, p3) };
  }

  function frameMatrix(fr) {
    /* columns = u, v, n ; translation = origin */
    return [fr.u[0], fr.v[0], fr.n[0], fr.o[0],
            fr.u[1], fr.v[1], fr.n[1], fr.o[1],
            fr.u[2], fr.v[2], fr.n[2], fr.o[2]];
  }

  /* Rigid transform that carries gate A onto gate B and maps "out of A"
     onto "into B".  Orientation preserving (a proper rotation), so walking
     through a door leaves your handedness alone:
        X = [-uB | vB | -nB] · [uA | vA | nA]^T ,  t = oB - R·oA
     For two gates that lie back-to-back on the same wall this is exactly the
     identity, which is what a plain doorway must be.                       */
  function gateTransform(A, B) {
    const ua = A.u, va = A.v, na = A.n;
    const ub = B.u, vb = B.v, nb = B.n;
    const colA = [ua, va, na];
    const colB = [vecScale(ub, -1), vb, vecScale(nb, -1)];
    const R = new Array(9);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        R[r * 3 + c] = colB[r][0] * colA[c][0] + colB[r][1] * colA[c][1] + colB[r][2] * colA[c][2];
      }
    }
    /* the gluing carries the centre of one gate onto the centre of the
       other; the in-plane offsets follow the axes                      */
    const t = vecSub(gateCentre(B), mat3MulVec(R, gateCentre(A)));
    return { R: R, t: t };
  }

  function gateCentre(f) {
    return [f.o[0] + f.u[0] * f.w * 0.5 + f.v[0] * f.h * 0.5,
            f.o[1] + f.u[1] * f.w * 0.5 + f.v[1] * f.h * 0.5,
            f.o[2] + f.u[2] * f.w * 0.5 + f.v[2] * f.h * 0.5];
  }

  /* In place of a fixed gluing, apply an extra rigid twist about the target
     gate's own frame: yaw about its vertical, roll about its normal.       */
  function gateTwist(B, yaw, roll) {
    yaw = yaw || 0; roll = roll || 0;
    if (!yaw && !roll) return null;
    const Ry = rot3(yaw, B.v);
    const Rr = rot3(roll, B.n);
    const R = mat3MulRows(Ry, Rr);
    const c = gateCentre(B);
    const t = vecSub(c, mat3MulVec(R, c));
    return { R: R, t: t };
  }
  function rot3(rad, axis) {
    const c = Math.cos(rad), s = Math.sin(rad);
    const x = axis[0], y = axis[1], z = axis[2];
    return [
      c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s,
      y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s,
      z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c),
    ];
  }

  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  IH.Math = {
    V: V, M: M, pose: pose, poseApply: poseApply, pointApply: pointApply,
    dirApply: dirApply, xfMul: xfMul, mat3Mul: mat3Mul, mat3MulVec: mat3MulVec,
    rotX: rotX, rotY: rotY, rotZ: rotZ,
    vecAdd: vecAdd, vecSub: vecSub, vecScale: vecScale,
    planeFromNormal: planeFromNormal, planeFromTri: planeFromTri, planeDist: planeDist,
    clipPoly: clipPoly, frustumPlanes: frustumPlanes, conePlanes: conePlanes,
    gateFrame: gateFrame, gateTransform: gateTransform, gateTwist: gateTwist, gateCentre: gateCentre,
    frameMatrix: frameMatrix,
    TAU: TAU, DEG: DEG,
  };
  return IH.Math;
})(typeof window !== 'undefined' ? window : globalThis);
