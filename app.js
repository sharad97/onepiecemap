/**
 * /app.js
 * One Piece map globe viewer
 *
 * Features
 * - Labels no longer clip into the globe.
 * - Marker placement uses UV coordinates + calibration mode.
 * - Boat restored (WASD/Arrow movement on water with simple land collision).
 * - Wave effect toggles animated ocean waves that stop at land.
 * - Boat upgraded to a smaller, more realistic 3D sailboat.
 * - Boat orientation fixed so the front points in movement direction and stays 3D.
 * - Reverse Mountain auto-routing using captured user-drawn paths.
 * - Path Draw mode retained for future tweaking.
 * - Route 6 added with 2-point animation.
 * - When ship reaches route 6 point 0, it animates to point 1 inside a 3D bubble.
 * - Route 6 now works every time you return to its start point.
 * - Removed incorrect labels: Enies Lobby, Water 7, Twin Cape, Whiskey Peak.
 * - Route 6 animation slowed down.
 * - Labels and dashed route visuals never block ship movement.
 * - Calm Belt added: entering it kills the ship, shows alert, and respawns elsewhere.
 * - Map text / dashed lines are treated as water so ship can pass over them.
 * - Spawn / respawn always starts outside Calm Belt and outside Grand Line.
 *
 * UI update:
 * - Main control HUD is FIXED on screen (top-right).
 * - D-pad is SEPARATE and floats at the bottom.
 * - Buttons no longer follow the ship.
 * - Center-ship button near D-pad always stays visible, even when controls are hidden.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const WORLD_TEXTURE_URL = "./lm93f2q9fqaf1.jpeg";

/** -----------------------------
 * UI (must exist in index.html)
 * ------------------------------ */
const globeEl = document.getElementById("globe");
const toggleLabelsBtn = document.getElementById("toggleLabels");
const toggleRoutesBtn = document.getElementById("toggleRoutes");
const toggleAutoSpinBtn = document.getElementById("toggleAutoSpin");
const resetCameraBtn = document.getElementById("resetCamera");

/** Ship HUD + master toggle + D-pad */
let shipHudEl = document.getElementById("shipHud");
let toggleAllUiBtn = document.getElementById("toggleAllUi");
const controlsPanelEl = document.getElementById("controlsPanel");

const moveUpBtn = document.getElementById("moveUp");
const moveDownBtn = document.getElementById("moveDown");
const moveLeftBtn = document.getElementById("moveLeft");
const moveRightBtn = document.getElementById("moveRight");

const infoCardEl = document.getElementById("infoCard");
const closeCardBtn = document.getElementById("closeCard");
const cardTitleEl = document.getElementById("cardTitle");
const cardSubtitleEl = document.getElementById("cardSubtitle");
const cardDescriptionEl = document.getElementById("cardDescription");

let infoCardTimer = null;

function showCard(item, options = {}) {
  if (!infoCardEl) return;

  const {
    autoHideMs = 0,
  } = options;

  if (infoCardTimer) {
    clearTimeout(infoCardTimer);
    infoCardTimer = null;
  }

  if (cardTitleEl) cardTitleEl.textContent = item.name ?? "";
  if (cardSubtitleEl) cardSubtitleEl.textContent = item.region ?? "";
  if (cardDescriptionEl) cardDescriptionEl.textContent = item.description ?? "";

  infoCardEl.classList.remove("hidden");

  if (autoHideMs > 0) {
    infoCardTimer = setTimeout(() => {
      hideCard();
    }, autoHideMs);
  }
}

function hideCard() {
  if (infoCardTimer) {
    clearTimeout(infoCardTimer);
    infoCardTimer = null;
  }
  infoCardEl?.classList.add("hidden");
}

closeCardBtn?.addEventListener("click", hideCard);

toggleRoutesBtn?.remove();

/** -----------------------------
 * Fixed HUD + floating D-pad layout
 * ------------------------------ */
let floatingDpadEl = null;

let centerShipBtn = null;
let centerShipLerp = 0;

let followShipWhileMoving = true;
let followShipStrength = 0.12;

function centerShipInView(immediate = false, strength = 0.18) {
  if (!boat || !globeGroup || !camera) return;

  const shipWorld = new THREE.Vector3();
  boat.getWorldPosition(shipWorld);

  const shipFlat = shipWorld.clone();
  shipFlat.y = 0;
  if (shipFlat.lengthSq() < 1e-8) return;
  shipFlat.normalize();

  const camFlat = camera.position.clone();
  camFlat.y = 0;
  if (camFlat.lengthSq() < 1e-8) return;
  camFlat.normalize();

  const shipYaw = Math.atan2(shipFlat.x, shipFlat.z);
  const camYaw = Math.atan2(camFlat.x, camFlat.z);
  const deltaYaw = camYaw - shipYaw;

  const deltaQuat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    deltaYaw
  );

  const targetQuat = deltaQuat.multiply(globeGroup.quaternion.clone());

  if (immediate) {
    globeGroup.quaternion.copy(targetQuat);
    globeGroup.userData.targetQuaternion = null;
    centerShipLerp = 0;
    controls.update();
    return;
  }

  globeGroup.userData.targetQuaternion = targetQuat;
  centerShipLerp = strength;
}

function applyFixedUiStyles() {
  const style = document.createElement("style");
  style.id = "fixed-ui-runtime-style";
  style.textContent = `
    #shipHud {
      position: fixed !important;
      top: 16px !important;
      right: 16px !important;
      left: auto !important;
      bottom: auto !important;
      transform: none !important;
      z-index: 30 !important;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      max-width: min(520px, calc(100vw - 32px));
    }

    #shipHud > * {
      pointer-events: auto;
    }

    #toggleAllUi {
      pointer-events: auto !important;
    }

    #controlsPanel {
      margin-top: 0 !important;
    }

    #floatingDpad {
      position: fixed;
      left: 50%;
      bottom: 18px;
      transform: translateX(-50%);
      z-index: 31;
      pointer-events: auto;
      display: grid;
      grid-template-columns: 56px 56px 56px;
      grid-template-rows: 56px 56px 56px;
      gap: 8px;
      justify-content: center;
      align-items: center;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }

    #floatingDpad .dpad-btn {
      width: 56px;
      height: 56px;
      padding: 0;
      border-radius: 16px;
      font-size: 20px;
      line-height: 1;
      touch-action: none;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    #floatingDpad .up { grid-column: 2; grid-row: 1; }
    #floatingDpad .left { grid-column: 1; grid-row: 2; }
    #floatingDpad .center-ship { grid-column: 2; grid-row: 2; }
    #floatingDpad .right { grid-column: 3; grid-row: 2; }
    #floatingDpad .down { grid-column: 2; grid-row: 3; }

    @media (max-width: 900px) {
      #shipHud {
        top: 12px !important;
        right: 12px !important;
        max-width: calc(100vw - 24px);
      }

      #floatingDpad {
        bottom: 14px;
        grid-template-columns: 52px 52px 52px;
        grid-template-rows: 52px 52px 52px;
        gap: 7px;
      }

      #floatingDpad .dpad-btn {
        width: 52px;
        height: 52px;
      }
    }
  `;
  if (!document.getElementById(style.id)) {
    document.head.appendChild(style);
  }
}

function ensureShipHud() {
  if (!shipHudEl) {
    shipHudEl = document.createElement("div");
    shipHudEl.id = "shipHud";
    (globeEl?.parentElement || document.body).appendChild(shipHudEl);
  }

  if (!toggleAllUiBtn) {
    toggleAllUiBtn = document.createElement("button");
    toggleAllUiBtn.id = "toggleAllUi";
    toggleAllUiBtn.type = "button";
    toggleAllUiBtn.textContent = "Hide Controls";
    shipHudEl.appendChild(toggleAllUiBtn);
  }

  shipHudEl.style.position = "fixed";
  shipHudEl.style.top = "16px";
  shipHudEl.style.right = "16px";
  shipHudEl.style.left = "auto";
  shipHudEl.style.bottom = "auto";
  shipHudEl.style.transform = "none";
  shipHudEl.style.pointerEvents = "none";
  shipHudEl.style.zIndex = "30";
}

function buildFloatingDpad() {
  let dpad = document.getElementById("floatingDpad");
  if (!dpad) {
    dpad = document.createElement("div");
    dpad.id = "floatingDpad";
    dpad.setAttribute("aria-label", "Move Ship");
    (document.getElementById("app") || document.body).appendChild(dpad);
  }

  dpad.innerHTML = "";

  const ensureButton = (btn, id, label, cls, text) => {
    if (!btn) {
      const newBtn = document.createElement("button");
      newBtn.id = id;
      newBtn.type = "button";
      newBtn.className = `dpad-btn ${cls}`;
      newBtn.setAttribute("aria-label", label);
      newBtn.textContent = text;
      dpad.appendChild(newBtn);
      return newBtn;
    }

    btn.className = `dpad-btn ${cls}`;
    btn.setAttribute("aria-label", label);
    btn.textContent = text;
    dpad.appendChild(btn);
    return btn;
  };

  const up = ensureButton(moveUpBtn, "moveUp", "Move Up", "up", "▲");
  const left = ensureButton(moveLeftBtn, "moveLeft", "Move Left", "left", "◀");

  centerShipBtn = document.createElement("button");
  centerShipBtn.id = "centerShipBtn";
  centerShipBtn.type = "button";
  centerShipBtn.className = "dpad-btn center-ship";
  centerShipBtn.setAttribute("aria-label", "Show Ship");
  centerShipBtn.title = "Show Ship";
  centerShipBtn.textContent = "◎";
  dpad.appendChild(centerShipBtn);

  const right = ensureButton(moveRightBtn, "moveRight", "Move Right", "right", "▶");
  const down = ensureButton(moveDownBtn, "moveDown", "Move Down", "down", "▼");

  centerShipBtn.addEventListener("click", () => { centerShipInView(false); });

  floatingDpadEl = dpad;
  return { up, left, down, right };
}

