class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  add(v) { return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v) { return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z); }
  scale(s) { return new Vec3(this.x * s, this.y * s, this.z * s); }
  mul(v) { return new Vec3(this.x * v.x, this.y * v.y, this.z * v.z); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) {
    return new Vec3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }
  length() { return Math.sqrt(this.dot(this)); }
  lengthSquared() { return this.dot(this); }
  normalize() {
    const l = this.length();
    return l > 0 ? this.scale(1 / l) : new Vec3();
  }
  reflect(n) { return this.sub(n.scale(2 * this.dot(n))); }
  refract(n, eta) {
    const cosTheta = Math.min(-this.dot(n), 1);
    const rOutPerp = this.add(n.scale(cosTheta)).scale(eta);
    const rOutParallel = n.scale(-Math.sqrt(Math.abs(1 - rOutPerp.lengthSquared())));
    return rOutPerp.add(rOutParallel);
  }
  negate() { return new Vec3(-this.x, -this.y, -this.z); }
  clone() { return new Vec3(this.x, this.y, this.z); }
  static random() { return new Vec3(Math.random(), Math.random(), Math.random()); }
  static randomInUnitSphere() {
    while (true) {
      const p = new Vec3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (p.lengthSquared() < 1) return p;
    }
  }
  static randomUnitVector() { return Vec3.randomInUnitSphere().normalize(); }
  static randomInHemisphere(normal) {
    const v = Vec3.randomUnitVector();
    return v.dot(normal) > 0 ? v : v.scale(-1);
  }
  static randomInUnitDisk() {
    while (true) {
      const p = new Vec3(Math.random() * 2 - 1, Math.random() * 2 - 1, 0);
      if (p.lengthSquared() < 1) return p;
    }
  }
  static lerp(a, b, t) { return a.scale(1 - t).add(b.scale(t)); }
  static min(a, b) { return new Vec3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)); }
  static max(a, b) { return new Vec3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)); }
  static fromArray(a) { return new Vec3(a[0], a[1], a[2]); }
  toArray() { return [this.x, this.y, this.z]; }
}
