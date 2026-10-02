class App {
  constructor() {
    this.canvas = document.getElementById('render-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.overlay = document.getElementById('canvas-overlay');
    this.workers = [];
    this.numWorkers = navigator.hardwareConcurrency || 4;
    this.currentScene = 'observatory';
    this.camera = null;
    this.isRendering = false;
    this.renderId = 0;
    this.totalSamples = 0;
    this.totalRays = 0;
    this.renderTime = 0;
    this.accumulatedData = null;
    this.accumulatedSamples = 0;
    this.isDragging = false;
    this.lastMouse = { x: 0, y: 0 };
    this.autoRotate = true;
    this.autoRotateSpeed = 0.002;
    this.progressiveMode = false;
    this.progressiveSamplesPerFrame = 1;
    this.postProcessor = new PostProcessor();
    this.isAnimating = false;
    this.animationFrames = [];
    this.maxAnimationFrames = 300;
    this.init();
  }

  init() {
    this.setupWorkers();
    this.setupEventListeners();
    this.setupCamera();
    this.resize();
    this.startRenderLoop();
  }

  setupWorkers() {
    for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker('js/worker.js');
      worker.onmessage = (e) => this.handleWorkerMessage(e, worker);
      this.workers.push({ worker, busy: false });
    }
  }

  setupEventListeners() {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this.onMouseUp());
    this.canvas.addEventListener('mouseleave', () => this.onMouseUp());
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.getElementById('scene-buttons').addEventListener('click', (e) => {
      if (e.target.classList.contains('scene-btn')) {
        this.switchScene(e.target.dataset.scene);
      }
    });

    document.getElementById('samples').addEventListener('input', (e) => {
      document.getElementById('samples-value').textContent = e.target.value;
      this.reRender();
    });

    document.getElementById('max-depth').addEventListener('input', (e) => {
      document.getElementById('max-depth-value').textContent = e.target.value;
      this.reRender();
    });

    document.getElementById('resolution').addEventListener('change', (e) => {
      this.resize();
      this.reRender();
    });

    document.getElementById('fov').addEventListener('input', (e) => {
      document.getElementById('fov-value').textContent = e.target.value + '°';
      this.updateCamera();
    });

    document.getElementById('aperture').addEventListener('input', (e) => {
      const f = Math.round(100 / (parseFloat(e.target.value) + 1));
      document.getElementById('aperture-value').textContent = 'f/' + f;
      this.updateCamera();
    });

    document.getElementById('focal-dist').addEventListener('input', (e) => {
      document.getElementById('focal-dist-value').textContent = parseFloat(e.target.value).toFixed(1);
      this.updateCamera();
    });

    document.getElementById('btn-re-render').addEventListener('click', () => this.reRender());
    document.getElementById('btn-export').addEventListener('click', () => this.exportImage());
    document.getElementById('btn-reset').addEventListener('click', () => this.reset());
    document.getElementById('btn-progressive').addEventListener('click', () => this.toggleProgressive());
    document.getElementById('btn-animate').addEventListener('click', () => {
      if (this.isAnimating) {
        this.stopAnimation();
      } else {
        this.startAnimation();
      }
    });

    document.getElementById('bloom').addEventListener('change', (e) => {
      this.postProcessor.bloomEnabled = e.target.checked;
      this.updateDisplay();
    });
    document.getElementById('vignette').addEventListener('change', (e) => {
      this.postProcessor.vignetteEnabled = e.target.checked;
      this.updateDisplay();
    });
    document.getElementById('chromatic').addEventListener('change', (e) => {
      this.postProcessor.chromaticAberrationEnabled = e.target.checked;
      this.updateDisplay();
    });

    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => this.applyPreset(btn.dataset.preset));
    });
  }

  setupCamera() {
    this.camera = new Camera(
      new Vec3(8, 5, 8),
      new Vec3(0, 0, 0),
      new Vec3(0, 1, 0),
      60,
      0,
      5
    );
  }

  resize() {
    const resSelect = document.getElementById('resolution');
    const [w, h] = resSelect.value.split('x').map(Number);
    this.canvas.width = w;
    this.canvas.height = h;
    document.getElementById('stat-res').textContent = w + '×' + h;
  }

  switchScene(sceneName) {
    this.currentScene = sceneName;
    document.querySelectorAll('.scene-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.scene === sceneName);
    });
    this.reRender();
  }

  updateCamera() {
    const fov = parseFloat(document.getElementById('fov').value);
    const aperture = parseFloat(document.getElementById('aperture').value) / 10;
    const focalDist = parseFloat(document.getElementById('focal-dist').value);
    this.camera.fov = fov;
    this.camera.aperture = aperture;
    this.camera.focalDist = focalDist;
    this.reRender();
  }

  reRender() {
    this.renderId++;
    this.accumulatedData = null;
    this.accumulatedSamples = 0;
    this.totalSamples = 0;
    this.totalRays = 0;
    this.renderTime = 0;
    this.isRendering = true;
    this.overlay.classList.remove('hidden');
    this.render();
  }

  render() {
    if (!this.isRendering) return;

    const scene = scenes[this.currentScene].create();
    const sceneData = sceneToData(scene);
    const cameraData = {
      position: this.camera.position.toArray(),
      target: this.camera.target.toArray(),
      up: this.camera.up.toArray(),
      fov: this.camera.fov,
      aperture: this.camera.aperture,
      focalDist: this.camera.focalDist
    };

    const width = this.canvas.width;
    const height = this.canvas.height;
    const samples = this.progressiveMode
      ? this.progressiveSamplesPerFrame
      : parseInt(document.getElementById('samples').value);
    const maxDepth = parseInt(document.getElementById('max-depth').value);

    if (!this.accumulatedData) {
      this.accumulatedData = new Float32Array(width * height * 3);
    }

    const rowsPerWorker = Math.ceil(height / this.numWorkers);
    const currentRenderId = this.renderId;
    const startTime = performance.now();

    this.workers.forEach((w, i) => {
      const startRow = i * rowsPerWorker;
      const endRow = Math.min(startRow + rowsPerWorker, height);
      if (startRow >= height) return;
      w.busy = true;
      w.worker.postMessage({
        sceneData,
        cameraData,
        width,
        height,
        startRow,
        endRow,
        samples,
        maxDepth,
        seed: Math.random(),
        renderId: currentRenderId
      });
    });

    this.renderStartTime = startTime;
  }

  handleWorkerMessage(e, workerEntry) {
    if (e.data.type === 'result') {
      const { startRow, endRow, data, samples, renderId } = e.data;

      if (renderId !== this.renderId) return;

      const width = this.canvas.width;
      const floatData = new Float32Array(data);

      if (!this.accumulatedData) {
        this.accumulatedData = new Float32Array(width * height * 3);
      }

      for (let i = 0; i < floatData.length; i++) {
        this.accumulatedData[startRow * width * 3 + i] += floatData[i];
      }

      this.accumulatedSamples += samples;
      this.totalSamples += samples;
      this.totalRays += (endRow - startRow) * width * samples;

      workerEntry.busy = false;

      const allDone = this.workers.every(w => !w.busy);
      if (allDone) {
        this.renderTime = (performance.now() - this.renderStartTime) / 1000;
        this.updateDisplay();

        if (this.progressiveMode) {
          this.render();
        } else {
          this.isRendering = false;
          this.overlay.classList.add('hidden');
        }
      }
    }
  }

  updateDisplay() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const imageData = this.ctx.createImageData(width, height);
    const data = imageData.data;

    for (let i = 0; i < width * height; i++) {
      const r = this.accumulatedData[i * 3] / this.accumulatedSamples;
      const g = this.accumulatedData[i * 3 + 1] / this.accumulatedSamples;
      const b = this.accumulatedData[i * 3 + 2] / this.accumulatedSamples;

      data[i * 4] = Math.min(255, Math.max(0, Math.pow(r, 1 / 2.2) * 255));
      data[i * 4 + 1] = Math.min(255, Math.max(0, Math.pow(g, 1 / 2.2) * 255));
      data[i * 4 + 2] = Math.min(255, Math.max(0, Math.pow(b, 1 / 2.2) * 255));
      data[i * 4 + 3] = 255;
    }

    const processedImageData = this.postProcessor.process(imageData, width, height);
    this.ctx.putImageData(processedImageData, 0, 0);

    document.getElementById('stat-samples').textContent = this.accumulatedSamples;
    document.getElementById('stat-rays').textContent = this.formatNumber(this.totalRays);
    document.getElementById('stat-time').textContent = this.renderTime.toFixed(1) + 's';
  }

  formatNumber(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toString();
  }

  onMouseDown(e) {
    this.isDragging = true;
    this.lastMouse = { x: e.clientX, y: e.clientY };
    this.autoRotate = false;
  }

  onMouseMove(e) {
    if (!this.isDragging) return;
    const dx = e.clientX - this.lastMouse.x;
    const dy = e.clientY - this.lastMouse.y;
    this.lastMouse = { x: e.clientX, y: e.clientY };

    if (e.buttons === 1) {
      const offset = this.camera.position.sub(this.camera.target);
      const radius = offset.length();
      const theta = Math.atan2(offset.x, offset.z) + dx * 0.005;
      const phi = Math.acos(Math.min(1, Math.max(-1, offset.y / radius))) + dy * 0.005;
      const newOffset = new Vec3(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
      );
      this.camera.position = this.camera.target.add(newOffset);
      this.camera.updateBasis();
    } else if (e.buttons === 2) {
      this.camera.pan(dx, dy);
    }
    this.reRender();
  }

  onMouseUp() {
    this.isDragging = false;
  }

  onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    this.camera.zoom(factor);
    this.reRender();
  }

  applyPreset(preset) {
    const presets = {
      front: { pos: [0, 2, 10], target: [0, 0, 0] },
      side: { pos: [10, 2, 0], target: [0, 0, 0] },
      top: { pos: [0, 15, 0.1], target: [0, 0, 0] },
      close: { pos: [3, 1, 3], target: [0, 0.5, 0] }
    };
    const p = presets[preset];
    if (p) {
      this.camera.position = Vec3.fromArray(p.pos);
      this.camera.target = Vec3.fromArray(p.target);
      this.camera.updateBasis();
      this.reRender();
    }
  }

  exportImage() {
    const link = document.createElement('a');
    link.download = 'lumen-render.png';
    link.href = this.canvas.toDataURL('image/png');
    link.click();
  }

  toggleProgressive() {
    this.progressiveMode = !this.progressiveMode;
    document.getElementById('btn-progressive').classList.toggle('active', this.progressiveMode);
    if (this.progressiveMode) {
      this.reRender();
    }
  }

  startAnimation() {
    this.isAnimating = true;
    this.animationFrames = [];
    document.getElementById('btn-animate').textContent = 'Stop';
    this.captureFrame();
  }

  stopAnimation() {
    this.isAnimating = false;
    document.getElementById('btn-animate').textContent = 'Animate';
    if (this.animationFrames.length > 0) {
      this.exportAnimation();
    }
  }

  captureFrame() {
    if (!this.isAnimating) return;
    this.animationFrames.push(this.canvas.toDataURL('image/png'));
    if (this.animationFrames.length >= this.maxAnimationFrames) {
      this.stopAnimation();
      return;
    }
    const offset = this.camera.position.sub(this.camera.target);
    const radius = offset.length();
    const theta = Math.atan2(offset.x, offset.z) + 0.02;
    const phi = Math.acos(Math.min(1, Math.max(-1, offset.y / radius)));
    const newOffset = new Vec3(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta)
    );
    this.camera.position = this.camera.target.add(newOffset);
    this.camera.updateBasis();
    this.reRender();
    setTimeout(() => this.captureFrame(), 100);
  }

  exportAnimation() {
    const canvas = document.createElement('canvas');
    canvas.width = this.canvas.width;
    canvas.height = this.canvas.height;
    const ctx = canvas.getContext('2d');
    let frameIndex = 0;
    const captureFrame = () => {
      if (frameIndex >= this.animationFrames.length) {
        const stream = canvas.captureStream(30);
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        const chunks = [];
        mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'lumen-animation.webm';
          a.click();
        };
        mediaRecorder.start();
        let playIndex = 0;
        const playFrame = () => {
          if (playIndex >= this.animationFrames.length) {
            mediaRecorder.stop();
            return;
          }
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0);
            playIndex++;
            setTimeout(playFrame, 33);
          };
          img.src = this.animationFrames[playIndex];
        };
        playFrame();
        return;
      }
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        frameIndex++;
        setTimeout(captureFrame, 33);
      };
      img.src = this.animationFrames[frameIndex];
    };
    captureFrame();
  }

  reset() {
    document.getElementById('samples').value = 4;
    document.getElementById('samples-value').textContent = '4';
    document.getElementById('max-depth').value = 8;
    document.getElementById('max-depth-value').textContent = '8';
    document.getElementById('fov').value = 60;
    document.getElementById('fov-value').textContent = '60°';
    document.getElementById('aperture').value = 0;
    document.getElementById('aperture-value').textContent = 'f/∞';
    document.getElementById('focal-dist').value = 5;
    document.getElementById('focal-dist-value').textContent = '5.0';
    this.setupCamera();
    this.reRender();
  }

  startRenderLoop() {
    const loop = () => {
      if (this.autoRotate && !this.isDragging && !this.isRendering) {
        const offset = this.camera.position.sub(this.camera.target);
        const radius = offset.length();
        const theta = Math.atan2(offset.x, offset.z) + this.autoRotateSpeed;
        const phi = Math.acos(Math.min(1, Math.max(-1, offset.y / radius)));
        const newOffset = new Vec3(
          radius * Math.sin(phi) * Math.sin(theta),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.cos(theta)
        );
        this.camera.position = this.camera.target.add(newOffset);
        this.camera.updateBasis();
        this.reRender();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new App();
});