function keepHudFixedPosition() {
  if (!shipHudEl) return;
  shipHudEl.style.position = "fixed";
  shipHudEl.style.top = "16px";
  shipHudEl.style.right = "16px";
  shipHudEl.style.left = "auto";
  shipHudEl.style.bottom = "auto";
  shipHudEl.style.transform = "none";
  shipHudEl.style.visibility = "visible";
}

applyFixedUiStyles();
ensureShipHud();
const dpadButtons = buildFloatingDpad();

/** -----------------------------
 * Master hide/show
 * ------------------------------ */
let allUiVisible = true;

function setAllUiVisible(nextVisible) {
  allUiVisible = Boolean(nextVisible);

  if (controlsPanelEl) {
    controlsPanelEl.classList.toggle("hidden", !allUiVisible);
  }

  const allButtons = Array.from(document.querySelectorAll("button"));

  for (const btn of allButtons) {
    if (!toggleAllUiBtn) continue;

    if (btn === toggleAllUiBtn) {
      btn.style.display = "";
      continue;
    }

    if (
      btn === moveUpBtn ||
      btn === moveDownBtn ||
      btn === moveLeftBtn ||
      btn === moveRightBtn ||
      btn === centerShipBtn
    ) {
      btn.style.display = "";
      continue;
    }

    btn.style.display = allUiVisible ? "" : "none";
  }

  if (floatingDpadEl) {
    floatingDpadEl.style.display = "";
  }

  if (toggleAllUiBtn) {
    toggleAllUiBtn.style.display = "";
    toggleAllUiBtn.textContent = allUiVisible ? "Hide Controls" : "Show Controls";
  }
}

toggleAllUiBtn?.addEventListener("click", () => setAllUiVisible(!allUiVisible));

/** -----------------------------
 * D-pad virtual keys
 * ------------------------------ */
const virtualKeys = new Set();

function bindHoldButton(el, keyName) {
  if (!el) return;

  const start = (e) => {
    e.preventDefault();
    virtualKeys.add(keyName);
  };

  const end = (e) => {
    e.preventDefault();
    virtualKeys.delete(keyName);
  };

  el.addEventListener("pointerdown", start, { passive: false });
  el.addEventListener("pointerup", end, { passive: false });
  el.addEventListener("pointercancel", end, { passive: false });
  el.addEventListener("pointerleave", end, { passive: false });
  el.addEventListener("lostpointercapture", end, { passive: false });
}

bindHoldButton(dpadButtons.up, "arrowup");
bindHoldButton(dpadButtons.down, "arrowdown");
bindHoldButton(dpadButtons.left, "arrowleft");
bindHoldButton(dpadButtons.right, "arrowright");

/** Default: hidden */
setAllUiVisible(false);

/** -----------------------------
 * Extra buttons
 * ------------------------------ */
function createButton(label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = toggleLabelsBtn?.className || "";
  btn.textContent = label;
  return btn;
}
function attachButton(btn) {
  const parent =
    toggleLabelsBtn?.parentElement ||
    toggleAutoSpinBtn?.parentElement ||
    resetCameraBtn?.parentElement ||
    document.body;
  parent.appendChild(btn);
}

const terrainToggleBtn = createButton("Terrain: Mask (Collision)");
attachButton(terrainToggleBtn);

const waveToggleBtn = createButton("Wave Effect: OFF");
attachButton(waveToggleBtn);

const calibrateBtn = createButton("Calibrate: OFF");
attachButton(calibrateBtn);

const zoomInBtn = createButton("Zoom +");
const zoomOutBtn = createButton("Zoom -");
attachButton(zoomInBtn);
attachButton(zoomOutBtn);

const pathDrawBtn = createButton("Path Draw: OFF");
attachButton(pathDrawBtn);

const pathClearBtn = createButton("Clear Path");
attachButton(pathClearBtn);

const pathPrintBtn = createButton("Print Paths");
attachButton(pathPrintBtn);

const pathRouteBtn = createButton("Route: 1");
attachButton(pathRouteBtn);

/** -----------------------------
 * Math + geo helpers
 * ------------------------------ */
function degToRad(deg) {
  return (deg * Math.PI) / 180;
}
function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
function wrapLng(lng) {
  let v = lng;
  while (v > 180) v -= 360;
  while (v < -180) v += 360;
  return v;
}
function shortestLngDelta(fromLng, toLng) {
  let d = wrapLng(toLng) - wrapLng(fromLng);
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function lerpLng(a, b, t) {
  return wrapLng(a + shortestLngDelta(a, b) * t);
}
function smoothstep01(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function latLngToVector3(lat, lng, radius) {
  const phi = degToRad(90 - lat);
  const theta = degToRad(lng + 180);

  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);

  return new THREE.Vector3(x, y, z);
}

function vector3ToLatLng(vec) {
  const dir = vec.clone().normalize();
  const lat = radToDeg(Math.asin(clamp(dir.y, -1, 1)));
  const theta = Math.atan2(dir.z, -dir.x);
  const lng = wrapLng(radToDeg(theta) - 180);
  return { lat, lng };
}

function uvToLatLng(u, v) {
  const lat = 90 - clamp(v, 0, 1) * 180;
  const lng = wrapLng(clamp(u, 0, 1) * 360 - 180);
  return { lat, lng };
}
function latLngToUV(lat, lng) {
  const u = (wrapLng(lng) + 180) / 360;
  const v = (90 - clamp(lat, -90, 90)) / 180;
  return { u, v };
}

function distanceLatLngApprox(aLat, aLng, bLat, bLng) {
  const dLat = bLat - aLat;
  const dLng = shortestLngDelta(aLng, bLng);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** -----------------------------
 * Scene setup
 * ------------------------------ */
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
camera.position.set(0, 0, 10);
camera.up.set(0, 1, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
globeEl.appendChild(renderer.domElement);

renderer.domElement.style.position = "absolute";
renderer.domElement.style.inset = "0";
renderer.domElement.style.width = "100%";
renderer.domElement.style.height = "100%";

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.minDistance = 3.2;
controls.maxDistance = 22;
controls.enableDamping = true;
controls.zoomSpeed = 1.0;
controls.dampingFactor = 0.06;
controls.enableZoom = true;

function zoomCamera(factor) {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  const dist = dir.length();
  const nextDist = clamp(dist * factor, controls.minDistance, controls.maxDistance);
  dir.setLength(nextDist);
  camera.position.copy(controls.target).add(dir);
  controls.update();
}

const ambient = new THREE.AmbientLight(0xffffff, 1.15);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
dirLight.position.set(7, 6, 5);
scene.add(dirLight);

const globeGroup = new THREE.Group();
scene.add(globeGroup);

/* Fix map orientation so north is up */
globeGroup.rotation.y = Math.PI;

/** -----------------------------
 * Globe mesh
 * ------------------------------ */
const globeRadius = 2.6;

const globeMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.92,
  metalness: 0.0,
});

let globeMesh = new THREE.Mesh(
  new THREE.SphereGeometry(globeRadius, 64, 64),
  globeMaterial
);
globeGroup.add(globeMesh);

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(globeRadius * 1.06, 64, 64),
  new THREE.MeshBasicMaterial({
    color: 0x6fb0ff,
    transparent: true,
    opacity: 0.09,
    depthWrite: false,
  })
);
atmosphere.renderOrder = 0;
globeGroup.add(atmosphere);

/** -----------------------------
 * Texture loader
 * ------------------------------ */
function loadWorldTexture(url) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(url, (tex) => resolve(tex), undefined, (err) => reject(err));
  });
}

/** -----------------------------
 * Terrain (mask + height)
 * ------------------------------ */
let terrainReady = false;
let texW = 0;
let texH = 0;
let landMask = null;
let heightMap = null;

const TERRAIN = {
  maxLandElevation: 0.10,
  maxWaterDepth: 0.03,
  boatClearance: 0.055,
  blueBias: 1.06,
  blurRadiusPx: 3,
};

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function blurHeightMap(input, w, h, radiusPx) {
  const r = Math.max(0, Math.floor(radiusPx));
  if (r === 0) return input;

  const tmp = new Float32Array(input.length);
  const out = new Float32Array(input.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dx = -r; dx <= r; dx++) {
        const xx = clamp(x + dx, 0, w - 1);
        sum += input[y * w + xx];
        count++;
      }
      tmp[y * w + x] = sum / count;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = clamp(y + dy, 0, h - 1);
        sum += tmp[yy * w + x];
        count++;
      }
      out[y * w + x] = sum / count;
    }
  }

  return out;
}

