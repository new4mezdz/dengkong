// Babylon bridge loaded before the shared runtime.
// Sources copied/adapted from app-01-core.js:
// - SCALE/BUILDING/building helpers: lines 24-63
// - item type helpers: lines 548-587
// - layout/default/clamp helpers: lines 1230-1367

const SCALE = 10;
const DEFAULT_BUILDING = Object.freeze({
  width: 120,
  depth: 40,
  wallH: 28,
  ridgeH: 50
});
const BUILDING = {};

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function formatNum(num) {
  return (Math.round(num * 10) / 10).toFixed(1);
}

function normalizeBuildingConfig(building) {
  const src = building || DEFAULT_BUILDING;
  const width = clamp(Number(src.width) || DEFAULT_BUILDING.width, 24, 140);
  const depth = clamp(Number(src.depth) || DEFAULT_BUILDING.depth, 18, 110);
  const wallH = clamp(Number(src.wallH) || DEFAULT_BUILDING.wallH, 12, 56);
  const ridgeH = clamp(Number(src.ridgeH) || DEFAULT_BUILDING.ridgeH, wallH + 6, 84);
  return { width, depth, wallH, ridgeH };
}

function applyBuildingConfig(building) {
  const normalized = normalizeBuildingConfig(building);
  BUILDING.configWidth = normalized.width;
  BUILDING.configDepth = normalized.depth;
  BUILDING.width = normalized.width * SCALE;
  BUILDING.depth = normalized.depth * SCALE;
  BUILDING.halfW = BUILDING.width / 2;
  BUILDING.halfD = BUILDING.depth / 2;
  BUILDING.wallH = normalized.wallH;
  BUILDING.ridgeH = normalized.ridgeH;
  BUILDING.roofOverhang = clamp(BUILDING.width * 0.03, 1.2 * SCALE, 2.4 * SCALE);
  BUILDING.trussStep = clamp(BUILDING.depth / 4, 7 * SCALE, 11 * SCALE);
  BUILDING.roofRise = BUILDING.ridgeH - BUILDING.wallH;
  BUILDING.roofHalfSpan = BUILDING.halfW + BUILDING.roofOverhang;
  BUILDING.roofSlopeLen = Math.sqrt(BUILDING.roofHalfSpan ** 2 + BUILDING.roofRise ** 2);
  BUILDING.roofAngle = Math.atan2(BUILDING.roofRise, BUILDING.roofHalfSpan);
  BUILDING.roofCenterY = BUILDING.wallH + BUILDING.roofRise / 2;
  BUILDING.roofDepth = BUILDING.depth + BUILDING.roofOverhang * 2;
  return normalized;
}

applyBuildingConfig(DEFAULT_BUILDING);

const DEFAULT_ITEM_TYPE = 'lamp';
const ITEM_TYPES = {
  lamp: { label: '灯', icon: '💡', short: '灯', accent: '#0F52BA', accentHex: 0x0f52ba, mode: 'lamp' },
  printer: { label: '打印机', icon: '🖨️', short: '打', accent: '#5ac8fa', accentHex: 0x5ac8fa, mode: 'icon' },
  smoke_machine: { label: '产烟机', icon: '💨', short: '烟', accent: '#8ef0ff', accentHex: 0x8ef0ff, mode: 'icon' },
  fan: { label: '风扇', icon: '🌀', short: '扇', accent: '#64d2ff', accentHex: 0x64d2ff, mode: 'icon' },
  socket: { label: '插座', icon: '🔌', short: '座', accent: '#ff9f0a', accentHex: 0xff9f0a, mode: 'icon' },
  camera: { label: '摄像头', icon: '📷', short: '摄', accent: '#bf5af2', accentHex: 0xbf5af2, mode: 'icon' },
  alarm: { label: '报警器', icon: '🔔', short: '警', accent: '#ff453a', accentHex: 0xff453a, mode: 'icon' }
};
const ITEM_TYPE_KEYS = Object.keys(ITEM_TYPES);
Object.assign(ITEM_TYPES.lamp, { mount: 'ceiling' });
Object.assign(ITEM_TYPES.smoke_machine, { mount: 'floor' });
Object.assign(ITEM_TYPES.fan, { mount: 'ceiling' });
Object.assign(ITEM_TYPES.socket, { mount: 'wall_mid' });
Object.assign(ITEM_TYPES.camera, { mount: 'wall_high' });
Object.assign(ITEM_TYPES.alarm, { mount: 'wall_high' });
const ITEM_MOUNT_TYPES = new Set(['free', 'floor', 'ceiling', 'wall_mid', 'wall_high']);

function getItemMeta(type) {
  return ITEM_TYPES[type] || ITEM_TYPES[DEFAULT_ITEM_TYPE];
}

