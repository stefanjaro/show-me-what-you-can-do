class Ray {
  constructor(origin, direction) {
    this.origin = origin;
    this.direction = direction;
  }
  at(t) { return this.origin.add(this.direction.scale(t)); }
}

class HitRecord {
  constructor() {
    this.point = new Vec3();
    this.normal = new Vec3();
    this.t = 0;
    this.frontFace = false;
    this.material = null;
  }
  setFaceNormal(ray, outwardNormal) {
    this.frontFace = ray.direction.dot(outwardNormal) < 0;
    this.normal = this.frontFace ? outwardNormal : outwardNormal.negate();
  }
}

class Hittable {
  hit(ray, tMin, tMax) { return null; }
}

class Sphere extends Hittable {
  constructor(center, radius, material) {
    super();
    this.center = center;
    this.radius = radius;
    this.material = material;
  }
  hit(ray, tMin, tMax) {
    const oc = ray.origin.sub(this.center);
    const a = ray.direction.lengthSquared();
    const halfB = oc.dot(ray.direction);
    const c = oc.lengthSquared() - this.radius * this.radius;
    const discriminant = halfB * halfB - a * c;
    if (discriminant < 0) return null;
    const sqrtd = Math.sqrt(discriminant);
    let root = (-halfB - sqrtd) / a;
    if (root < tMin || root > tMax) {
      root = (-halfB + sqrtd) / a;
      if (root < tMin || root > tMax) return null;
    }
    const rec = new HitRecord();
    rec.t = root;
    rec.point = ray.at(root);
    const outwardNormal = rec.point.sub(this.center).scale(1 / this.radius);
    rec.setFaceNormal(ray, outwardNormal);
    rec.material = this.material;
    return rec;
  }
}

class Box extends Hittable {
  constructor(min, max, material) {
    super();
    this.min = min;
    this.max = max;
    this.material = material;
  }
  hit(ray, tMin, tMax) {
    let t0 = tMin;
    let t1 = tMax;
    for (let i = 0; i < 3; i++) {
      const invD = 1 / ray.direction.toArray()[i];
      let near = (this.min.toArray()[i] - ray.origin.toArray()[i]) * invD;
      let far = (this.max.toArray()[i] - ray.origin.toArray()[i]) * invD;
      if (invD < 0) [near, far] = [far, near];
      t0 = Math.max(t0, near);
      t1 = Math.min(t1, far);
      if (t1 <= t0) return null;
    }
    const rec = new HitRecord();
    rec.t = t0;
    rec.point = ray.at(t0);
    const center = this.min.add(this.max).scale(0.5);
    const size = this.max.sub(this.min).scale(0.5);
    const p = new Vec3(
      (rec.point.x - center.x) / size.x,
      (rec.point.y - center.y) / size.y,
      (rec.point.z - center.z) / size.z
    );
    const absP = new Vec3(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
    let normal;
    if (absP.x > absP.y && absP.x > absP.z) {
      normal = new Vec3(Math.sign(p.x), 0, 0);
    } else if (absP.y > absP.z) {
      normal = new Vec3(0, Math.sign(p.y), 0);
    } else {
      normal = new Vec3(0, 0, Math.sign(p.z));
    }
    rec.setFaceNormal(ray, normal);
    rec.material = this.material;
    return rec;
  }
}

class Plane extends Hittable {
  constructor(point, normal, material) {
    super();
    this.point = point;
    this.normal = normal.normalize();
    this.material = material;
  }
  hit(ray, tMin, tMax) {
    const denom = ray.direction.dot(this.normal);
    if (Math.abs(denom) < 1e-8) return null;
    const t = this.point.sub(ray.origin).dot(this.normal) / denom;
    if (t < tMin || t > tMax) return null;
    const rec = new HitRecord();
    rec.t = t;
    rec.point = ray.at(t);
    rec.setFaceNormal(ray, this.normal);
    rec.material = this.material;
    return rec;
  }
}

class Scene {
  constructor() {
    this.objects = [];
    this.lights = [];
    this.fog = null;
  }
  add(obj) { this.objects.push(obj); }
  addLight(light) { this.lights.push(light); }
  setFog(fog) { this.fog = fog; }
  hit(ray, tMin, tMax) {
    let closest = null;
    let closestT = tMax;
    for (const obj of this.objects) {
      const rec = obj.hit(ray, tMin, closestT);
      if (rec) {
        closest = rec;
        closestT = rec.t;
      }
    }
    return closest;
  }
}
