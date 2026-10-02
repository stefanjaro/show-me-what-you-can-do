class PostProcessor {
  constructor() {
    this.bloomEnabled = false;
    this.bloomThreshold = 0.8;
    this.bloomIntensity = 0.5;
    this.vignetteEnabled = false;
    this.vignetteIntensity = 0.3;
    this.chromaticAberrationEnabled = false;
    this.chromaticAberrationIntensity = 0.002;
  }

  process(imageData, width, height) {
    const data = imageData.data;
    const processed = new Uint8ClampedArray(data);

    if (this.bloomEnabled) {
      this.applyBloom(processed, width, height);
    }
    if (this.vignetteEnabled) {
      this.applyVignette(processed, width, height);
    }
    if (this.chromaticAberrationEnabled) {
      this.applyChromaticAberration(processed, width, height);
    }

    return new ImageData(processed, width, height);
  }

  applyBloom(data, width, height) {
    const temp = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      temp[i] = data[i];
    }
    const radius = 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const idx = (ny * width + nx) * 4;
              const brightness = (temp[idx] + temp[idx + 1] + temp[idx + 2]) / 3;
              if (brightness > this.bloomThreshold * 255) {
                r += temp[idx];
                g += temp[idx + 1];
                b += temp[idx + 2];
                count++;
              }
            }
          }
        }
        if (count > 0) {
          const idx = (y * width + x) * 4;
          data[idx] = Math.min(255, data[idx] + (r / count) * this.bloomIntensity);
          data[idx + 1] = Math.min(255, data[idx + 1] + (g / count) * this.bloomIntensity);
          data[idx + 2] = Math.min(255, data[idx + 2] + (b / count) * this.bloomIntensity);
        }
      }
    }
  }

  applyVignette(data, width, height) {
    const centerX = width / 2;
    const centerY = height / 2;
    const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
        const factor = 1 - dist * dist * this.vignetteIntensity;
        const idx = (y * width + x) * 4;
        data[idx] *= factor;
        data[idx + 1] *= factor;
        data[idx + 2] *= factor;
      }
    }
  }

  applyChromaticAberration(data, width, height) {
    const temp = new Uint8ClampedArray(data);
    const centerX = width / 2;
    const centerY = height / 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const offset = Math.floor(dist * this.chromaticAberrationIntensity);
        const idx = (y * width + x) * 4;
        const rIdx = (y * width + Math.min(width - 1, x + offset)) * 4;
        const bIdx = (y * width + Math.max(0, x - offset)) * 4;
        data[idx] = temp[rIdx];
        data[idx + 2] = temp[bIdx + 2];
      }
    }
  }
}
