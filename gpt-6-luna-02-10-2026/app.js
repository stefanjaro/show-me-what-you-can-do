(() => {
  "use strict";

  const WIDTH = 1200;
  const HEIGHT = 820;
  const PLOT = { x: 78, y: 88, w: 1044, h: 550 };
  const GRID_COLUMNS = 164;
  const GRID_ROWS = 86;
  const DEFAULT_MEMORY = "The cedar porch where rain sounded like someone arriving.";

  const $ = (selector) => document.querySelector(selector);
  const mapCanvas = $("#map-canvas");
  const effectCanvas = $("#effect-canvas");
  const mapContext = mapCanvas?.getContext("2d", { alpha: false });
  const effectContext = effectCanvas?.getContext("2d");
  const stage = $("#map-stage");
  const form = $("#memory-form");
  const memoryInput = $("#memory-input");
  const characterCount = $("#character-count");
  const lightDial = $("#light-dial");
  const lightOutput = $("#light-output");
  const actionStatus = $("#action-status");
  const shareButton = $("#share-button");
  const shareFallback = $("#share-fallback");
  const shareUrlInput = $("#share-url");

  if (!mapContext || !effectContext || !stage || !form || !memoryInput) return;

  const state = {
    memory: DEFAULT_MEMORY,
    seed: 0,
    hour: 55,
    field: null,
    terrain: null,
    names: [],
    layers: { relief: true, water: true, route: true, names: true },
    pin: null,
    hover: null,
    surface: { width: 0, height: 0, ratio: 1 },
    renderTimer: 0,
  };

  const paletteStops = [
    {
      at: 0,
      paper: "#e8e1cf",
      land: "#f0ecdd",
      low: "#e3e2d0",
      high: "#c6c5aa",
      ink: "#35423a",
      soft: "#777a6b",
      grid: "#b5b19c",
      contour: "#827968",
      major: "#655f50",
      water: "#527f83",
      waterLight: "#e3ead5",
      route: "#c3684d",
      label: "#eee9d9",
      grain: "#716d55",
      glow: "#dcb56a",
    },
    {
      at: 50,
      paper: "#dad8d2",
      land: "#e9e5dc",
      low: "#e2dfd6",
      high: "#bec2bd",
      ink: "#393943",
      soft: "#777783",
      grid: "#aaa7a6",
      contour: "#817e83",
      major: "#5e5c67",
      water: "#648a91",
      waterLight: "#e5ede6",
      route: "#b96f62",
      label: "#eeebe2",
      grain: "#696b6d",
      glow: "#dbc18b",
    },
    {
      at: 100,
      paper: "#1c2b36",
      land: "#203542",
      low: "#263945",
      high: "#476b68",
      ink: "#d1d8cb",
      soft: "#94a9a0",
      grid: "#465a60",
      contour: "#76938d",
      major: "#b4c7ad",
      water: "#68c5c0",
      waterLight: "#d6ebce",
      route: "#f1a17a",
      label: "#293f49",
      grain: "#abc4b2",
      glow: "#efd291",
    },
  ];

  const terrainCanvas = document.createElement("canvas");
  terrainCanvas.width = GRID_COLUMNS + 1;
  terrainCanvas.height = GRID_ROWS + 1;
  const terrainContext = terrainCanvas.getContext("2d", { willReadFrequently: false });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let resizeObserver = null;
  let animationObserver = null;
  let animationFrame = 0;
  let stageIsVisible = true;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value = (value + 0x6d2b79f5) | 0;
      let next = value;
      next = Math.imul(next ^ (next >>> 15), next | 1);
      next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
      return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashText(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function rgbFromHex(hex) {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function hexFromRgb(rgb) {
    return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
  }

  function mixColor(first, second, amount) {
    const a = rgbFromHex(first);
    const b = rgbFromHex(second);
    return hexFromRgb(a.map((channel, index) => channel + (b[index] - channel) * amount));
  }

  function getPalette(value) {
    const lower = value <= 50 ? paletteStops[0] : paletteStops[1];
    const upper = value <= 50 ? paletteStops[1] : paletteStops[2];
    const start = lower.at;
    const amount = clamp((value - start) / 50, 0, 1);
    const result = {};
    for (const key of Object.keys(lower)) {
      if (key === "at") continue;
      result[key] = mixColor(lower[key], upper[key], amount);
    }
    return result;
  }

  function timeName(value) {
    if (value < 28) return "FIRST LIGHT";
    if (value < 49) return "LATE MORNING";
    if (value < 72) return "BLUE HOUR";
    return "AFTER DARK";
  }

  function smooth(value) {
    return value * value * (3 - 2 * value);
  }

  function makeNoise(seed) {
    function lattice(x, y) {
      let number = seed + Math.imul(x, 374761393) + Math.imul(y, 668265263);
      number = Math.imul(number ^ (number >>> 13), 1274126177);
      number ^= number >>> 16;
      return (number >>> 0) / 2147483647.5 - 1;
    }

    return (x, y) => {
      const left = Math.floor(x);
      const top = Math.floor(y);
      const tx = smooth(x - left);
      const ty = smooth(y - top);
      const north = lattice(left, top) * (1 - tx) + lattice(left + 1, top) * tx;
      const south = lattice(left, top + 1) * (1 - tx) + lattice(left + 1, top + 1) * tx;
      return north * (1 - ty) + south * ty;
    };
  }

  function makeLandscape(seed) {
    const random = seededRandom(seed ^ 0x9e3779b9);
    const noise = makeNoise(seed ^ 0x85ebca6b);
    const phase = random() * Math.PI * 2;
    const hills = Array.from({ length: 23 }, () => {
      const isHollow = random() < 0.38;
      return {
        x: -0.08 + random() * 1.16,
        y: -0.1 + random() * 1.2,
        rx: 0.065 + random() * 0.17,
        ry: 0.07 + random() * 0.2,
        height: (0.065 + random() * 0.13) * (isHollow ? -1 : 1),
      };
    });

    return {
      phase,
      sample(x, y) {
        let height = 0.49;
        height += noise(x * 3.7 + 8, y * 3.7 + 4) * 0.19;
        height += noise(x * 8.2 + 21, y * 8.2 + 17) * 0.075;
        height += noise(x * 17.5 + 32, y * 17.5 + 29) * 0.028;
        height += Math.sin(x * 8.2 + y * 3.7 + phase) * 0.027;

        for (const hill of hills) {
          const dx = (x - hill.x) / hill.rx;
          const dy = (y - hill.y) / hill.ry;
          height += hill.height * Math.exp(-1.7 * (dx * dx + dy * dy));
        }

        return clamp(height, 0.025, 0.975);
      },
    };
  }

  function makeNames(seed) {
    const random = seededRandom(seed ^ 0xa341316c);
    const firstWords = [
      "Morrow", "Kettle", "Tender", "Foxglove", "Low", "Blue", "Paper", "Quiet",
      "Lantern", "Almost", "June", "Slow", "Moss", "Little", "Hollow", "North",
      "Elsewhere", "Velvet", "Cedar", "Soft",
    ];
    const secondWords = [
      "Reach", "Hill", "Weather", "Ferry", "Orchard", "Field", "Crossing", "Rill",
      "Station", "Fold", "Shore", "Garden", "Bridge", "Meadow", "Corner", "Common",
      "Hollow", "Grove", "House", "Cut",
    ];
    const anchors = [
      [0.17, 0.2], [0.48, 0.15], [0.79, 0.23], [0.31, 0.46],
      [0.68, 0.51], [0.16, 0.74], [0.48, 0.84], [0.84, 0.77],
    ];

    return anchors.map(([x, y], index) => ({
      name: `${firstWords[Math.floor(random() * firstWords.length)]} ${secondWords[Math.floor(random() * secondWords.length)]}`,
      x: clamp(x + (random() - 0.5) * 0.11, 0.08, 0.92),
      y: clamp(y + (random() - 0.5) * 0.1, 0.1, 0.9),
      alignRight: index % 2 === 1,
    }));
  }

  function formatGrid(point) {
    const u = point ? point.x : 0.5;
    const v = point ? point.y : 0.5;
    const east = Math.round(u * 99).toString().padStart(2, "0");
    const north = Math.round((1 - v) * 99).toString().padStart(2, "0");
    return `${north} / ${east}`;
  }

  function currentPoint() {
    return state.pin || { x: 0.5, y: 0.5 };
  }

  function chartTitle(text) {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return "A place without a name";
    return cleaned.charAt(0).toLocaleUpperCase() + cleaned.slice(1);
  }

  function updatePageLabels() {
    const title = chartTitle(state.memory);
    const grid = formatGrid(currentPoint());
    const serial = (state.seed % 9000) + 1000;

    $("#chart-title").textContent = title;
    $("#caption-memory").textContent = state.memory;
    $("#chart-serial").textContent = `NO. ${serial}`;
    $("#grid-caption").textContent = `FIELD GRID · ${grid}`;
    document.title = `${title} — The Elsewhere Atlas`;
    mapCanvas.setAttribute(
      "aria-label",
      `A procedurally generated topographic map made from the words: ${state.memory}. It has shaded relief, contour lines, a river and a wandering route. Click the map to place a personal pin.`,
    );
    characterCount.textContent = `${memoryInput.value.length} / 180`;
  }

  function randomGrid() {
    if (state.terrain) return state.terrain;
    const values = new Float32Array((GRID_COLUMNS + 1) * (GRID_ROWS + 1));
    let low = 1;
    let high = 0;

    for (let row = 0; row <= GRID_ROWS; row += 1) {
      for (let column = 0; column <= GRID_COLUMNS; column += 1) {
        const height = state.field.sample(column / GRID_COLUMNS, row / GRID_ROWS);
        values[row * (GRID_COLUMNS + 1) + column] = height;
        low = Math.min(low, height);
        high = Math.max(high, height);
      }
    }

    state.terrain = { values, low, high };
    return state.terrain;
  }

  function paintHeightfield(context, values, low, high, palette) {
    const image = terrainContext.createImageData(GRID_COLUMNS + 1, GRID_ROWS + 1);
    const lower = rgbFromHex(palette.low);
    const upper = rgbFromHex(palette.high);
    const span = Math.max(0.001, high - low);
    const stride = GRID_COLUMNS + 1;

    for (let row = 0; row <= GRID_ROWS; row += 1) {
      for (let column = 0; column <= GRID_COLUMNS; column += 1) {
        const offset = row * stride + column;
        const height = values[offset];
        const relief = smooth(clamp((height - low) / span, 0, 1));
        const west = values[row * stride + Math.max(0, column - 1)];
        const east = values[row * stride + Math.min(GRID_COLUMNS, column + 1)];
        const north = values[Math.max(0, row - 1) * stride + column];
        const south = values[Math.min(GRID_ROWS, row + 1) * stride + column];
        const illumination = clamp(0.86 - (east - west) * 2.8 - (south - north) * 1.35, 0.63, 1.12);
        const pixel = offset * 4;

        for (let channel = 0; channel < 3; channel += 1) {
          const color = lower[channel] + (upper[channel] - lower[channel]) * (0.12 + relief * 0.88);
          image.data[pixel + channel] = clamp(color * illumination, 0, 255);
        }
        image.data[pixel + 3] = 255;
      }
    }

    terrainContext.putImageData(image, 0, 0);
    context.save();
    context.imageSmoothingEnabled = true;
    context.drawImage(terrainCanvas, PLOT.x, PLOT.y, PLOT.w, PLOT.h);
    context.restore();
  }

  function drawCoordinateGrid(context, palette) {
    context.save();
    context.beginPath();
    context.rect(PLOT.x, PLOT.y, PLOT.w, PLOT.h);
    context.clip();
    context.strokeStyle = palette.grid;
    context.lineWidth = 0.75;

    for (let index = 0; index <= 8; index += 1) {
      const x = PLOT.x + (PLOT.w / 8) * index;
      context.globalAlpha = index === 0 || index === 8 ? 0.48 : 0.34;
      context.setLineDash(index === 0 || index === 8 ? [] : [2, 8]);
      context.beginPath();
      context.moveTo(x, PLOT.y);
      context.lineTo(x, PLOT.y + PLOT.h);
      context.stroke();
    }

    for (let index = 0; index <= 4; index += 1) {
      const y = PLOT.y + (PLOT.h / 4) * index;
      context.globalAlpha = index === 0 || index === 4 ? 0.48 : 0.34;
      context.setLineDash(index === 0 || index === 4 ? [] : [2, 8]);
      context.beginPath();
      context.moveTo(PLOT.x, y);
      context.lineTo(PLOT.x + PLOT.w, y);
      context.stroke();
    }
    context.setLineDash([]);
    context.restore();
  }

  function drawCoordinateLabels(context, palette) {
    context.save();
    context.fillStyle = palette.soft;
    context.font = "12px 'SFMono-Regular', Consolas, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (let index = 1; index < 8; index += 1) {
      const x = PLOT.x + (PLOT.w / 8) * index;
      context.globalAlpha = 0.8;
      context.fillText(String(index * 12).padStart(2, "0"), x, PLOT.y - 13);
    }

    context.textAlign = "right";
    for (let index = 1; index < 4; index += 1) {
      const y = PLOT.y + (PLOT.h / 4) * index;
      context.globalAlpha = 0.8;
      context.fillText(String((4 - index) * 18).padStart(2, "0"), PLOT.x - 10, y);
    }
    context.restore();
  }

  function drawContours(context, values, low, high, palette) {
    const stride = GRID_COLUMNS + 1;
    const contourCount = 19;
    const thresholdStart = low + (high - low) * 0.065;
    const thresholdStep = (high - low) * 0.87 / contourCount;

    context.save();
    context.beginPath();
    context.rect(PLOT.x, PLOT.y, PLOT.w, PLOT.h);
    context.clip();
    context.lineCap = "round";
    context.lineJoin = "round";

    for (let contour = 0; contour < contourCount; contour += 1) {
      const threshold = thresholdStart + contour * thresholdStep;
      const major = contour % 4 === 0;
      context.beginPath();
      context.lineWidth = major ? 1.55 : 0.8;
      context.strokeStyle = major ? palette.major : palette.contour;
      context.globalAlpha = major ? 0.87 : 0.68;

      let hasPendingPoint = false;
      let pendingX = 0;
      let pendingY = 0;
      const connect = (x, y) => {
        if (!hasPendingPoint) {
          pendingX = x;
          pendingY = y;
          hasPendingPoint = true;
        } else {
          context.moveTo(pendingX, pendingY);
          context.lineTo(x, y);
          hasPendingPoint = false;
        }
      };

      for (let row = 0; row < GRID_ROWS; row += 1) {
        const y0 = PLOT.y + (row / GRID_ROWS) * PLOT.h;
        const y1 = PLOT.y + ((row + 1) / GRID_ROWS) * PLOT.h;
        const rowOffset = row * stride;
        const nextRowOffset = (row + 1) * stride;

        for (let column = 0; column < GRID_COLUMNS; column += 1) {
          const x0 = PLOT.x + (column / GRID_COLUMNS) * PLOT.w;
          const x1 = PLOT.x + ((column + 1) / GRID_COLUMNS) * PLOT.w;
          const topLeft = values[rowOffset + column];
          const topRight = values[rowOffset + column + 1];
          const bottomRight = values[nextRowOffset + column + 1];
          const bottomLeft = values[nextRowOffset + column];

          if (Math.min(topLeft, topRight, bottomRight, bottomLeft) >= threshold ||
              Math.max(topLeft, topRight, bottomRight, bottomLeft) < threshold) continue;

          const addEdge = (ax, ay, av, bx, by, bv) => {
            if ((av < threshold) === (bv < threshold)) return;
            const distance = clamp((threshold - av) / (bv - av), 0, 1);
            connect(ax + (bx - ax) * distance, ay + (by - ay) * distance);
          };

          // Walking the cell edges in order pairs the crossings into contour segments.
          addEdge(x0, y0, topLeft, x1, y0, topRight);
          addEdge(x1, y0, topRight, x1, y1, bottomRight);
          addEdge(x1, y1, bottomRight, x0, y1, bottomLeft);
          addEdge(x0, y1, bottomLeft, x0, y0, topLeft);
        }
      }

      context.stroke();
    }

    context.restore();
  }

  function riverPoint(fraction, phase) {
    const u = 0.025 + fraction * 0.95;
    const v = 0.51 + Math.sin(fraction * Math.PI * 2.15 + phase) * 0.155 +
      Math.sin(fraction * Math.PI * 5.2 + phase * 1.7) * 0.035;
    return { x: u, y: v };
  }

  function traceRiver(context, phase) {
    context.beginPath();
    for (let index = 0; index <= 170; index += 1) {
      const point = riverPoint(index / 170, phase);
      const x = PLOT.x + point.x * PLOT.w;
      const y = PLOT.y + point.y * PLOT.h;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
  }

  function drawWater(context, palette) {
    context.save();
    context.beginPath();
    context.rect(PLOT.x, PLOT.y, PLOT.w, PLOT.h);
    context.clip();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.shadowColor = palette.water;
    context.shadowBlur = 11;
    context.globalAlpha = 0.76;
    context.strokeStyle = palette.water;
    context.lineWidth = 17;
    traceRiver(context, state.field.phase);
    context.stroke();
    context.shadowBlur = 0;
    context.globalAlpha = 0.91;
    context.lineWidth = 2.7;
    context.strokeStyle = palette.waterLight;
    traceRiver(context, state.field.phase);
    context.stroke();

    const tributaries = [0.17, 0.39, 0.69, 0.84];
    context.globalAlpha = 0.69;
    context.lineWidth = 2.2;
    context.strokeStyle = palette.water;
    for (let index = 0; index < tributaries.length; index += 1) {
      const fraction = tributaries[index];
      const origin = riverPoint(fraction, state.field.phase);
      const x = PLOT.x + origin.x * PLOT.w;
      const y = PLOT.y + origin.y * PLOT.h;
      const direction = index % 2 === 0 ? -1 : 1;
      context.beginPath();
      context.moveTo(x, y);
      context.quadraticCurveTo(
        x - 19 + index * 8,
        y + direction * 50,
        x - 45 + index * 15,
        y + direction * (76 + (index % 3) * 10),
      );
      context.stroke();
    }
    context.restore();
  }

  function drawWander(context, palette) {
    const random = seededRandom(state.seed ^ 0xc8013ea4);
    const points = Array.from({ length: 8 }, (_, index) => ({
      x: 0.08 + index * 0.118 + (random() - 0.5) * 0.11,
      y: 0.15 + random() * 0.7,
    }));

    context.save();
    context.beginPath();
    context.moveTo(PLOT.x + points[0].x * PLOT.w, PLOT.y + points[0].y * PLOT.h);
    for (let index = 1; index < points.length - 1; index += 1) {
      const middleX = (points[index].x + points[index + 1].x) * 0.5;
      const middleY = (points[index].y + points[index + 1].y) * 0.5;
      context.quadraticCurveTo(
        PLOT.x + points[index].x * PLOT.w,
        PLOT.y + points[index].y * PLOT.h,
        PLOT.x + middleX * PLOT.w,
        PLOT.y + middleY * PLOT.h,
      );
    }
    const last = points[points.length - 1];
    context.lineTo(PLOT.x + last.x * PLOT.w, PLOT.y + last.y * PLOT.h);
    context.strokeStyle = palette.route;
    context.lineWidth = 2.1;
    context.globalAlpha = 0.92;
    context.setLineDash([3, 10]);
    context.lineDashOffset = 0;
    context.lineCap = "round";
    context.stroke();
    context.setLineDash([]);

    for (const [index, point] of points.entries()) {
      if (index === 0 || index === points.length - 1 || index % 2 === 0) {
        const x = PLOT.x + point.x * PLOT.w;
        const y = PLOT.y + point.y * PLOT.h;
        context.beginPath();
        context.arc(x, y, index === 0 || index === points.length - 1 ? 4.2 : 2.5, 0, Math.PI * 2);
        context.fillStyle = palette.route;
        context.fill();
      }
    }
    context.restore();
  }

  function drawPlaceNames(context, palette) {
    context.save();
    context.font = "15px 'SFMono-Regular', Consolas, monospace";
    context.textBaseline = "middle";

    for (const [index, place] of state.names.entries()) {
      const x = PLOT.x + place.x * PLOT.w;
      const y = PLOT.y + place.y * PLOT.h;
      const text = place.name.toUpperCase();
      const direction = place.alignRight ? -1 : 1;
      const textX = x + direction * (18 + (index % 3) * 3);
      const textY = y + (index % 2 === 0 ? -13 : 15);
      context.textAlign = place.alignRight ? "right" : "left";

      context.globalAlpha = 0.76;
      context.strokeStyle = palette.soft;
      context.lineWidth = 0.7;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + direction * 11, y);
      context.lineTo(textX - direction * 4, textY);
      context.stroke();

      context.beginPath();
      context.arc(x, y, 2.1, 0, Math.PI * 2);
      context.fillStyle = palette.ink;
      context.fill();

      const textWidth = context.measureText(text).width;
      const left = place.alignRight ? textX - textWidth - 4 : textX - 4;
      context.globalAlpha = 0.88;
      context.fillStyle = palette.label;
      context.fillRect(left, textY - 9, textWidth + 8, 18);
      context.globalAlpha = 0.95;
      context.fillStyle = palette.ink;
      context.fillText(text, textX, textY);
    }

    context.restore();
  }

  function drawPin(context, palette) {
    if (!state.pin) return;
    const x = PLOT.x + state.pin.x * PLOT.w;
    const y = PLOT.y + state.pin.y * PLOT.h;

    context.save();
    context.translate(x, y);
    context.lineWidth = 1.4;
    context.strokeStyle = palette.label;
    context.fillStyle = palette.route;
    context.beginPath();
    context.moveTo(0, 18);
    context.lineTo(0, 4);
    context.stroke();
    context.beginPath();
    context.arc(0, 0, 9, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = palette.label;
    context.lineWidth = 1.5;
    context.stroke();
    context.beginPath();
    context.arc(0, 0, 3, 0, Math.PI * 2);
    context.fillStyle = palette.label;
    context.fill();
    context.font = "11px 'SFMono-Regular', Consolas, monospace";
    context.textAlign = state.pin.x > 0.73 ? "right" : "left";
    context.textBaseline = "bottom";
    context.fillStyle = palette.label;
    context.fillText("YOU ARE HERE", state.pin.x > 0.73 ? -13 : 13, -12);
    context.restore();
  }

  function drawCompass(context, palette) {
    const x = PLOT.x + PLOT.w - 49;
    const y = PLOT.y + 47;
    context.save();
    context.globalAlpha = 0.85;
    context.strokeStyle = palette.soft;
    context.fillStyle = palette.ink;
    context.lineWidth = 1;
    context.beginPath();
    context.arc(x, y, 19, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(x, y - 14);
    context.lineTo(x + 5, y + 5);
    context.lineTo(x, y + 1);
    context.lineTo(x - 5, y + 5);
    context.closePath();
    context.fill();
    context.font = "11px 'SFMono-Regular', Consolas, monospace";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.fillText("N", x, y - 23);
    context.restore();
  }

  function drawFrame(context, palette) {
    context.save();
    context.strokeStyle = palette.soft;
    context.globalAlpha = 0.74;
    context.lineWidth = 0.8;
    context.strokeRect(15, 15, WIDTH - 30, HEIGHT - 30);
    context.strokeStyle = palette.grid;
    context.globalAlpha = 0.7;
    context.strokeRect(23, 23, WIDTH - 46, HEIGHT - 46);

    context.fillStyle = palette.ink;
    context.font = "bold 13px 'SFMono-Regular', Consolas, monospace";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText("THE ELSEWHERE ATLAS", 41, 49);
    context.fillStyle = palette.soft;
    context.font = "11px 'SFMono-Regular', Consolas, monospace";
    context.textAlign = "right";
    context.fillText("AN INVENTED GEOGRAPHY  ·  MADE LOCALLY", WIDTH - 41, 49);

    context.globalAlpha = 0.65;
    context.strokeStyle = palette.soft;
    context.beginPath();
    context.moveTo(42, 66);
    context.lineTo(WIDTH - 42, 66);
    context.stroke();

    // Small registration marks give the map the feel of a printed field plate.
    const corners = [
      [PLOT.x, PLOT.y, 1, 1],
      [PLOT.x + PLOT.w, PLOT.y, -1, 1],
      [PLOT.x, PLOT.y + PLOT.h, 1, -1],
      [PLOT.x + PLOT.w, PLOT.y + PLOT.h, -1, -1],
    ];
    context.globalAlpha = 0.85;
    context.lineWidth = 1;
    for (const [x, y, dx, dy] of corners) {
      context.beginPath();
      context.moveTo(x, y + dy * 10);
      context.lineTo(x, y);
      context.lineTo(x + dx * 10, y);
      context.stroke();
    }
    context.restore();
  }

  function drawChartBlock(context, palette) {
    const pin = currentPoint();
    const serial = (state.seed % 9000) + 1000;
    const title = chartTitle(state.memory);
    const displayTitle = title.length > 51 ? `${title.slice(0, 48).trimEnd()}…` : title;

    context.save();
    context.strokeStyle = palette.grid;
    context.globalAlpha = 0.78;
    context.lineWidth = 0.85;
    context.beginPath();
    context.moveTo(40, 659);
    context.lineTo(WIDTH - 40, 659);
    context.stroke();

    context.textBaseline = "middle";
    context.textAlign = "left";
    context.fillStyle = palette.soft;
    context.font = "11px 'SFMono-Regular', Consolas, monospace";
    context.fillText(`FIELD STUDY  /  ${String(serial).padStart(4, "0")}`, 44, 684);
    context.fillStyle = palette.ink;
    context.font = "30px Georgia, 'Times New Roman', serif";
    context.fillText(displayTitle, 42, 726, 770);
    context.fillStyle = palette.soft;
    context.font = "11px 'SFMono-Regular', Consolas, monospace";
    context.fillText(`GRID ${formatGrid(pin)}   ·   ${timeName(state.hour)}   ·   ${state.seed.toString(16).toUpperCase().padStart(8, "0")}`, 44, 758);

    const scaleX = WIDTH - 226;
    const scaleY = 709;
    context.strokeStyle = palette.ink;
    context.globalAlpha = 0.8;
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(scaleX, scaleY);
    context.lineTo(scaleX + 145, scaleY);
    context.moveTo(scaleX, scaleY - 5);
    context.lineTo(scaleX, scaleY + 5);
    context.moveTo(scaleX + 145, scaleY - 5);
    context.lineTo(scaleX + 145, scaleY + 5);
    context.stroke();
    context.fillStyle = palette.soft;
    context.font = "10px 'SFMono-Regular', Consolas, monospace";
    context.textAlign = "left";
    context.fillText("A DISTANCE THAT ISN'T", scaleX, 689);
    context.textAlign = "right";
    context.fillText("NOT TO SCALE  /  ALWAYS TRUE", WIDTH - 43, 758);
    context.restore();
  }

  function drawPaperGrain(context, palette) {
    const random = seededRandom(state.seed ^ 0x27d4eb2d);
    context.save();
    context.beginPath();
    context.rect(25, 25, WIDTH - 50, HEIGHT - 50);
    context.clip();
    context.globalAlpha = state.hour > 77 ? 0.075 : 0.105;
    context.fillStyle = palette.grain;
    for (let index = 0; index < 1450; index += 1) {
      const x = 27 + random() * (WIDTH - 54);
      const y = 27 + random() * (HEIGHT - 54);
      const size = random() > 0.96 ? 2.1 : 0.8;
      context.fillRect(x, y, size, size);
    }
    context.restore();
  }

  function drawMap() {
    if (!state.surface.width || !state.surface.height) return;
    const context = mapContext;
    const palette = getPalette(state.hour);
    context.setTransform(state.surface.width / WIDTH, 0, 0, state.surface.height / HEIGHT, 0, 0);
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = palette.paper;
    context.fillRect(0, 0, WIDTH, HEIGHT);
    drawPaperGrain(context, palette);
    drawFrame(context, palette);

    context.save();
    context.beginPath();
    context.rect(PLOT.x, PLOT.y, PLOT.w, PLOT.h);
    context.clip();
    context.fillStyle = palette.land;
    context.fillRect(PLOT.x, PLOT.y, PLOT.w, PLOT.h);
    const grid = state.layers.relief ? randomGrid() : null;
    if (state.layers.relief) {
      paintHeightfield(context, grid.values, grid.low, grid.high, palette);
    } else {
      context.fillStyle = palette.land;
      context.fillRect(PLOT.x, PLOT.y, PLOT.w, PLOT.h);
    }
    drawCoordinateGrid(context, palette);
    if (state.layers.relief) drawContours(context, grid.values, grid.low, grid.high, palette);
    if (state.layers.water) drawWater(context, palette);
    if (state.layers.route) drawWander(context, palette);
    if (state.layers.names) drawPlaceNames(context, palette);
    drawPin(context, palette);
    drawCompass(context, palette);
    context.restore();

    drawCoordinateLabels(context, palette);
    drawChartBlock(context, palette);
    updatePageLabels();
    drawEffects(performance.now());
  }

  function drawEffects(now) {
    if (!state.surface.width || !state.surface.height) return;
    const context = effectContext;
    const palette = getPalette(state.hour);
    context.setTransform(state.surface.width / WIDTH, 0, 0, state.surface.height / HEIGHT, 0, 0);
    context.clearRect(0, 0, WIDTH, HEIGHT);

    if (!reducedMotion.matches && stageIsVisible && state.layers.water) {
      const fraction = ((now % 18000) / 18000 + 1) % 1;
      const point = riverPoint(fraction, state.field.phase);
      const x = PLOT.x + point.x * PLOT.w;
      const y = PLOT.y + point.y * PLOT.h;
      const pulse = 1 + Math.sin(now / 510) * 1.2;
      const glow = context.createRadialGradient(x, y, 1, x, y, 17 + pulse);
      glow.addColorStop(0, palette.glow);
      glow.addColorStop(0.18, palette.glow);
      glow.addColorStop(1, "transparent");
      context.fillStyle = glow;
      context.globalAlpha = 0.68;
      context.beginPath();
      context.arc(x, y, 18 + pulse, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
      context.beginPath();
      context.arc(x, y, 2.9, 0, Math.PI * 2);
      context.fillStyle = palette.label;
      context.fill();
      context.beginPath();
      context.arc(x, y, 1.5, 0, Math.PI * 2);
      context.fillStyle = palette.water;
      context.fill();
    }

    if (state.hover) {
      const x = PLOT.x + state.hover.x * PLOT.w;
      const y = PLOT.y + state.hover.y * PLOT.h;
      context.save();
      context.beginPath();
      context.rect(PLOT.x, PLOT.y, PLOT.w, PLOT.h);
      context.clip();
      context.strokeStyle = palette.label;
      context.globalAlpha = 0.7;
      context.lineWidth = 0.7;
      context.setLineDash([3, 5]);
      context.beginPath();
      context.moveTo(x, PLOT.y);
      context.lineTo(x, PLOT.y + PLOT.h);
      context.moveTo(PLOT.x, y);
      context.lineTo(PLOT.x + PLOT.w, y);
      context.stroke();
      context.setLineDash([]);

      const grid = formatGrid(state.hover);
      const tag = `GRID ${grid}`;
      context.font = "12px 'SFMono-Regular', Consolas, monospace";
      const tagWidth = context.measureText(tag).width + 17;
      const tagX = clamp(x + 12, PLOT.x + 4, PLOT.x + PLOT.w - tagWidth - 4);
      const tagY = clamp(y - 25, PLOT.y + 4, PLOT.y + PLOT.h - 24);
      context.globalAlpha = 0.95;
      context.fillStyle = palette.label;
      context.fillRect(tagX, tagY, tagWidth, 21);
      context.fillStyle = palette.ink;
      context.globalAlpha = 1;
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.fillText(tag, tagX + 8, tagY + 11);
      context.restore();
    }
  }

  function syncSurface() {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);

    for (const canvas of [mapCanvas, effectCanvas]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    state.surface = { width, height, ratio };
    drawMap();
  }

  function queueRender() {
    window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(drawMap, 70);
  }

  function describeAction(message) {
    actionStatus.textContent = "";
    window.requestAnimationFrame(() => {
      actionStatus.textContent = message;
    });
  }

  function chartMemory(memory) {
    const cleaned = memory.replace(/\s+/g, " ").trim().slice(0, 180) || DEFAULT_MEMORY;
    state.memory = cleaned;
    state.seed = hashText(cleaned);
    state.field = makeLandscape(state.seed);
    state.terrain = null;
    state.names = makeNames(state.seed);
    state.pin = null;
    state.hover = null;
    memoryInput.value = cleaned;
    updatePageLabels();
    drawMap();
    describeAction(`A new landscape has been drawn for: ${cleaned}`);
  }

  function setPin(point, message) {
    state.pin = { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
    updatePageLabels();
    drawMap();
    describeAction(message || `Pinned grid ${formatGrid(state.pin)}. This place is yours.`);
  }

  function canvasPoint(event) {
    const rect = mapCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    if (x < PLOT.x || x > PLOT.x + PLOT.w || y < PLOT.y || y > PLOT.y + PLOT.h) return null;
    return { x: (x - PLOT.x) / PLOT.w, y: (y - PLOT.y) / PLOT.h };
  }

  function makeShareUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("memory", state.memory);
    url.searchParams.set("light", String(state.hour));
    url.searchParams.set("layers", Object.values(state.layers).map((enabled) => enabled ? "1" : "0").join(""));
    if (state.pin) {
      url.searchParams.set("pin", `${state.pin.x.toFixed(4)},${state.pin.y.toFixed(4)}`);
    }
    return url.toString();
  }

  async function copyShareUrl() {
    const url = makeShareUrl();
    try {
      await navigator.clipboard.writeText(url);
      shareFallback.hidden = true;
      describeAction("A link to this exact chart is copied. It includes your chosen words in the address.");
    } catch {
      shareFallback.hidden = false;
      shareUrlInput.value = url;
      shareUrlInput.focus();
      shareUrlInput.select();
      try {
        const copied = document.execCommand("copy");
        describeAction(copied
          ? "A link to this exact chart is copied. It includes your chosen words in the address."
          : "The chart link is selected. Copy it to share this map; it includes your chosen words.");
      } catch {
        describeAction("The chart link is selected. Copy it to share this map; it includes your chosen words.");
      }
    }
  }

  function downloadChart() {
    const slug = state.memory
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 42) || "remembered-place";

    mapCanvas.toBlob((blob) => {
      if (!blob) {
        describeAction("The chart could not be saved by this browser.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `elsewhere-atlas-${slug}.png`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      describeAction("Your map was saved as a PNG image.");
    }, "image/png");
  }

  function loadSharedChart() {
    const params = new URLSearchParams(window.location.search);
    const sharedMemory = params.get("memory");
    if (sharedMemory) state.memory = sharedMemory.replace(/\s+/g, " ").trim().slice(0, 180) || DEFAULT_MEMORY;

    const sharedHour = Number(params.get("light"));
    if (params.has("light") && Number.isFinite(sharedHour)) {
      state.hour = clamp(sharedHour, 0, 100);
    }

    const layers = params.get("layers");
    if (layers && layers.length >= 4) {
      Object.keys(state.layers).forEach((key, index) => {
        state.layers[key] = layers[index] !== "0";
      });
    }

    const pin = params.get("pin")?.split(",").map(Number);
    if (pin?.length === 2 && pin.every(Number.isFinite)) {
      state.pin = { x: clamp(pin[0], 0, 1), y: clamp(pin[1], 0, 1) };
    }

    memoryInput.value = state.memory;
    lightDial.value = String(state.hour);
    lightOutput.textContent = timeName(state.hour);
    for (const button of document.querySelectorAll("[data-layer]")) {
      const enabled = state.layers[button.dataset.layer];
      button.setAttribute("aria-pressed", String(enabled));
      button.classList.toggle("is-on", enabled);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    chartMemory(memoryInput.value);
  });

  memoryInput.addEventListener("input", () => {
    characterCount.textContent = `${memoryInput.value.length} / 180`;
  });

  for (const button of document.querySelectorAll("[data-memory]")) {
    button.addEventListener("click", () => chartMemory(button.dataset.memory));
  }

  for (const button of document.querySelectorAll("[data-layer]")) {
    button.addEventListener("click", () => {
      const layer = button.dataset.layer;
      state.layers[layer] = !state.layers[layer];
      button.setAttribute("aria-pressed", String(state.layers[layer]));
      button.classList.toggle("is-on", state.layers[layer]);
      drawMap();
      describeAction(`${layer.charAt(0).toUpperCase() + layer.slice(1)} layer ${state.layers[layer] ? "shown" : "hidden"}.`);
    });
  }

  lightDial.addEventListener("input", () => {
    state.hour = Number(lightDial.value);
    lightOutput.textContent = timeName(state.hour);
    queueRender();
  });

  lightDial.addEventListener("change", () => {
    state.hour = Number(lightDial.value);
    lightOutput.textContent = timeName(state.hour);
    window.clearTimeout(state.renderTimer);
    drawMap();
    describeAction(`The map is now lit for ${timeName(state.hour).toLowerCase()}.`);
  });

  mapCanvas.addEventListener("pointermove", (event) => {
    state.hover = canvasPoint(event);
    drawEffects(performance.now());
  });

  mapCanvas.addEventListener("pointerleave", () => {
    state.hover = null;
    drawEffects(performance.now());
  });

  mapCanvas.addEventListener("click", (event) => {
    const point = canvasPoint(event);
    if (point) setPin(point);
  });

  $("#pin-center-button").addEventListener("click", () => {
    setPin({ x: 0.5, y: 0.5 }, "Pinned the centre of this map. This place is yours.");
  });

  shareButton.addEventListener("click", copyShareUrl);
  $("#download-button").addEventListener("click", downloadChart);

  function animate(now) {
    drawEffects(now);
    animationFrame = window.requestAnimationFrame(animate);
  }

  function updateAnimation() {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    if (!reducedMotion.matches && stageIsVisible) {
      animationFrame = window.requestAnimationFrame(animate);
    } else {
      drawEffects(performance.now());
    }
  }

  if ("ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(syncSurface);
    resizeObserver.observe(stage);
  } else {
    window.addEventListener("resize", syncSurface, { passive: true });
  }

  if ("IntersectionObserver" in window) {
    animationObserver = new IntersectionObserver(([entry]) => {
      stageIsVisible = entry.isIntersecting;
      updateAnimation();
    }, { threshold: 0.01 });
    animationObserver.observe(stage);
  }

  const onMotionPreferenceChange = () => updateAnimation();
  if (typeof reducedMotion.addEventListener === "function") {
    reducedMotion.addEventListener("change", onMotionPreferenceChange);
  } else if (typeof reducedMotion.addListener === "function") {
    reducedMotion.addListener(onMotionPreferenceChange);
  }

  loadSharedChart();
  state.seed = hashText(state.memory);
  state.field = makeLandscape(state.seed);
  state.names = makeNames(state.seed);
  lightOutput.textContent = timeName(state.hour);
  updatePageLabels();
  syncSurface();
  updateAnimation();
})();