function buildMaskAndHeightFromImage(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  texW = canvas.width;
  texH = canvas.height;

  landMask = new Uint8Array(texW * texH);
  heightMap = new Float32Array(texW * texH);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const { h, s, v } = rgbToHsv(r, g, b);

    const blueDominant = b > r * TERRAIN.blueBias && b > g * TERRAIN.blueBias;
    const veryDark = v < 0.20;

    const looksLikeWater =
      veryDark ||
      blueDominant ||
      (h >= 150 && h <= 255 && s >= 0.04 && v >= 0.05);

    const likelyMapTextOrDash =
      !blueDominant &&
      ((v < 0.34 && s < 0.50) ||
        (v < 0.42 && b < 150 && r < 170 && g < 170));

    const islandColorLike =
      (s >= 0.12 && v >= 0.18) ||
      (r > 70 && g > 55 && b < 170) ||
      (r > 95 && g > 90 && b < 140);

    const isLand = !looksLikeWater && !likelyMapTextOrDash && islandColorLike;

    landMask[p] = isLand ? 1 : 0;

    if (isLand) {
      const nonBlue = (r + g) / (2 * 255);
      const hNorm = clamp(0.10 + 0.90 * (0.60 * v + 0.40 * nonBlue), 0, 1);
      heightMap[p] = TERRAIN.maxLandElevation * hNorm;
    } else {
      heightMap[p] = -TERRAIN.maxWaterDepth * 0.35;
    }
  }

  if (TERRAIN.blurRadiusPx > 0) {
    heightMap = blurHeightMap(heightMap, texW, texH, TERRAIN.blurRadiusPx);
  }

  terrainReady = true;
}

function sampleMask(lat, lng) {
  if (!terrainReady || !landMask) return 0;
  const { u, v } = latLngToUV(lat, lng);
  const x = clamp(Math.round(u * (texW - 1)), 0, texW - 1);
  const y = clamp(Math.round(v * (texH - 1)), 0, texH - 1);
  return landMask[y * texW + x];
}

function sampleMapColor(lat, lng) {
  if (!terrainReady || !texture?.image) return null;

  const canvas = document.createElement("canvas");
  canvas.width = texture.image.width;
  canvas.height = texture.image.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(texture.image, 0, 0);

  const { u, v } = latLngToUV(lat, lng);
  const x = clamp(Math.round(u * (canvas.width - 1)), 0, canvas.width - 1);
  const y = clamp(Math.round(v * (canvas.height - 1)), 0, canvas.height - 1);

  const pixel = ctx.getImageData(x, y, 1, 1).data;
  return { r: pixel[0], g: pixel[1], b: pixel[2] };
}

function isCalmBeltWaterAt(lat, lng) {
  if (!isInsideCalmBelt(lat, 0)) return false;
  if (sampleMask(lat, lng) === 1) return false;

  const color = sampleMapColor(lat, lng);
  if (!color) return false;

  const { r, g, b } = color;

  // Calm Belt tends to be lighter / greener / less deep-blue than normal ocean
  const greenish = g > 95 && b > 95;
  const notDeepOcean = !(b > r * 1.18 && b > g * 1.18);

  return greenish && notDeepOcean;
}

function sampleElevation(lat, lng) {
  if (!terrainReady || !heightMap) return 0;

  const { u, v } = latLngToUV(lat, lng);
  const fx = u * (texW - 1);
  const fy = v * (texH - 1);

  const x0 = clamp(Math.floor(fx), 0, texW - 1);
  const y0 = clamp(Math.floor(fy), 0, texH - 1);
  const x1 = clamp(x0 + 1, 0, texW - 1);
  const y1 = clamp(y0 + 1, 0, texH - 1);

  const tx = fx - x0;
  const ty = fy - y0;

  const i00 = y0 * texW + x0;
  const i10 = y0 * texW + x1;
  const i01 = y1 * texW + x0;
  const i11 = y1 * texW + x1;

  const a = heightMap[i00] * (1 - tx) + heightMap[i10] * tx;
  const b = heightMap[i01] * (1 - tx) + heightMap[i11] * tx;
  return a * (1 - ty) + b * ty;
}

let displacedGeometry = null;

function buildDisplacedSphereGeometry(baseRadius, widthSegments, heightSegments) {
  const geom = new THREE.SphereGeometry(baseRadius, widthSegments, heightSegments);
  const pos = geom.attributes.position;

  const dir = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();

    const lat = radToDeg(Math.asin(dir.y));
    const theta = Math.atan2(dir.z, -dir.x);
    let lng = radToDeg(theta) - 180;
    lng = wrapLng(lng);

    const elev = sampleElevation(lat, lng);
    const r = baseRadius + elev;

    pos.setXYZ(i, dir.x * r, dir.y * r, dir.z * r);
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

/** -----------------------------
 * Terrain mode toggle
 * ------------------------------ */
const TerrainMode = Object.freeze({
  MASK: "mask",
  HEIGHT: "height",
});
let terrainMode = TerrainMode.MASK;

function setTerrainMode(nextMode) {
  terrainMode = nextMode;

  if (terrainMode === TerrainMode.MASK) {
    terrainToggleBtn.textContent = "Terrain: Mask (Collision)";
    if (displacedGeometry) {
      globeMesh.geometry.dispose();
      globeMesh.geometry = new THREE.SphereGeometry(globeRadius, 64, 64);
    }
    return;
  }

  terrainToggleBtn.textContent = "Terrain: Height (3D Land)";
  if (!terrainReady) return;

  if (!displacedGeometry) {
    displacedGeometry = buildDisplacedSphereGeometry(globeRadius, 256, 192);
  }
  globeMesh.geometry.dispose();
  globeMesh.geometry = displacedGeometry;
}

terrainToggleBtn.addEventListener("click", () => {
  setTerrainMode(terrainMode === TerrainMode.MASK ? TerrainMode.HEIGHT : TerrainMode.MASK);
});

/** -----------------------------
 * Load texture + derive terrain maps
 * ------------------------------ */
const texture = await loadWorldTexture(WORLD_TEXTURE_URL);
texture.colorSpace = THREE.SRGBColorSpace;
texture.wrapS = THREE.ClampToEdgeWrapping;
texture.wrapT = THREE.ClampToEdgeWrapping;
texture.needsUpdate = true;

globeMaterial.map = texture;
globeMaterial.needsUpdate = true;

if (texture.image) buildMaskAndHeightFromImage(texture.image);
setTerrainMode(TerrainMode.HEIGHT);

/** -----------------------------
 * Wave effect
 * ------------------------------ */
let waveMesh = null;
let waveEnabled = false;
let waveTime = 0;
let landMaskTexture = null;

if (terrainReady && landMask) {
  const landMaskData = new Uint8Array(texW * texH);
  for (let i = 0; i < landMask.length; i++) {
    landMaskData[i] = landMask[i] * 255;
  }

  landMaskTexture = new THREE.DataTexture(
    landMaskData,
    texW,
    texH,
    THREE.RedFormat,
    THREE.UnsignedByte
  );
  landMaskTexture.needsUpdate = true;
  landMaskTexture.minFilter = THREE.LinearFilter;
  landMaskTexture.magFilter = THREE.LinearFilter;
  landMaskTexture.wrapS = THREE.ClampToEdgeWrapping;
  landMaskTexture.wrapT = THREE.ClampToEdgeWrapping;

  const waveMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      landMask: { value: landMaskTexture },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D landMask;
      uniform float time;
      varying vec2 vUv;

      void main() {
        float land = texture2D(landMask, vUv).r;
        if (land > 0.5) discard;

        float wave1 = sin(vUv.x * 30.0 + time * 4.0) * sin(vUv.y * 20.0 + time * 3.0);
        float wave2 = sin(vUv.x * 15.0 - time * 2.0) * cos(vUv.y * 25.0 + time * 2.5);
        float intensity = (wave1 * 0.5 + 0.5) * (wave2 * 0.3 + 0.3);
        intensity = clamp(intensity, 0.2, 0.8);

        vec3 color = mix(vec3(0.6, 0.8, 1.0), vec3(1.0, 1.0, 1.0), intensity);
        gl_FragColor = vec4(color, intensity * 0.5);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const waveGeometry = new THREE.SphereGeometry(globeRadius + 0.02, 128, 128);
  waveMesh = new THREE.Mesh(waveGeometry, waveMaterial);
  waveMesh.renderOrder = 10;
  waveMesh.raycast = function () {};
  waveMesh.visible = false;
  globeGroup.add(waveMesh);
}

waveToggleBtn.addEventListener("click", () => {
  waveEnabled = !waveEnabled;
  if (waveMesh) waveMesh.visible = waveEnabled;
  waveToggleBtn.textContent = waveEnabled ? "Wave Effect: ON" : "Wave Effect: OFF";
});

waveEnabled = true;
if (waveMesh) waveMesh.visible = true;
waveToggleBtn.textContent = "Wave Effect: ON";

/** -----------------------------
 * Labels + markers
 * ------------------------------ */
const LABEL_ALTITUDE = 0.32;
const MARKER_ALTITUDE = 0.05;

const locations = [
  {
    name: "Reverse Mountain",
    region: "Red Line",
    uv: { u: 0.50, v: 0.50 },
    description: "Gateway to the Grand Line.",
  },
  {
    name: "Lodestar Island",
    region: "New World",
    uv: { u: 0.44, v: 0.50 }, // adjust if needed to match your map
    description: "The final island reachable by following the Log Pose.",
  },
];

function ensureLatLng(loc) {
  if (typeof loc.lat === "number" && typeof loc.lng === "number") return;
  const { lat, lng } = uvToLatLng(loc.uv.u, loc.uv.v);
  loc.lat = lat;
  loc.lng = lng;
}

const markerGroup = new THREE.Group();
globeGroup.add(markerGroup);

const labelGroup = new THREE.Group();
globeGroup.add(labelGroup);

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function makeSpriteLabel(text) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const pad = 12;
  const fontSize = 34;
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto`;
  const metrics = ctx.measureText(text);
  const w = Math.ceil(metrics.width + pad * 2);
  const h = Math.ceil(fontSize + pad * 1.6);

  canvas.width = w;
  canvas.height = h;

  const ctx2 = canvas.getContext("2d");
  if (!ctx2) return null;

  ctx2.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto`;
  ctx2.textBaseline = "middle";
  ctx2.fillStyle = "rgba(8, 14, 27, 0.78)";
  ctx2.strokeStyle = "rgba(255,255,255,0.18)";
  ctx2.lineWidth = 3;

  const r = 18;
  roundRect(ctx2, 0, 0, w, h, r);
  ctx2.fill();
  ctx2.stroke();

  ctx2.fillStyle = "#eef4ff";
  ctx2.fillText(text, pad, h / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  mat.depthTest = false;
  mat.depthWrite = false;

  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 999;
  sprite.scale.set(0.9 * (w / 220), 0.28 * (h / 70), 1);
  return sprite;
}

function positionForLoc(loc, extraRadius) {
  ensureLatLng(loc);
  const elev = terrainReady ? sampleElevation(loc.lat, loc.lng) : 0;
  return latLngToVector3(loc.lat, loc.lng, globeRadius + elev + extraRadius);
}

function addMarker(loc) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffcc66,
    roughness: 0.4,
    metalness: 0.1,
    emissive: 0x221100,
    emissiveIntensity: 0.25,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), mat);
  mesh.position.copy(positionForLoc(loc, MARKER_ALTITUDE));
  mesh.userData = { type: "marker", loc };
  mesh.renderOrder = 50;
  markerGroup.add(mesh);

  const label = makeSpriteLabel(loc.name);
  if (label) {
    label.position.copy(positionForLoc(loc, LABEL_ALTITUDE));
    label.userData = { type: "label", loc };
    label.raycast = function () {};
    labelGroup.add(label);
  }

  loc.__markerMesh = mesh;
  loc.__labelSprite = label;
}