function normalizeLight(lt) {
  const next = Object.assign({}, lt);
  next.type = ITEM_TYPES[next.type] ? next.type : DEFAULT_ITEM_TYPE;
  next.scale = clamp(Number(next.scale) || 1, 0.4, 3);
  next.group = typeof next.group === 'string' ? next.group.trim() : '';
  next.mount = ITEM_MOUNT_TYPES.has(next.mount) ? next.mount : (getItemMeta(next.type).mount || 'free');
  return next;
}

function getSuggestedLightName(type) {
  return '新' + getItemMeta(type).label;
}

function isAutoName(name) {
  if (!name) return true;
  return ITEM_TYPE_KEYS.some(function(key) { return name === getSuggestedLightName(key); });
}

const DEFAULT_LAYOUT = Object.freeze({
  building: Object.assign({}, DEFAULT_BUILDING),
  walls: [],
  zones: [],
  pillars: [],
  doors: [],
  paths: [],
  workstations: [],
  racks: [],
  safetyStations: []
});

function makeLayoutId(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 10);
}

function clampFloorPoint(point) {
  const margin = 1.2;
  return {
    x: clamp(point.x, -BUILDING.halfW + margin, BUILDING.halfW - margin),
    z: clamp(point.z, -BUILDING.halfD + margin, BUILDING.halfD - margin)
  };
}

function normalizeWall(wall, idx) {
  if (!wall) return null;
  const x1 = Number(wall.x1);
  const z1 = Number(wall.z1);
  const x2 = Number(wall.x2);
  const z2 = Number(wall.z2);
  if (![x1, z1, x2, z2].every(Number.isFinite)) return null;
  const p1 = clampFloorPoint({ x: x1, z: z1 });
  const p2 = clampFloorPoint({ x: x2, z: z2 });
  return {
    id: wall.id || makeLayoutId('wall'),
    name: String(wall.name || ('墙体' + (idx + 1))),
    x1: p1.x,
    z1: p1.z,
    x2: p2.x,
    z2: p2.z,
    height: clamp(Number(wall.height) || 12, 4, Math.max(8, BUILDING.ridgeH - 4)),
    thickness: clamp(Number(wall.thickness) || 4, 2.4, 10)
  };
}

function normalizeZone(zone, idx) {
  if (!zone) return null;
  const x = Number(zone.x);
  const z = Number(zone.z);
  const width = Number(zone.width);
  const depth = Number(zone.depth);
  if (![x, z, width, depth].every(Number.isFinite)) return null;
  const margin = 1.2;
  const nextWidth = clamp(Math.abs(width) || 8, 2, Math.max(2, BUILDING.width - margin * 2));
  const nextDepth = clamp(Math.abs(depth) || 8, 2, Math.max(2, BUILDING.depth - margin * 2));
  return {
    id: zone.id || makeLayoutId('zone'),
    name: String(zone.name || ('区域' + (idx + 1))),
    x: clamp(x, -BUILDING.halfW + nextWidth / 2 + margin, BUILDING.halfW - nextWidth / 2 - margin),
    z: clamp(z, -BUILDING.halfD + nextDepth / 2 + margin, BUILDING.halfD - nextDepth / 2 - margin),
    width: nextWidth,
    depth: nextDepth,
    color: zone.color || '#5ac8fa'
  };
}

function normalizeLayoutData(layout) {
  const src = layout || DEFAULT_LAYOUT;
  const building = applyBuildingConfig(src.building || DEFAULT_BUILDING);
  return {
    building,
    walls: (Array.isArray(src.walls) ? src.walls : []).map(normalizeWall).filter(Boolean),
    zones: (Array.isArray(src.zones) ? src.zones : []).map(normalizeZone).filter(Boolean),
    pillars: Array.isArray(src.pillars) ? src.pillars : [],
    doors: Array.isArray(src.doors) ? src.doors : [],
    paths: Array.isArray(src.paths) ? src.paths : [],
    workstations: Array.isArray(src.workstations) ? src.workstations : [],
    racks: Array.isArray(src.racks) ? src.racks : [],
    safetyStations: Array.isArray(src.safetyStations) ? src.safetyStations : []
  };
}

function clampLightPositionsToBuilding() {
  if (typeof config === 'undefined') return;
  config.lights = (config.lights || []).map(function(light) {
    const next = normalizeLight(light);
    if (!Number.isFinite(next.x) || !Number.isFinite(next.z)) return next;
    const point = clampFloorPoint({ x: Number(next.x), z: Number(next.z) });
    next.x = Math.round(point.x * 100) / 100;
    next.z = Math.round(point.z * 100) / 100;
    return next;
  });
}

