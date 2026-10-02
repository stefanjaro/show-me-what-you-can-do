function createObservatoryScene() {
  const scene = new Scene();
  const floorMat = new Lambertian(new Vec3(0.8, 0.8, 0.8));
  scene.add(new Plane(new Vec3(0, -1, 0), new Vec3(0, 1, 0), floorMat));
  const glassMat = new Dielectric(1.5);
  scene.add(new Sphere(new Vec3(0, 0.5, 0), 1.5, glassMat));
  const goldMat = new Metal(new Vec3(1, 0.7, 0.3), 0.1);
  scene.add(new Sphere(new Vec3(-3, 0, 2), 1, goldMat));
  const redMat = new Lambertian(new Vec3(0.8, 0.1, 0.1));
  scene.add(new Sphere(new Vec3(3, 0, 2), 1, redMat));
  const smallGlassMat = new Dielectric(1.5);
  scene.add(new Sphere(new Vec3(0, -0.5, 3), 0.5, smallGlassMat));
  const boxMat = new Dielectric(1.5);
  scene.add(new Box(new Vec3(-1, -1, -3), new Vec3(1, 1, -1), boxMat));
  const light1 = new DiffuseLight(new Vec3(1, 1, 1), 10);
  scene.add(new Sphere(new Vec3(-5, 5, 5), 0.5, light1));
  const light2 = new DiffuseLight(new Vec3(1, 0.8, 0.6), 8);
  scene.add(new Sphere(new Vec3(5, 5, 5), 0.5, light2));
  scene.setFog({ density: 0.02, color: new Vec3(0.1, 0.1, 0.15) });
  return scene;
}

function createGlassGardenScene() {
  const scene = new Scene();
  const floorMat = new Lambertian(new Vec3(0.9, 0.9, 0.9));
  scene.add(new Plane(new Vec3(0, -1, 0), new Vec3(0, 1, 0), floorMat));
  const glassMat = new Dielectric(1.5);
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const x = Math.cos(angle) * 3;
    const z = Math.sin(angle) * 3;
    scene.add(new Sphere(new Vec3(x, 0, z), 0.8, glassMat));
  }
  scene.add(new Sphere(new Vec3(0, 1, 0), 1.2, glassMat));
  const light = new DiffuseLight(new Vec3(1, 1, 1), 15);
  scene.add(new Sphere(new Vec3(0, 8, 0), 1, light));
  scene.setFog({ density: 0.01, color: new Vec3(0.05, 0.05, 0.1) });
  return scene;
}

function createMetalForgeScene() {
  const scene = new Scene();
  const floorMat = new Metal(new Vec3(0.5, 0.5, 0.5), 0.3);
  scene.add(new Plane(new Vec3(0, -1, 0), new Vec3(0, 1, 0), floorMat));
  const goldMat = new Metal(new Vec3(1, 0.7, 0.3), 0.05);
  const silverMat = new Metal(new Vec3(0.9, 0.9, 0.9), 0.1);
  const copperMat = new Metal(new Vec3(0.7, 0.4, 0.2), 0.15);
  scene.add(new Sphere(new Vec3(-2, 0, 0), 1, goldMat));
  scene.add(new Sphere(new Vec3(0, 0, 2), 1, silverMat));
  scene.add(new Sphere(new Vec3(2, 0, 0), 1, copperMat));
  scene.add(new Box(new Vec3(-1, -1, -3), new Vec3(1, 1, -1), goldMat));
  const light1 = new DiffuseLight(new Vec3(1, 0.9, 0.8), 12);
  scene.add(new Sphere(new Vec3(-5, 5, 5), 0.5, light1));
  const light2 = new DiffuseLight(new Vec3(0.8, 0.9, 1), 10);
  scene.add(new Sphere(new Vec3(5, 5, 5), 0.5, light2));
  return scene;
}

function createAbstractScene() {
  const scene = new Scene();
  const floorMat = new Lambertian(new Vec3(0.7, 0.7, 0.7));
  scene.add(new Plane(new Vec3(0, -1, 0), new Vec3(0, 1, 0), floorMat));
  const colors = [
    new Vec3(1, 0.2, 0.2),
    new Vec3(0.2, 1, 0.2),
    new Vec3(0.2, 0.2, 1),
    new Vec3(1, 1, 0.2),
    new Vec3(1, 0.2, 1),
    new Vec3(0.2, 1, 1)
  ];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const x = Math.cos(angle) * 4;
    const z = Math.sin(angle) * 4;
    const mat = new Lambertian(colors[i]);
    scene.add(new Sphere(new Vec3(x, 0, z), 1, mat));
  }
  const centerMat = new Metal(new Vec3(1, 1, 1), 0);
  scene.add(new Sphere(new Vec3(0, 1, 0), 1.5, centerMat));
  const light = new DiffuseLight(new Vec3(1, 1, 1), 20);
  scene.add(new Sphere(new Vec3(0, 10, 0), 1, light));
  return scene;
}