function refreshLocMeshes(loc) {
  if (loc.__markerMesh) {
    loc.__markerMesh.position.copy(positionForLoc(loc, MARKER_ALTITUDE));
  }
  if (loc.__labelSprite) {
    loc.__labelSprite.position.copy(positionForLoc(loc, LABEL_ALTITUDE));
  }
}

for (const loc of locations) addMarker(loc);

/** -----------------------------
 * Label visibility toggle
 * ------------------------------ */
let labelsVisible = false;
labelGroup.visible = false;
if (toggleLabelsBtn) toggleLabelsBtn.textContent = "Show Labels";

toggleLabelsBtn?.addEventListener("click", () => {
  labelsVisible = !labelsVisible;
  labelGroup.visible = labelsVisible;
  toggleLabelsBtn.textContent = labelsVisible ? "Hide Labels" : "Show Labels";
});

/** -----------------------------
 * Marker calibration
 * ------------------------------ */
let calibrateMode = false;
let selectedLoc = null;

calibrateBtn.addEventListener("click", () => {
  calibrateMode = !calibrateMode;
  calibrateBtn.textContent = calibrateMode ? "Calibrate: ON" : "Calibrate: OFF";
  if (!calibrateMode) selectedLoc = null;
});

function setSelectedLoc(loc) {
  selectedLoc = loc;
  if (loc) {
    showCard({
      name: `Selected: ${loc.name}`,
      region: loc.region,
      description:
        "Calibration ON: click the globe to move this marker. UV will be printed in console.",
    });
  }
}

/** -----------------------------
 * Captured paths
 * ------------------------------ */
const CAPTURED_REVERSE_PATHS = {
  "1": [
    { u: 0.5358, v: 0.6354, lat: -24.3671, lng: 12.8785 },
    { u: 0.5332, v: 0.629, lat: -23.2273, lng: 11.9445 },
    { u: 0.5309, v: 0.623, lat: -22.1412, lng: 11.1318 },
    { u: 0.5295, v: 0.6194, lat: -21.4937, lng: 10.6142 },
    { u: 0.527, v: 0.6105, lat: -19.8853, lng: 9.7107 },
    { u: 0.5136, v: 0.5712, lat: -12.8136, lng: 4.9092 },
    { u: 0.5136, v: 0.5712, lat: -12.8136, lng: 4.9092 },
    { u: 0.504, v: 0.5405, lat: -7.2899, lng: 1.4378 },
    { u: 0.497, v: 0.5211, lat: -3.7975, lng: -1.0683 },
    { u: 0.4958, v: 0.5147, lat: -2.6397, lng: -1.5193 },
  ],
  "2": [
    { u: 0.529, v: 0.3711, lat: 23.1945, lng: 10.4415 },
    { u: 0.5241, v: 0.3853, lat: 20.6518, lng: 8.6716 },
    { u: 0.5209, v: 0.3962, lat: 18.6898, lng: 7.5249 },
    { u: 0.516, v: 0.4149, lat: 15.3182, lng: 5.7498 },
    { u: 0.5111, v: 0.4334, lat: 11.9884, lng: 3.9849 },
    { u: 0.5059, v: 0.4538, lat: 8.3241, lng: 2.1298 },
    { u: 0.5014, v: 0.4739, lat: 4.6944, lng: 0.5175 },
    { u: 0.4979, v: 0.4918, lat: 1.4787, lng: -0.7695 },
    { u: 0.4968, v: 0.4953, lat: 0.8484, lng: -1.149 },
    { u: 0.4958, v: 0.4995, lat: 0.0917, lng: -1.5287 },
  ],
  "3": [
    { u: 0.4419, v: 0.3159, lat: 33.1365, lng: -20.908 },
    { u: 0.4512, v: 0.3496, lat: 27.0742, lng: -17.5726 },
    { u: 0.4552, v: 0.3621, lat: 24.8138, lng: -16.143 },
    { u: 0.461, v: 0.3888, lat: 20.0168, lng: -14.0339 },
    { u: 0.4644, v: 0.3979, lat: 18.3856, lng: -12.8029 },
    { u: 0.4678, v: 0.4102, lat: 16.168, lng: -11.6007 },
    { u: 0.4705, v: 0.4194, lat: 14.509, lng: -10.6245 },
    { u: 0.4717, v: 0.4261, lat: 13.2952, lng: -10.1776 },
    { u: 0.4753, v: 0.4416, lat: 10.5184, lng: -8.9059 },
    { u: 0.4779, v: 0.4491, lat: 9.1553, lng: -7.9703 },
    { u: 0.4801, v: 0.4577, lat: 7.6149, lng: -7.1758 },
    { u: 0.4817, v: 0.4669, lat: 5.9611, lng: -6.5921 },
    { u: 0.4851, v: 0.4764, lat: 4.2569, lng: -5.3793 },
    { u: 0.4854, v: 0.4809, lat: 3.4377, lng: -5.251 },
    { u: 0.4873, v: 0.4879, lat: 2.1774, lng: -4.5571 },
    { u: 0.4889, v: 0.4939, lat: 1.1054, lng: -3.9887 },
    { u: 0.4903, v: 0.4963, lat: 0.6632, lng: -3.4843 },
  ],
  "4": [
    { u: 0.4434, v: 0.6748, lat: -31.465, lng: -20.3598 },
    { u: 0.4552, v: 0.6439, lat: -25.9082, lng: -16.1158 },
    { u: 0.4613, v: 0.6195, lat: -21.5184, lng: -13.9426 },
    { u: 0.4656, v: 0.6044, lat: -18.7882, lng: -12.3918 },
    { u: 0.4693, v: 0.5894, lat: -16.086, lng: -11.0429 },
    { u: 0.4745, v: 0.5705, lat: -12.6925, lng: -9.1816 },
    { u: 0.4791, v: 0.5539, lat: -9.6934, lng: -7.5105 },
    { u: 0.4818, v: 0.5456, lat: -8.1993, lng: -6.5672 },
    { u: 0.4841, v: 0.5363, lat: -6.5423, lng: -5.7148 },
    { u: 0.4879, v: 0.5266, lat: -4.7907, lng: -4.3728 },
    { u: 0.4931, v: 0.5029, lat: -0.5199, lng: -2.4757 },
  ],
  "5": [
    { u: 0.4935, v: 0.5092, lat: -1.6627, lng: -2.3275 },
    { u: 0.558, v: 0.5068, lat: -1.2179, lng: 20.889 },
  ],
  "6": [
    { u: 0.7949, v: 0.4876, lat: -2.2396, lng: 166.1182 },
    { u: 0.8663, v: 0.4997, lat: -0.0593, lng: -168.1614 },
  ],
};

/** -----------------------------
 * Path drawing
 * ------------------------------ */
let pathDrawMode = false;
let activeRouteKey = "1";

function dedupePathPoints(points, minDistDeg = 0.35) {
  const cleaned = [];
  for (const p of points) {
    if (!cleaned.length) {
      cleaned.push({ ...p });
      continue;
    }
    const last = cleaned[cleaned.length - 1];
    if (distanceLatLngApprox(last.lat, last.lng, p.lat, p.lng) >= minDistDeg) {
      cleaned.push({ ...p });
    }
  }
  return cleaned;
}

const reversePathData = {
  "1": dedupePathPoints(CAPTURED_REVERSE_PATHS["1"]),
  "2": dedupePathPoints(CAPTURED_REVERSE_PATHS["2"]),
  "3": dedupePathPoints(CAPTURED_REVERSE_PATHS["3"]),
  "4": dedupePathPoints(CAPTURED_REVERSE_PATHS["4"]),
  "5": dedupePathPoints(CAPTURED_REVERSE_PATHS["5"], 0.05),
  "6": dedupePathPoints(CAPTURED_REVERSE_PATHS["6"], 0.01),
};

