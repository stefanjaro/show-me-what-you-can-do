function buildSceneFromData(data) {
  const scene = new Scene();
  for (const obj of data.objects) {
    let material;
    switch (obj.material.type) {
      case 'lambertian':
        material = new Lambertian(Vec3.fromArray(obj.material.albedo));
        break;
      case 'metal':
        material = new Metal(Vec3.fromArray(obj.material.albedo), obj.material.fuzz);
        break;
      case 'dielectric':
        material = new Dielectric(obj.material.ior);
        break;
      case 'emissive':
        material = new Emissive(Vec3.fromArray(obj.material.color), obj.material.intensity);
        break;
      case 'diffuseLight':
        material = new DiffuseLight(Vec3.fromArray(obj.material.color), obj.material.intensity);
        break;
    }
    switch (obj.type) {
      case 'sphere':
        scene.add(new Sphere(Vec3.fromArray(obj.center), obj.radius, material));
        break;
      case 'box':
        scene.add(new Box(Vec3.fromArray(obj.min), Vec3.fromArray(obj.max), material));
        break;
      case 'plane':
        scene.add(new Plane(Vec3.fromArray(obj.point), Vec3.fromArray(obj.normal), material));
        break;
    }
  }
  if (data.fog) {
    scene.setFog({
      density: data.fog.density,
      color: Vec3.fromArray(data.fog.color)
    });
  }
  return scene;
}

function sceneToData(scene) {
  const data = { objects: [], fog: null };
  for (const obj of scene.objects) {
    const objData = { type: obj.constructor.name.toLowerCase() };
    if (obj.center) {
      objData.center = obj.center.toArray();
      objData.radius = obj.radius;
    }
    if (obj.min) {
      objData.min = obj.min.toArray();
      objData.max = obj.max.toArray();
    }
    if (obj.point) {
      objData.point = obj.point.toArray();
      objData.normal = obj.normal.toArray();
    }
    objData.material = { type: obj.material.type, ...obj.material.params };
    if (obj.material.params.albedo) {
      objData.material.albedo = obj.material.params.albedo.toArray();
    }
    if (obj.material.params.color) {
      objData.material.color = obj.material.params.color.toArray();
    }
    data.objects.push(objData);
  }
  if (scene.fog) {
    data.fog = {
      density: scene.fog.density,
      color: scene.fog.color.toArray()
    };
  }
  return data;
}
