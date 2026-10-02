class Camera {
  constructor(position, target, up, fov, aperture, focalDist) {
    this.position = position;
    this.target = target;
    this.up = up;
    this.fov = fov;
    this.aperture = aperture;
    this.focalDist = focalDist;
    this.updateBasis();
  }
  updateBasis() {
    this.forward = this.target.sub(this.position).normalize();
    this.right = this.forward.cross(this.up).normalize();
    this.trueUp = this.right.cross(this.forward).normalize();
  }
  getRay(u, v, time = 0) {
    const theta = this.fov * Math.PI / 180;
    const h = Math.tan(theta / 2);
    const viewportHeight = 2 * h;
    const viewportWidth = viewportHeight * (u / v);
    const origin = this.position;
    const horizontal = this.right.scale(viewportWidth);
    const vertical = this.trueUp.scale(viewportHeight);
    const lowerLeft = origin.sub(horizontal.scale(0.5)).sub(vertical.scale(0.5)).sub(this.forward);
    let rayOrigin = origin;
    let rayDirection = lowerLeft.add(horizontal.scale(u)).add(vertical.scale(v)).sub(origin).normalize();
    if (this.aperture > 0) {
      const rd = Vec3.randomInUnitDisk().scale(this.aperture / 2);
      const offset = this.right.scale(rd.x).add(this.trueUp.scale(rd.y));
      rayOrigin = origin.add(offset);
      const focalPoint = origin.add(rayDirection.scale(this.focalDist / rayDirection.dot(this.forward)));
      rayDirection = focalPoint.sub(rayOrigin).normalize();
    }
    return new Ray(rayOrigin, rayDirection);
  }
  orbit(angle, pitch) {
    const offset = this.position.sub(this.target);
    const spherical = new Vec3(
      offset.length() * Math.cos(pitch) * Math.sin(angle),
      offset.length() * Math.sin(pitch),
      offset.length() * Math.cos(pitch) * Math.cos(angle)
    );
    this.position = this.target.add(spherical);
    this.updateBasis();
  }
  zoom(factor) {
    const offset = this.position.sub(this.target);
    const newLen = Math.max(0.1, offset.length() * factor);
    this.position = this.target.add(offset.normalize().scale(newLen));
    this.updateBasis();
  }
  pan(dx, dy) {
    const right = this.right;
    const up = this.trueUp;
    const panScale = this.position.sub(this.target).length() * 0.001;
    const delta = right.scale(-dx * panScale).add(up.scale(dy * panScale));
    this.position = this.position.add(delta);
    this.target = this.target.add(delta);
    this.updateBasis();
  }
}
