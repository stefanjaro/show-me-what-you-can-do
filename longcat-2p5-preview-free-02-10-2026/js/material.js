class Material {
  constructor(type, params = {}) {
    this.type = type;
    this.params = params;
  }
  scatter(ray, hit, rng) { return null; }
  emitted(hit) { return null; }
}

class Lambertian extends Material {
  constructor(albedo) {
    super('lambertian', { albedo });
  }
  scatter(ray, hit, rng) {
    let scatterDirection = hit.normal.add(Vec3.randomUnitVector());
    if (scatterDirection.lengthSquared() < 1e-8) {
      scatterDirection = hit.normal;
    }
    return {
      scattered: new Ray(hit.point, scatterDirection),
      attenuation: this.params.albedo
    };
  }
}

class Metal extends Material {
  constructor(albedo, fuzz = 0) {
    super('metal', { albedo, fuzz });
  }
  scatter(ray, hit, rng) {
    const reflected = ray.direction.normalize().reflect(hit.normal);
    const fuzz = this.params.fuzz || 0;
    const scattered = reflected.add(Vec3.randomInUnitSphere().scale(fuzz));
    if (scattered.dot(hit.normal) > 0) {
      return {
        scattered: new Ray(hit.point, scattered),
        attenuation: this.params.albedo
      };
    }
    return null;
  }
}

class Dielectric extends Material {
  constructor(ior) {
    super('dielectric', { ior });
  }
  scatter(ray, hit, rng) {
    const refractionRatio = hit.frontFace ? 1 / this.params.ior : this.params.ior;
    const unitDirection = ray.direction.normalize();
    const cosTheta = Math.min(-unitDirection.dot(hit.normal), 1);
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
    const cannotRefract = refractionRatio * sinTheta > 1;
    let direction;
    if (cannotRefract || this.reflectance(cosTheta, refractionRatio) > Math.random()) {
      direction = unitDirection.reflect(hit.normal);
    } else {
      direction = unitDirection.refract(hit.normal, refractionRatio);
    }
    return {
      scattered: new Ray(hit.point, direction),
      attenuation: new Vec3(1, 1, 1)
    };
  }
  reflectance(cosine, refIdx) {
    let r0 = (1 - refIdx) / (1 + refIdx);
    r0 = r0 * r0;
    return r0 + (1 - r0) * Math.pow(1 - cosine, 5);
  }
}

class Emissive extends Material {
  constructor(color, intensity = 1) {
    super('emissive', { color, intensity });
  }
  emitted(hit) {
    return this.params.color.scale(this.params.intensity);
  }
  scatter(ray, hit, rng) { return null; }
}

class DiffuseLight extends Material {
  constructor(color, intensity = 1) {
    super('diffuseLight', { color, intensity });
  }
  emitted(hit) {
    return this.params.color.scale(this.params.intensity);
  }
  scatter(ray, hit, rng) { return null; }
}
