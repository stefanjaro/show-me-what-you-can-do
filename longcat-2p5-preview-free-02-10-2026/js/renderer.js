class Renderer {
  constructor() {
    this.maxDepth = 8;
    this.samplesPerPixel = 1;
  }
  render(scene, camera, width, height, startRow, endRow, samples, seed) {
    const data = new Float32Array((endRow - startRow) * width * 3);
    let idx = 0;
    for (let j = startRow; j < endRow; j++) {
      for (let i = 0; i < width; i++) {
        let color = new Vec3(0, 0, 0);
        for (let s = 0; s < samples; s++) {
          const u = (i + Math.random()) / width;
          const v = (j + Math.random()) / height;
          const time = Math.random();
          const ray = camera.getRay(u, v, time);
          color = color.add(this.rayColor(ray, scene, this.maxDepth));
        }
        color = color.scale(1 / samples);
        data[idx++] = color.x;
        data[idx++] = color.y;
        data[idx++] = color.z;
      }
    }
    return data;
  }
  rayColor(ray, scene, depth) {
    if (depth <= 0) return new Vec3(0, 0, 0);
    const hit = scene.hit(ray, 0.001, Infinity);
    if (hit) {
      const emitted = hit.material.emitted ? hit.material.emitted(hit) : null;
      const scatterResult = hit.material.scatter(ray, hit, Math.random);
      if (scatterResult) {
        const indirect = this.rayColor(scatterResult.scattered, scene, depth - 1);
        const color = indirect.mul(scatterResult.attenuation);
        return emitted ? color.add(emitted) : color;
      }
      return emitted || new Vec3(0, 0, 0);
    }
    if (scene.fog) {
      const fogColor = scene.fog.color;
      const fogDensity = scene.fog.density;
      const t = -Math.log(1 - Math.random()) / fogDensity;
      const fogPoint = ray.at(t);
      const fogHit = scene.hit(ray, 0.001, t);
      if (fogHit) {
        const fogEmitted = fogHit.material.emitted ? fogHit.material.emitted(fogHit) : null;
        const fogScatter = fogHit.material.scatter(ray, fogHit, Math.random);
        if (fogScatter) {
          const fogIndirect = this.rayColor(fogScatter.scattered, scene, depth - 1);
          const fogCol = fogIndirect.mul(fogScatter.attenuation);
          const finalColor = fogEmitted ? fogCol.add(fogEmitted) : fogCol;
          const transmittance = Math.exp(-fogDensity * t);
          return finalColor.scale(transmittance).add(fogColor.scale(1 - transmittance));
        }
        return fogEmitted ? fogEmitted : fogColor;
      }
      const transmittance = Math.exp(-fogDensity * t);
      const skyColor = this.skyColor(ray);
      return skyColor.scale(transmittance).add(fogColor.scale(1 - transmittance));
    }
    return this.skyColor(ray);
  }
  skyColor(ray) {
    const t = 0.5 * (ray.direction.normalize().y + 1);
    return Vec3.lerp(new Vec3(1, 1, 1), new Vec3(0.5, 0.7, 1), t);
  }
}