const reversePathMeta = {
  "1": { name: "Top Left -> Center", color: 0xff5555 },
  "2": { name: "Top Right -> Center", color: 0x55ff99 },
  "3": { name: "Bottom Left -> Center", color: 0x55aaff },
  "4": { name: "Bottom Right -> Center", color: 0xffcc55 },
  "5": { name: "Center -> Grand Line", color: 0xffffff },
  "6": { name: "Bubble Jump Route", color: 0xff66ff },
};

const reversePathDotsGroup = new THREE.Group();
globeGroup.add(reversePathDotsGroup);

const reversePathLinesGroup = new THREE.Group();
globeGroup.add(reversePathLinesGroup);

function disposeGroupChildren(group) {
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose?.());
      } else {
        child.material.dispose?.();
      }
    }
  }
}

function refreshReversePathVisuals() {
  disposeGroupChildren(reversePathDotsGroup);
  disposeGroupChildren(reversePathLinesGroup);

  for (const key of Object.keys(reversePathData)) {
    const pts = reversePathData[key];
    const color = reversePathMeta[key].color;

    for (const pt of pts) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(key === "6" ? 0.028 : 0.018, 12, 12),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: key === "6" ? 0.45 : 0.25,
          roughness: 0.45,
          metalness: 0.05,
        })
      );

      if (pt.worldPoint) {
        dot.position.copy(pt.worldPoint);
      } else {
        dot.position.copy(
          latLngToVector3(
            pt.lat,
            pt.lng,
            globeRadius + sampleElevation(pt.lat, pt.lng) + 0.03
          )
        );
      }

      dot.renderOrder = 120;
      dot.raycast = function () {};
      reversePathDotsGroup.add(dot);
    }

    if (pts.length >= 2) {
      const linePoints = pts.map((pt) => {
        if (pt.worldPoint) return pt.worldPoint.clone();
        return latLngToVector3(
          pt.lat,
          pt.lng,
          globeRadius + sampleElevation(pt.lat, pt.lng) + 0.028
        );
      });

      const geom = new THREE.BufferGeometry().setFromPoints(linePoints);
      const line = new THREE.Line(
        geom,
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: key === "6" ? 1.0 : 0.95,
          depthWrite: false,
        })
      );
      line.renderOrder = 110;
      line.raycast = function () {};
      reversePathLinesGroup.add(line);
    }
  }
}

refreshReversePathVisuals();

function cycleActiveRoute() {
  const keys = ["1", "2", "3", "4", "5", "6"];
  const idx = keys.indexOf(activeRouteKey);
  activeRouteKey = keys[(idx + 1) % keys.length];
  pathRouteBtn.textContent = `Route: ${activeRouteKey}`;
  showCard({
    name: `Path Route ${activeRouteKey}`,
    region: reversePathMeta[activeRouteKey].name,
    description: "Path Draw is ON. Click the globe to add dots for this route.",
  });
}

pathDrawBtn.addEventListener("click", () => {
  pathDrawMode = !pathDrawMode;
  pathDrawBtn.textContent = pathDrawMode ? "Path Draw: ON" : "Path Draw: OFF";

  showCard({
    name: "Path Draw",
    region: reversePathMeta[activeRouteKey].name,
    description: pathDrawMode
      ? "Click the globe to place dots. Use Route button to switch 1..6. Press Z to undo. Print Paths when done."
      : "Path drawing turned off.",
  });
});

pathRouteBtn.addEventListener("click", cycleActiveRoute);

pathClearBtn.addEventListener("click", () => {
  reversePathData[activeRouteKey] = [];
  refreshReversePathVisuals();
  showCard({
    name: "Path Cleared",
    region: reversePathMeta[activeRouteKey].name,
    description: `Cleared all dots for route ${activeRouteKey}.`,
  });
});

pathPrintBtn.addEventListener("click", () => {
  const printable = {};
  for (const key of Object.keys(reversePathData)) {
    printable[key] = reversePathData[key].map((p) => ({
      u: Number((p.u ?? 0).toFixed(4)),
      v: Number((p.v ?? 0).toFixed(4)),
      lat: Number(p.lat.toFixed(4)),
      lng: Number(p.lng.toFixed(4)),
    }));
  }

  console.log("REVERSE_MOUNTAIN_DRAWN_PATHS =", printable);

  showCard({
    name: "Paths Printed",
    region: "Console",
    description: "Current paths were printed to console.",
  });
});

window.addEventListener("keydown", (e) => {
  if (
    e.key === "1" ||
    e.key === "2" ||
    e.key === "3" ||
    e.key === "4" ||
    e.key === "5" ||
    e.key === "6"
  ) {
    if (pathDrawMode) {
      activeRouteKey = e.key;
      pathRouteBtn.textContent = `Route: ${activeRouteKey}`;
      showCard({
        name: `Path Route ${activeRouteKey}`,
        region: reversePathMeta[activeRouteKey].name,
        description: "Now drawing this route.",
      });
    }
  }

  if (e.key.toLowerCase() === "z" && pathDrawMode) {
    reversePathData[activeRouteKey].pop();
    refreshReversePathVisuals();
  }
});

/** -----------------------------
 * Picking
 * ------------------------------ */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let dragging = false;

function setPointerFromEvent(ev) {
  const rect = renderer.domElement.getBoundingClientRect();

  let clientX = ev.clientX;
  let clientY = ev.clientY;

  if ((clientX == null || clientY == null) && ev.touches && ev.touches.length > 0) {
    clientX = ev.touches[0].clientX;
    clientY = ev.touches[0].clientY;
  }

  if ((clientX == null || clientY == null) && ev.changedTouches && ev.changedTouches.length > 0) {
    clientX = ev.changedTouches[0].clientX;
    clientY = ev.changedTouches[0].clientY;
  }

  if (clientX == null || clientY == null) return false;

  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((clientY - rect.top) / rect.height) * 2 - 1);

  pointer.set(x, y);
  return true;
}

function onPointerDown(ev) {
  dragging = false;
  setPointerFromEvent(ev);
}
function onPointerMove() {
  dragging = true;
}

function tryPickMarker() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(markerGroup.children, false);
  return hits.length ? hits[0].object.userData.loc : null;
}

function tryPickGlobeHit() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(globeMesh, false);
  if (!hits.length) return null;

  const hit = hits[0];
  if (!hit.uv || !hit.point) return null;

  return {
    u: hit.uv.x,
    v: hit.uv.y,
    point: hit.point.clone(),
  };
}

function onPointerUp(ev) {
  if (dragging) return;
  if (!setPointerFromEvent(ev)) return;

  if (pathDrawMode) {
    const hit = tryPickGlobeHit();
    if (!hit) return;

    const { lat, lng } = vector3ToLatLng(hit.point);
    const worldPoint = hit.point
      .clone()
      .normalize()
      .multiplyScalar(globeRadius + sampleElevation(lat, lng) + 0.03);

    const point = {
      u: hit.u,
      v: hit.v,
      lat,
      lng,
      worldPoint,
    };

    reversePathData[activeRouteKey].push(point);
    reversePathData[activeRouteKey] = dedupePathPoints(
      reversePathData[activeRouteKey],
      activeRouteKey === "5" ? 0.05 : activeRouteKey === "6" ? 0.01 : 0.2
    );
    refreshReversePathVisuals();

    console.log(`Route ${activeRouteKey} dot:`, {
      u: Number(point.u.toFixed(4)),
      v: Number(point.v.toFixed(4)),
      lat: Number(point.lat.toFixed(4)),
      lng: Number(point.lng.toFixed(4)),
    });

    showCard({
      name: `Dot Added: Route ${activeRouteKey}`,
      region: reversePathMeta[activeRouteKey].name,
      description: `u=${point.u.toFixed(4)}, v=${point.v.toFixed(4)}, lat=${point.lat.toFixed(
        2
      )}, lng=${point.lng.toFixed(2)}`,
    });
    return;
  }

  const markerLoc = tryPickMarker();
  if (markerLoc) {
    if (calibrateMode) {
      setSelectedLoc(markerLoc);
      return;
    }
    showCard(markerLoc);
    return;
  }

  if (!calibrateMode) return;

  const hit = tryPickGlobeHit();
  if (!hit) return;

  console.log("Clicked UV:", {
    u: Number(hit.u.toFixed(4)),
    v: Number(hit.v.toFixed(4)),
  });

  if (!selectedLoc) {
    showCard({
      name: "Calibration",
      region: "",
      description: `UV: u=${hit.u.toFixed(4)}, v=${hit.v.toFixed(4)}. Click a marker first to select it.`,
    });
    return;
  }

  selectedLoc.uv = { u: hit.u, v: hit.v };
  const { lat, lng } = vector3ToLatLng(hit.point);
  selectedLoc.lat = lat;
  selectedLoc.lng = lng;

  refreshLocMeshes(selectedLoc);

  showCard({
    name: `Updated: ${selectedLoc.name}`,
    region: selectedLoc.region,
    description: `Saved UV: u=${hit.u.toFixed(4)}, v=${hit.v.toFixed(4)} (lat=${lat.toFixed(
      2
    )}, lng=${lng.toFixed(2)}). Copy these into locations[].`,
  });
}

renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerup", onPointerUp);

renderer.domElement.addEventListener("touchstart", onPointerDown, { passive: true });
renderer.domElement.addEventListener("touchmove", onPointerMove, { passive: true });
renderer.domElement.addEventListener("touchend", onPointerUp, { passive: true });

/** -----------------------------
 * Boat
 * ------------------------------ */
const boatGroup = new THREE.Group();
globeGroup.add(boatGroup);