var canvas = document.getElementById('scene');
var lamps = [];
var labelsPinned = false;
var focusedLampIdx = null;
var lightPlacementIndex = null;
var editMode = false;
var walkMode = false;
var layoutMode = false;
var layoutTool = 'select';
var layoutDirty = false;
var selectedLayout = null;
var dragState = null;
var raycaster = { intersectObjects: function() { return []; } };
var renderer = { domElement: canvas, render: function() {} };
var scene = {};
var camera = {};
var controls = { update: function() {} };
var THREE = window.THREE || {
  Vector3: function(x, y, z) {
    this.x = x || 0;
    this.y = y || 0;
    this.z = z || 0;
  }
};
THREE.Vector3.prototype.set = function(x, y, z) {
  this.x = x || 0;
  this.y = y || 0;
  this.z = z || 0;
  return this;
};
THREE.Vector3.prototype.copy = function(value) {
  this.x = value && value.x || 0;
  this.y = value && value.y || 0;
  this.z = value && value.z || 0;
  return this;
};
THREE.Vector3.prototype.project = function() {
  return this;
};
window.THREE = THREE;

window.__techRenderFrame = function() { return true; };

function screenToRay() {
  return null;
}

function getGroundPoint() {
  return null;
}

function getTypeOptionsHtml(selectedType) {
  return ITEM_TYPE_KEYS.map(function(key) {
    const meta = getItemMeta(key);
    return '<option value="' + key + '"' + (key === selectedType ? ' selected' : '') + '>' +
      (typeof escapeHtml === 'function' ? escapeHtml(meta.label) : meta.label) +
      '</option>';
  }).join('');
}

function __babylonResizeNow() {
  if (window.BabylonApp && window.BabylonApp.engine && typeof window.BabylonApp.engine.resize === 'function') {
    window.BabylonApp.engine.resize();
  }
}

function scheduleSceneResize() {
  requestAnimationFrame(__babylonResizeNow);
  setTimeout(__babylonResizeNow, 280);
}

function __babylonScheduleRebuild() {
  if (__babylonScheduleRebuild._queued) return;
  __babylonScheduleRebuild._queued = true;
  requestAnimationFrame(function() {
    __babylonScheduleRebuild._queued = false;
    if (window.BabylonApp && typeof window.BabylonApp.rebuildScene === 'function') {
      window.BabylonApp.rebuildScene();
      if (!__babylonScheduleRebuild._fitOnce && typeof window.BabylonApp.fitCamera === 'function') {
        __babylonScheduleRebuild._fitOnce = true;
        window.BabylonApp.fitCamera();
      }
    }
  });
}

function rebuildFactoryScene() {
  __babylonScheduleRebuild();
}

function rebuildLayoutScene() {
  __babylonScheduleRebuild();
}

function rebuildLamps() {
  __babylonScheduleRebuild();
}

function focusLamp(index) {
  focusedLampIdx = typeof index === 'number' ? index : null;
  if (window.BabylonApp && typeof window.BabylonApp.focusLight === 'function') {
    window.BabylonApp.focusLight(focusedLampIdx);
  } else if (focusedLampIdx == null) {
    const pop = document.getElementById('device-pop');
    if (pop) pop.hidden = true;
  }
}

function toggleWalkMode(forceValue) {
  const next = typeof forceValue === 'boolean' ? forceValue : !walkMode;
  walkMode = next;
  if (window.BabylonApp && typeof window.BabylonApp.toggleWalkMode === 'function') {
    window.BabylonApp.toggleWalkMode(next);
  }
  updateSceneHint();
  updateCanvasCursor();
}

function updateWalkMovement() {
  // Movement is handled by Babylon's UniversalCamera in this page.
}

function updateSceneHint() {
  const hint = document.getElementById('scene-hint');
  if (!hint) return;
  hint.textContent = walkMode
    ? '第一人称模式：W/A/S/D 移动，鼠标观察，点击按钮退出'
    : '拖动画布旋转 · 滚轮缩放 · 俯瞰模式 W/A/S/D 平移 · 点击灯具查看或切换';
}

function updateCanvasCursor() {
  if (!canvas) return;
  canvas.style.cursor = walkMode ? 'crosshair' : 'grab';
}

function __layoutStubToast() {
  if (typeof showToast === 'function') {
    showToast('info', '布局编辑', 'Babylon 版布局编辑属于后续阶段。');
  }
}

function toggleEditMode() {
  __layoutStubToast();
}

function toggleLayoutMode() {
  __layoutStubToast();
}

function setLayoutTool(tool) {
  layoutTool = tool || layoutTool;
  __layoutStubToast();
}

function saveLayout() {
  __layoutStubToast();
}

function deleteSelectedLayout() {
  __layoutStubToast();
}

function setLayoutDirty(value) {
  layoutDirty = !!value;
}

function startLightPlacement(index) {
  lightPlacementIndex = index;
  __layoutStubToast();
}

function updateLayoutUI() {
  updateSceneHint();
  updateCanvasCursor();
}