function createCausticsScene() {
  const scene = new Scene();
  const floorMat = new Lambertian(new Vec3(0.95, 0.95, 0.95));
  scene.add(new Plane(new Vec3(0, -1, 0), new Vec3(0, 1, 0), floorMat));
  const glassMat = new Dielectric(1.5);
  scene.add(new Sphere(new Vec3(0, 0, 0), 2, glassMat));
  scene.add(new Sphere(new Vec3(-2, -0.5, 2), 0.8, glassMat));
  scene.add(new Sphere(new Vec3(2, -0.5, 2), 0.8, glassMat));
  scene.add(new Sphere(new Vec3(0, -0.5, -2), 0.8, glassMat));
  const light = new DiffuseLight(new Vec3(1, 1, 1), 20);
  scene.add(new Sphere(new Vec3(0, 10, 0), 1, light));
  scene.setFog({ density: 0.005, color: new Vec3(0.02, 0.02, 0.05) });
  return scene;
}

function createMirrorRoomScene() {
  const scene = new Scene();
  const mirrorMat = new Metal(new Vec3(1, 1, 1), 0);
  scene.add(new Plane(new Vec3(0, -1, 0), new Vec3(0, 1, 0), mirrorMat));
  scene.add(new Plane(new Vec3(0, 5, 0), new Vec3(0, -1, 0), mirrorMat));
  scene.add(new Plane(new Vec3(-5, 0, 0), new Vec3(1, 0, 0), mirrorMat));
  scene.add(new Plane(new Vec3(5, 0, 0), new Vec3(-1, 0, 0), mirrorMat));
  scene.add(new Plane(new Vec3(0, 0, -5), new Vec3(0, 0, 1), mirrorMat));
  scene.add(new Plane(new Vec3(0, 0, 5), new Vec3(0, 0, -1), mirrorMat));
  const glassMat = new Dielectric(1.5);
  scene.add(new Sphere(new Vec3(0, 0, 0), 1.5, glassMat));
  const light = new DiffuseLight(new Vec3(1, 1, 1), 15);
  scene.add(new Sphere(new Vec3(0, 4, 0), 0.5, light));
  return scene;
}

function createNeonCityScene() {
  const scene = new Scene();
  const floorMat = new Lambertian(new Vec3(0.1, 0.1, 0.15));
  scene.add(new Plane(new Vec3(0, -1, 0), new Vec3(0, 1, 0), floorMat));
  const neonColors = [
    new Vec3(1, 0, 0.5),
    new Vec3(0, 1, 0.5),
    new Vec3(0.5, 0, 1),
    new Vec3(1, 0.5, 0),
    new Vec3(0, 1, 1),
    new Vec3(1, 0, 1)
  ];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const x = Math.cos(angle) * 4;
    const z = Math.sin(angle) * 4;
    const mat = new Emissive(neonColors[i], 5);
    scene.add(new Box(new Vec3(x - 0.3, -1, z - 0.3), new Vec3(x + 0.3, 2, z + 0.3), mat));
  }
  const centerMat = new Metal(new Vec3(0.8, 0.8, 0.9), 0.1);
  scene.add(new Sphere(new Vec3(0, 1, 0), 1, centerMat));
  const light = new DiffuseLight(new Vec3(0.5, 0.5, 0.6), 5);
  scene.add(new Sphere(new Vec3(0, 8, 0), 1, light));
  scene.setFog({ density: 0.03, color: new Vec3(0.05, 0.05, 0.1) });
  return scene;
}

const scenes = {
  observatory: { name: 'The Observatory', create: createObservatoryScene },
  glassGarden: { name: 'Glass Garden', create: createGlassGardenScene },
  metalForge: { name: 'Metal Forge', create: createMetalForgeScene },
  abstract: { name: 'Abstract', create: createAbstractScene },
  caustics: { name: 'Caustics', create: createCausticsScene },
  mirrorRoom: { name: 'Mirror Room', create: createMirrorRoomScene },
  neonCity: { name: 'Neon City', create: createNeonCityScene }
};