function createBoatMesh() {
  const boatRoot = new THREE.Group();

  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x8a5a34,
    roughness: 0.8,
    metalness: 0.05,
  });

  const darkWoodMat = new THREE.MeshStandardMaterial({
    color: 0x5f3c22,
    roughness: 0.85,
    metalness: 0.02,
  });

  const sailMat = new THREE.MeshStandardMaterial({
    color: 0xf5f1df,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const mastMat = new THREE.MeshStandardMaterial({
    color: 0xd5c1a2,
    roughness: 0.8,
    metalness: 0.0,
  });

  const ropeMat = new THREE.MeshStandardMaterial({
    color: 0xb89b6a,
    roughness: 1.0,
    metalness: 0.0,
  });

  const hull = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.038, 0.11, 6, 12),
    woodMat
  );
  hull.rotation.x = Math.PI / 2;
  hull.scale.set(0.9, 0.55, 1.5);
  boatRoot.add(hull);

  const keel = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.03, 0.12),
    darkWoodMat
  );
  keel.position.set(0, -0.022, -0.004);
  boatRoot.add(keel);

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.008, 0.13),
    new THREE.MeshStandardMaterial({
      color: 0xc49b6b,
      roughness: 0.9,
      metalness: 0.0,
    })
  );
  deck.position.set(0, 0.02, 0);
  boatRoot.add(deck);

  const bow = new THREE.Mesh(
    new THREE.ConeGeometry(0.024, 0.05, 10),
    woodMat
  );
  bow.rotation.x = Math.PI / 2;
  bow.position.set(0, 0.004, 0.105);
  boatRoot.add(bow);

  const stern = new THREE.Mesh(
    new THREE.BoxGeometry(0.042, 0.04, 0.018),
    darkWoodMat
  );
  stern.position.set(0, 0.006, -0.09);
  boatRoot.add(stern);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 0.025, 0.035),
    new THREE.MeshStandardMaterial({
      color: 0xf1e1bd,
      roughness: 0.95,
      metalness: 0.0,
    })
  );
  cabin.position.set(0, 0.034, -0.02);
  boatRoot.add(cabin);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.005, 0.14, 8),
    mastMat
  );
  mast.position.set(0, 0.09, 0.012);
  boatRoot.add(mast);

  const yard = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0025, 0.0025, 0.08, 6),
    mastMat
  );
  yard.rotation.z = Math.PI / 2;
  yard.position.set(0, 0.11, 0.01);
  boatRoot.add(yard);

  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0.055);
  sailShape.lineTo(0.045, 0.03);
  sailShape.lineTo(0.03, -0.045);
  sailShape.lineTo(0, -0.055);
  sailShape.closePath();

  const sailGeom = new THREE.ShapeGeometry(sailShape);

  const sailLeft = new THREE.Mesh(sailGeom, sailMat);
  sailLeft.position.set(0.002, 0.09, 0.015);
  sailLeft.rotation.y = Math.PI / 2;
  boatRoot.add(sailLeft);

  const sailRight = sailLeft.clone();
  sailRight.position.x = -0.002;
  sailRight.rotation.y = -Math.PI / 2;
  boatRoot.add(sailRight);

  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.024, 0.015),
    new THREE.MeshStandardMaterial({
      color: 0xd63434,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide,
    })
  );
  flag.position.set(0.014, 0.145, 0.012);
  flag.rotation.y = Math.PI / 2;
  boatRoot.add(flag);

  const rudder = new THREE.Mesh(
    new THREE.BoxGeometry(0.006, 0.028, 0.02),
    darkWoodMat
  );
  rudder.position.set(0, -0.01, -0.108);
  boatRoot.add(rudder);

  const rope1 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0012, 0.0012, 0.10, 5),
    ropeMat
  );
  rope1.position.set(0.015, 0.095, 0.01);
  rope1.rotation.z = degToRad(20);
  rope1.rotation.x = degToRad(85);
  boatRoot.add(rope1);

  const rope2 = rope1.clone();
  rope2.position.x = -0.015;
  rope2.rotation.z = -degToRad(20);
  boatRoot.add(rope2);

  boatRoot.scale.setScalar(0.72);
  boatRoot.position.y = 0.01;
  boatRoot.renderOrder = 60;

  return boatRoot;
}

const boat = createBoatMesh();
boatGroup.add(boat);

const BOAT_MODEL_CORRECTION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(0, 0, 0)
);

