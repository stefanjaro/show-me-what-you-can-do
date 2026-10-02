importScripts('vec3.js', 'material.js', 'hittable.js', 'camera.js', 'renderer.js', 'sceneBuilder.js');

self.onmessage = function(e) {
  const { sceneData, cameraData, width, height, startRow, endRow, samples, maxDepth, seed } = e.data;
  const scene = buildSceneFromData(sceneData);
  const camera = new Camera(
    Vec3.fromArray(cameraData.position),
    Vec3.fromArray(cameraData.target),
    Vec3.fromArray(cameraData.up),
    cameraData.fov,
    cameraData.aperture,
    cameraData.focalDist
  );
  const renderer = new Renderer();
  renderer.maxDepth = maxDepth;
  const data = renderer.render(scene, camera, width, height, startRow, endRow, samples, seed);
  self.postMessage({
    type: 'result',
    startRow,
    endRow,
    data: data.buffer,
    samples,
    renderId
  }, [data.buffer]);
};