/** bubble around boat during route 6 */
const boatBubble = new THREE.Mesh(
  new THREE.SphereGeometry(0.16, 24, 24),
  new THREE.MeshPhysicalMaterial({
    color: 0x88ddff,
    transparent: true,
    opacity: 0.22,
    transmission: 0.7,
    roughness: 0.05,
    metalness: 0.0,
    thickness: 0.25,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
);
boatBubble.visible = false;
boatBubble.renderOrder = 80;
boatGroup.add(boatBubble);

/** wake trail behind boat */
const boatWakeGroup = new THREE.Group();
boatWakeGroup.renderOrder = 79;
globeGroup.add(boatWakeGroup);

const boatWakeParticles = [];
const BOAT_WAKE_MAX = 24;

for (let i = 0; i < BOAT_WAKE_MAX; i++) {
  const wake = new THREE.Mesh(
    new THREE.PlaneGeometry(0.075, 0.03),
    new THREE.MeshBasicMaterial({
      color: 0xeafcff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );

  wake.visible = false;
  wake.userData = {
    life: 0,
    maxLife: 0.7,
    driftSide: 0,
    driftBack: 0,
    normal: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    bitangent: new THREE.Vector3(),
    baseScaleX: 1,
    baseScaleY: 1,
  };

  boatWakeGroup.add(wake);
  boatWakeParticles.push(wake);
}

let boatWakeSpawnTimer = 0;

/** -----------------------------
 * Sea zones
 * ------------------------------ */
const CALM_BELT = {
  enabled: true,
  north: { minLat: 12, maxLat: 27 },
  south: { minLat: -27, maxLat: -12 },
  killMarginDeg: 7.2, // must be clearly inside before death
};

const GRAND_LINE = {
  minLat: -8,
  maxLat: 8,
};

function isInsideCalmBelt(lat, margin = 0) {
  if (!CALM_BELT.enabled) return false;

  return (
    (lat >= CALM_BELT.north.minLat + margin &&
      lat <= CALM_BELT.north.maxLat - margin) ||
    (lat >= CALM_BELT.south.minLat + margin &&
      lat <= CALM_BELT.south.maxLat - margin)
  );
}

function isInsideGrandLine(lat) {
  return lat >= GRAND_LINE.minLat && lat <= GRAND_LINE.maxLat;
}

function isSafeSpawnZone(lat, lng) {
  return !isInsideCalmBelt(lat) && !isInsideGrandLine(lat) && sampleMask(lat, lng) === 0;
}

const BOAT_RESPAWNS = [
  { lat: 34.0, lng: 140.0, name: "East Blue" },
  { lat: 34.0, lng: -140.0, name: "North Blue" },
  { lat: -34.0, lng: -40.0, name: "South Blue" },
  { lat: -34.0, lng: 95.0, name: "West Blue" },
];

let calmBeltDeathLock = false;
let lodestarReachedShown = false;

function getSafeRespawn() {
  for (let i = 0; i < BOAT_RESPAWNS.length; i++) {
    const candidate = BOAT_RESPAWNS[i];
    if (isSafeSpawnZone(candidate.lat, candidate.lng)) return candidate;
  }

  return { lat: 34.0, lng: 140.0, name: "Open Sea" };
}

const initialSpawn = getSafeRespawn();

const boatState = {
  lat: initialSpawn.lat,
  lng: initialSpawn.lng,
  speedDegPerSec: 18,
  respawnIndex: 0,
};

const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

function desiredMoveVector() {
  const up = keys.has("arrowup") || keys.has("w") || virtualKeys.has("arrowup");
  const down = keys.has("arrowdown") || keys.has("s") || virtualKeys.has("arrowdown");
  const left = keys.has("arrowleft") || keys.has("a") || virtualKeys.has("arrowleft");
  const right = keys.has("arrowright") || keys.has("d") || virtualKeys.has("arrowright");

  const dLat = (up ? 1 : 0) + (down ? -1 : 0);
  const dLng = (right ? 1 : 0) + (left ? -1 : 0);
  return { dLat, dLng };
}

function isUserSteeringShip() {
  const { dLat, dLng } = desiredMoveVector();
  return dLat !== 0 || dLng !== 0;
}

function placeBoat(lat, lng) {
  const elev = sampleElevation(lat, lng);
  const pos = latLngToVector3(lat, lng, globeRadius + elev + TERRAIN.boatClearance);
  boat.position.copy(pos);
  boatBubble.position.copy(pos);
  return pos;
}

function orientBoat(prevPos, nextPos) {
  const move = nextPos.clone().sub(prevPos);
  if (move.lengthSq() < 1e-8) return;

  const normal = nextPos.clone().normalize();
  const forward = move.clone().projectOnPlane(normal).normalize();
  if (forward.lengthSq() < 1e-8) return;

  const right = new THREE.Vector3().crossVectors(normal, forward).normalize();
  const up = normal.clone().normalize();

  const basis = new THREE.Matrix4().makeBasis(right, up, forward);
  const worldQuat = new THREE.Quaternion().setFromRotationMatrix(basis);

  boat.quaternion.copy(worldQuat).multiply(BOAT_MODEL_CORRECTION);
  boatBubble.quaternion.identity();
}


function spawnBoatWake() {
  const wake = boatWakeParticles.find((p) => !p.visible) || boatWakeParticles[0];
  if (!wake || !boat) return;

  const boatWorldPos = new THREE.Vector3();
  boat.getWorldPosition(boatWorldPos);

  const normal = boatWorldPos.clone().normalize();

  const boatForward = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(boat.quaternion)
    .normalize();

  const tangentForward = boatForward.clone().projectOnPlane(normal).normalize();
  if (tangentForward.lengthSq() < 1e-8) return;

  const wakeBack = tangentForward.clone().multiplyScalar(-1);
  const wakeSide = new THREE.Vector3().crossVectors(normal, wakeBack).normalize();

  const elev = sampleElevation(boatState.lat, boatState.lng);
  const waterRadius = globeRadius + elev + 0.028;

  const backOffset = 0.16;
  const sideOffset = (Math.random() * 2 - 1) * 0.018;

  const spawnSurfaceDir = boatWorldPos
    .clone()
    .add(wakeBack.clone().multiplyScalar(backOffset))
    .add(wakeSide.clone().multiplyScalar(sideOffset))
    .normalize();

  const spawnPosWorld = spawnSurfaceDir.multiplyScalar(waterRadius);

  const localPos = globeGroup.worldToLocal(spawnPosWorld.clone());

  wake.visible = true;
  wake.position.copy(localPos);

  wake.userData.life = wake.userData.maxLife;
  wake.userData.driftSide = (Math.random() * 2 - 1) * 0.018;
  wake.userData.driftBack = 0.055 + Math.random() * 0.025;
  wake.userData.normal.copy(spawnPosWorld.clone().normalize());
  wake.userData.tangent.copy(wakeBack);
  wake.userData.bitangent.copy(wakeSide);
  wake.userData.baseScaleX = 1;
  wake.userData.baseScaleY = 1;

  const right = wakeSide.clone().normalize();
  const up = normal.clone().normalize();
  const forward = wakeBack.clone().normalize();

  const basis = new THREE.Matrix4().makeBasis(right, up, forward);
  wake.quaternion.setFromRotationMatrix(basis);

  wake.scale.set(1, 1, 1);
}

function updateBoatWake(dt) {
  for (const wake of boatWakeParticles) {
    if (!wake.visible) continue;

    wake.userData.life -= dt;
    if (wake.userData.life <= 0) {
      wake.visible = false;
      wake.material.opacity = 0;
      continue;
    }

    const life01 = wake.userData.life / wake.userData.maxLife;
    const age = 1 - life01;

    const normal = wake.userData.normal.clone().normalize();
    const tangent = wake.userData.tangent.clone().normalize();
    const bitangent = wake.userData.bitangent.clone().normalize();

    const currentWorld = globeGroup.localToWorld(wake.position.clone());

    const movedWorld = currentWorld
      .clone()
      .add(tangent.clone().multiplyScalar(wake.userData.driftBack * dt))
      .add(bitangent.clone().multiplyScalar(wake.userData.driftSide * dt));

    const elev = sampleElevation(
      vector3ToLatLng(movedWorld).lat,
      vector3ToLatLng(movedWorld).lng
    );
    const waterRadius = globeRadius + elev + 0.026;

    const surfaceWorld = movedWorld.normalize().multiplyScalar(waterRadius);
    const surfaceLocal = globeGroup.worldToLocal(surfaceWorld.clone());
    wake.position.copy(surfaceLocal);

    const right = bitangent.clone().normalize();
    const up = surfaceWorld.clone().normalize();
    const forward = tangent.clone().normalize();

    const basis = new THREE.Matrix4().makeBasis(right, up, forward);
    wake.quaternion.setFromRotationMatrix(basis);

    wake.scale.x = 1 + age * 1.8;
    wake.scale.y = 1 + age * 0.9;
    wake.material.opacity = Math.max(0, life01 * 0.34);
  }
}

function respawnBoat() {
  for (const wake of boatWakeParticles) {
    wake.visible = false;
    wake.material.opacity = 0;
  }

  for (let tries = 0; tries < BOAT_RESPAWNS.length; tries++) {
    boatState.respawnIndex = (boatState.respawnIndex + 1) % BOAT_RESPAWNS.length;
    const spawn = BOAT_RESPAWNS[boatState.respawnIndex];

    if (!isSafeSpawnZone(spawn.lat, spawn.lng)) continue;

    boatState.lat = spawn.lat;
    boatState.lng = spawn.lng;

    const placed = placeBoat(boatState.lat, boatState.lng);
    orientBoat(placed.clone().add(new THREE.Vector3(0.001, 0, 0)), placed);

    showCard({
      name: "Respawned",
      region: spawn.name,
      description: "Your ship restarted outside Calm Belt and outside Grand Line.",
    }, { autoHideMs: 2200 });
    return;
  }

  const fallback = getSafeRespawn();
  boatState.lat = fallback.lat;
  boatState.lng = fallback.lng;

  const placed = placeBoat(boatState.lat, boatState.lng);
  orientBoat(placed.clone().add(new THREE.Vector3(0.001, 0, 0)), placed);

  showCard({
    name: "Respawned",
    region: fallback.name,
    description: "Your ship restarted at a safer sea.",
  }, { autoHideMs: 2200 });
}

function handleCalmBeltDeath() {
  if (calmBeltDeathLock) return;
  calmBeltDeathLock = true;

  endAutoRoute();
  window.alert("You are dead — Sea Kings attacked your ship!");
  respawnBoat();

  setTimeout(() => {
    calmBeltDeathLock = false;
  }, 250);
}

/** -----------------------------
 * Auto-routing
 * ------------------------------ */
const REVERSE_MOUNTAIN = {
  triggerRadiusDeg: 8.0,
  nodeReachThresholdDeg: 0.55,
  autoSpeedDegPerSec: 24,
};

const ROUTE6 = {
  triggerRadiusDeg: 2.5,
  durationSec: 6.0,
  liftHeight: 0.22,
  releaseRadiusDeg: 4.5,
};

let route6LastArrivalIndex = -1;

const autoRiverState = {
  active: false,
  routeName: null,
  nodes: [],
  nodeIndex: 0,
  type: null,
  route6Progress: 0,
  route6Start: null,
  route6End: null,
};

function routeKeyToName(key) {
  if (key === "1") return "bottomRight";
  if (key === "2") return "topRight";
  if (key === "3") return "topLeft";
  if (key === "4") return "bottomLeft";
  if (key === "6") return "route6";
  return null;
}

function beginReverseMountainRoute(routeKey) {
  const routePoints = reversePathData[routeKey];
  const exitPoints = reversePathData["5"];

  if (!routePoints || routePoints.length < 2) return;
  if (!exitPoints || exitPoints.length < 2) return;

  autoRiverState.active = true;
  autoRiverState.routeName = routeKeyToName(routeKey);
  autoRiverState.nodes = [...routePoints, ...exitPoints];
  autoRiverState.nodeIndex = 0;
  autoRiverState.type = "reverse";

  showCard({
    name: "Reverse Mountain",
    region: "Auto Route",
    description:
      "Following your captured river path to the center, then out to the Grand Line.",
  });
}

function beginRoute6(fromIndex = 0, toIndex = 1) {
  const routePoints = reversePathData["6"];
  if (!routePoints || routePoints.length < 2) return;

  autoRiverState.active = true;
  autoRiverState.routeName = "route6";
  autoRiverState.nodes = [];
  autoRiverState.nodeIndex = 0;
  autoRiverState.type = "route6";
  autoRiverState.route6Progress = 0;
  autoRiverState.route6Start = { ...routePoints[fromIndex] };
  autoRiverState.route6End = { ...routePoints[toIndex] };
  autoRiverState.route6FromIndex = fromIndex;
  autoRiverState.route6ToIndex = toIndex;

  boatBubble.visible = true;

  showCard({
    name: "Route 6",
    region: "Bubble Animation",
    description:
      fromIndex === 0
        ? "Ship surrounded by the bubble travels from point 0 to point 1."
        : "Ship surrounded by the bubble travels from point 1 back to point 0.",
  });
}

function endAutoRoute() {
  autoRiverState.active = false;
  autoRiverState.routeName = null;
  autoRiverState.nodes = [];
  autoRiverState.nodeIndex = 0;
  autoRiverState.type = null;
  autoRiverState.route6Progress = 0;
  autoRiverState.route6Start = null;
  autoRiverState.route6End = null;
  autoRiverState.route6FromIndex = null;
  autoRiverState.route6ToIndex = null;
  boatBubble.visible = false;
  boatBubble.scale.setScalar(1);
  hideCard();
}

function tryTriggerRouteFromDrawnPaths() {
  if (autoRiverState.active) return;
  if (pathDrawMode) return;

  const routeKeys = ["1", "2", "3", "4"];

  for (const key of routeKeys) {
    const pts = reversePathData[key];
    if (!pts || pts.length === 0) continue;

    for (let i = 0; i < Math.min(3, pts.length); i++) {
      const p = pts[i];
      const dist = distanceLatLngApprox(boatState.lat, boatState.lng, p.lat, p.lng);

      if (dist <= REVERSE_MOUNTAIN.triggerRadiusDeg) {
        beginReverseMountainRoute(key);
        return;
      }
    }
  }

  const route6Pts = reversePathData["6"];
  if (route6Pts && route6Pts.length >= 2) {
    const point0 = route6Pts[0];
    const point1 = route6Pts[1];

    const distTo0 = distanceLatLngApprox(
      boatState.lat,
      boatState.lng,
      point0.lat,
      point0.lng
    );
    const distTo1 = distanceLatLngApprox(
      boatState.lat,
      boatState.lng,
      point1.lat,
      point1.lng
    );

    if (route6LastArrivalIndex === 0 && distTo0 > ROUTE6.releaseRadiusDeg) {
      route6LastArrivalIndex = -1;
    } else if (route6LastArrivalIndex === 1 && distTo1 > ROUTE6.releaseRadiusDeg) {
      route6LastArrivalIndex = -1;
    }

    if (distTo0 <= ROUTE6.triggerRadiusDeg && route6LastArrivalIndex !== 0) {
      beginRoute6(0, 1);
      return;
    }

    if (distTo1 <= ROUTE6.triggerRadiusDeg && route6LastArrivalIndex !== 1) {
      beginRoute6(1, 0);
      return;
    }
  }
}

function updateReverseMountainAuto(dt) {
  const target = autoRiverState.nodes[autoRiverState.nodeIndex];
  if (!target) {
    endAutoRoute();
    return false;
  }

  const prevPos = placeBoat(boatState.lat, boatState.lng).clone();

  const speed = REVERSE_MOUNTAIN.autoSpeedDegPerSec * dt;
  const reachThreshold = REVERSE_MOUNTAIN.nodeReachThresholdDeg;

  const dLat = target.lat - boatState.lat;
  const dLng = shortestLngDelta(boatState.lng, target.lng);
  const dist = Math.sqrt(dLat * dLat + dLng * dLng);

  if (dist <= reachThreshold) {
    boatState.lat = target.lat;
    boatState.lng = wrapLng(target.lng);

    const snapPos = placeBoat(boatState.lat, boatState.lng);
    orientBoat(prevPos, snapPos);

    autoRiverState.nodeIndex++;
    if (autoRiverState.nodeIndex >= autoRiverState.nodes.length) {
      endAutoRoute();
    }
    return true;
  }

  const stepLat = (dLat / dist) * speed;
  const stepLng = (dLng / dist) * speed;

  boatState.lat = clamp(boatState.lat + stepLat, -85, 85);
  boatState.lng = wrapLng(boatState.lng + stepLng);

  const nextPos = placeBoat(boatState.lat, boatState.lng);
  orientBoat(prevPos, nextPos);

  boatWakeSpawnTimer -= dt;
  if (boatWakeSpawnTimer <= 0) {
    spawnBoatWake();
    boatWakeSpawnTimer = 0.035;
  }

  return true;
}

function updateRoute6BubbleAuto(dt) {
  const start = autoRiverState.route6Start;
  const end = autoRiverState.route6End;
  if (!start || !end) {
    endAutoRoute();
    return false;
  }

  const prevPos = placeBoat(boatState.lat, boatState.lng).clone();

  autoRiverState.route6Progress += dt / ROUTE6.durationSec;
  const t = smoothstep01(autoRiverState.route6Progress);

  boatState.lat = lerp(start.lat, end.lat, t);
  boatState.lng = lerpLng(start.lng, end.lng, t);

  const elev = sampleElevation(boatState.lat, boatState.lng);
  const arcLift = Math.sin(t * Math.PI) * ROUTE6.liftHeight;
  const radius = globeRadius + elev + TERRAIN.boatClearance + arcLift;

  const nextPos = latLngToVector3(boatState.lat, boatState.lng, radius);
  boat.position.copy(nextPos);
  boatBubble.position.copy(nextPos);

  orientBoat(prevPos, nextPos);

  const pulse = 1 + Math.sin(performance.now() * 0.012) * 0.08;
  boatBubble.scale.setScalar(pulse);

  if (t >= 1) {
    boatState.lat = end.lat;
    boatState.lng = wrapLng(end.lng);

    const finalPos = placeBoat(boatState.lat, boatState.lng);
    orientBoat(prevPos, finalPos);

    route6LastArrivalIndex = autoRiverState.route6ToIndex ?? -1;
    endAutoRoute();
  }

  return true;
}

function updateActiveAutoRoute(dt) {
  if (!autoRiverState.active) return false;

  if (autoRiverState.type === "route6") {
    return updateRoute6BubbleAuto(dt);
  }

  if (autoRiverState.type === "reverse") {
    return updateReverseMountainAuto(dt);
  }

  return false;
}

function findLodestarLocation() {
  return locations.find(
    (loc) =>
      typeof loc.name === "string" &&
      loc.name.toLowerCase().includes("lodestar")
  );
}

function checkLodestarArrival() {
  const lodestar = findLodestarLocation();
  if (!lodestar) return;

  ensureLatLng(lodestar);

  const dist = distanceLatLngApprox(
    boatState.lat,
    boatState.lng,
    lodestar.lat,
    lodestar.lng
  );

  const reachThresholdDeg = 2.2;
  const resetThresholdDeg = 3.5;

  if (!lodestarReachedShown && dist <= reachThresholdDeg) {
    lodestarReachedShown = true;

    showCard(
      {
        name: "Lodestar Island",
        region: "End of the Log Pose",
        description:
          "You have reached the end of the Log Pose! But the journey is not over. To find the One Piece, you must now discover the hidden path to Laugh Tale.",
      },
      { autoHideMs: 7000 }
    );
  }

  if (lodestarReachedShown && dist > resetThresholdDeg) {
    lodestarReachedShown = false;
  }
}

function updateBoat(dt) {
  if (!terrainReady) return;

  tryTriggerRouteFromDrawnPaths();

  if (updateActiveAutoRoute(dt)) {
    return;
  }

  const { dLat, dLng } = desiredMoveVector();
  if (dLat === 0 && dLng === 0) {
    placeBoat(boatState.lat, boatState.lng);
    return;
  }

  const step = boatState.speedDegPerSec * dt;
  const nextLat = clamp(boatState.lat + dLat * step, -85, 85);
  const nextLng = wrapLng(boatState.lng + dLng * step);

  const currentlyInsideCalmBelt =
    isInsideCalmBelt(boatState.lat, CALM_BELT.killMarginDeg) &&
    isCalmBeltWaterAt(boatState.lat, boatState.lng);

  const nextInsideCalmBelt =
    isInsideCalmBelt(nextLat, CALM_BELT.killMarginDeg) &&
    isCalmBeltWaterAt(nextLat, nextLng);

  if (!currentlyInsideCalmBelt && nextInsideCalmBelt) {
    handleCalmBeltDeath();
    return;
  }

  const isLand = sampleMask(nextLat, nextLng) === 1;
  if (!isLand) {
    const prevPos = placeBoat(boatState.lat, boatState.lng).clone();
    boatState.lat = nextLat;
    boatState.lng = nextLng;
    const nextPos = placeBoat(boatState.lat, boatState.lng);
    orientBoat(prevPos, nextPos);

    boatWakeSpawnTimer -= dt;
    if (boatWakeSpawnTimer <= 0) {
      spawnBoatWake();
      boatWakeSpawnTimer = 0.03;
    }
  } else {
    placeBoat(boatState.lat, boatState.lng);
  }
}

placeBoat(boatState.lat, boatState.lng);
orientBoat(
  boat.position.clone().add(new THREE.Vector3(0.001, 0, 0)),
  boat.position.clone()
);

// Fixed initial map orientation
globeGroup.quaternion.setFromEuler(new THREE.Euler(0, Math.PI, 0));
globeGroup.userData.targetQuaternion = null;

/** -----------------------------
 * Auto spin + UI hooks
 * ------------------------------ */
let autoSpin = false;
if (toggleAutoSpinBtn) toggleAutoSpinBtn.textContent = "Resume Spin";

toggleAutoSpinBtn?.addEventListener("click", () => {
  autoSpin = !autoSpin;
  toggleAutoSpinBtn.textContent = autoSpin ? "Pause Spin" : "Resume Spin";
});

zoomInBtn.addEventListener("click", () => zoomCamera(1 / 1.12));
zoomOutBtn.addEventListener("click", () => zoomCamera(1.12));

resetCameraBtn?.addEventListener("click", () => {
  controls.reset();
  camera.position.set(0, 6.5, 10);
  controls.target.set(0, 0, 0);

  globeGroup.quaternion.setFromEuler(new THREE.Euler(0, Math.PI, 0));
  globeGroup.userData.targetQuaternion = null;

  controls.update();
});

/** -----------------------------
 * Resize + animate
 * ------------------------------ */
function resize() {
  const rect = globeEl.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  keepHudFixedPosition();
}
window.addEventListener("resize", resize);
resize();

let lastT = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const t = performance.now();
  const dt = Math.min(0.04, (t - lastT) / 1000);
  lastT = t;

  if (autoSpin && !isUserSteeringShip() && !autoRiverState.active) {
    globeGroup.quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        dt * 0.14
      )
    );
  }

  if (waveMesh && waveEnabled) {
    waveTime += dt;
    waveMesh.material.uniforms.time.value = waveTime;
  }

  if (boatBubble.visible) {
    boatBubble.material.opacity = 0.18 + 0.08 * (0.5 + 0.5 * Math.sin(t * 0.01));
  }

  for (const child of labelGroup.children) {
    child.quaternion.copy(camera.quaternion);
  }


  updateBoat(dt);
  checkLodestarArrival();
  updateBoatWake(dt);
  keepHudFixedPosition();

  if (followShipWhileMoving && isUserSteeringShip() && !autoRiverState.active) {
    centerShipInView(false, followShipStrength);
  }

  if (globeGroup.userData.targetQuaternion) {
    const slerpAmount = Math.max(0.08, centerShipLerp || 0.18);
    globeGroup.quaternion.slerp(globeGroup.userData.targetQuaternion, slerpAmount);

    if (globeGroup.quaternion.angleTo(globeGroup.userData.targetQuaternion) < 0.0015) {
      globeGroup.quaternion.copy(globeGroup.userData.targetQuaternion);
      globeGroup.userData.targetQuaternion = null;
      centerShipLerp = 0;
    }
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();