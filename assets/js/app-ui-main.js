// UI bindings, panel state, and bootstrap.

canvas.addEventListener('pointerdown', function(e) {
  if (e.button !== 0 || layoutMode || walkMode) return;
  screenToRay(e);
  const hits = lamps.map(function(lamp) { return lamp.hit; });
  const inter = raycaster.intersectObjects(hits);
  if (inter.length > 0) {
    focusLamp(inter[0].object.userData.lightIdx);
  } else if (!labelsPinned) {
    focusLamp(null);
  }
});

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PANEL_SECTION_DEFAULTS = {
  devices: false,
  appliances: true,
  layout: false
};
let panelSections = Object.assign({}, PANEL_SECTION_DEFAULTS);
const PANEL_EXPANDED_STORAGE_KEY = 'dengkong.panel.expanded';
let panelExpanded = true;

try {
  panelExpanded = localStorage.getItem(PANEL_EXPANDED_STORAGE_KEY) !== '0';
} catch (error) {}

function refreshMainPanel() {
  const panel = document.getElementById('panel');
  const toggle = document.getElementById('panel-toggle');
  const glyph = document.getElementById('panel-toggle-glyph');
  const mini = document.getElementById('panel-mini');
  const panelButton = document.getElementById('panel-visibility-btn');
  const miniButton = document.getElementById('panel-mini-open-btn');
  const label = panelExpanded ? '收起控制面板' : '展开控制面板';

  if (panel) panel.classList.toggle('panel-collapsed', !panelExpanded);
  if (toggle) {
    toggle.setAttribute('aria-expanded', panelExpanded ? 'true' : 'false');
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
  }
  if (glyph) glyph.textContent = panelExpanded ? '>' : '<';
  if (mini) mini.setAttribute('aria-hidden', panelExpanded ? 'true' : 'false');
  if (panelButton) {
    panelButton.textContent = panelExpanded ? '收起侧栏' : '展开侧栏';
    panelButton.setAttribute('aria-label', label);
    panelButton.setAttribute('title', label);
  }
  if (miniButton) {
    miniButton.textContent = panelExpanded ? '已展开' : '打开';
    miniButton.setAttribute('title', '展开控制面板');
  }

  try {
    localStorage.setItem(PANEL_EXPANDED_STORAGE_KEY, panelExpanded ? '1' : '0');
  } catch (error) {}
}

function toggleMainPanel(forceValue) {
  panelExpanded = typeof forceValue === 'boolean' ? forceValue : !panelExpanded;
  refreshMainPanel();
  scheduleSceneResize();
}

function openPanelSection(key) {
  if (!(key in PANEL_SECTION_DEFAULTS)) return;
  panelExpanded = true;
  panelSections[key] = true;
  refreshMainPanel();
  refreshPanelSections();
  requestAnimationFrame(function() {
    const section = document.getElementById('section-' + key);
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

function getConnectedDeviceCount() {
  return (config.devices || []).filter(function(device) {
    return !!(deviceStatus[device.ip] && deviceStatus[device.ip].connected);
  }).length;
}

function getLightOnCount() {
  return (config.lights || []).reduce(function(total, light) {
    const status = deviceStatus[light.device_ip];
    return total + (status && status.connected && status.relay_states && status.relay_states[light.channel] ? 1 : 0);
  }, 0);
}

function refreshPanelSections() {
  const layout = config.layout || DEFAULT_LAYOUT;
  const wallCount = Array.isArray(layout.walls) ? layout.walls.length : 0;
  const zoneCount = Array.isArray(layout.zones) ? layout.zones.length : 0;
  const deviceCount = (config.devices || []).length;
  const connectedCount = getConnectedDeviceCount();
  const lightCount = (config.lights || []).length;
  const lightOnCount = getLightOnCount();
  const metaText = {
    devices: deviceCount === 0
      ? '暂无设备'
      : connectedCount + ' / ' + deviceCount + ' 已连接',
    appliances: lightCount === 0
      ? '暂无电器'
      : lightOnCount + ' / ' + lightCount + ' 已开启',
    layout: wallCount + ' 面墙 / ' + zoneCount + ' 个区域'
  };

  Object.keys(PANEL_SECTION_DEFAULTS).forEach(function(key) {
    const open = !!panelSections[key];
    const root = document.getElementById('section-' + key);
    const body = document.getElementById('body-' + key);
    const toggle = document.querySelector('[data-section-toggle="' + key + '"]');
    const meta = document.getElementById('meta-' + key);
    if (root) root.classList.toggle('open', open);
    if (body) body.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (meta) meta.textContent = metaText[key];
  });

  const miniDevices = document.getElementById('mini-devices');
  const miniAppliances = document.getElementById('mini-appliances');
  const miniLayout = document.getElementById('mini-layout');
  if (miniDevices) miniDevices.textContent = String(deviceCount);
  if (miniAppliances) miniAppliances.textContent = String(lightOnCount);
  if (miniLayout) miniLayout.textContent = String(wallCount + zoneCount);
}

function togglePanelSection(key, forceValue) {
  if (!(key in PANEL_SECTION_DEFAULTS)) return;
  panelSections[key] = typeof forceValue === 'boolean' ? forceValue : !panelSections[key];
  refreshPanelSections();
}

window.connectAll = connectAll;
window.disconnectAll = disconnectAll;
window.showDeviceModal = showDeviceModal;
window.hideDeviceModal = hideDeviceModal;
window.saveDevice = saveDevice;
window.showLightsModal = showLightsModal;
window.hideLightsModal = hideLightsModal;
window.addLight = addLight;
window.saveLights = saveLights;
window.testDeviceModal = testDeviceModal;
window.showScenesModal = showScenesModal;
window.hideScenesModal = hideScenesModal;
window.addScene = addScene;
window.saveScenes = saveScenes;
window.openSetupWizard = openSetupWizard;
window.hideSetupWizard = hideSetupWizard;
window.setupWizardBack = setupWizardBack;
window.setupWizardNext = setupWizardNext;
window.setupWizardTestDevice = setupWizardTestDevice;
window.applyScene = applyScene;
window.applyGroupState = applyGroupState;
window.toggleLabelPins = toggleLabelPins;
window.toggleMainPanel = toggleMainPanel;
window.openPanelSection = openPanelSection;
window.togglePanelSection = togglePanelSection;
window.batchAll = batchAll;
window.refreshStatus = refreshStatus;
window.toggleLayoutMode = toggleLayoutMode;
window.setLayoutTool = setLayoutTool;
window.saveLayout = saveLayout;
window.deleteSelectedLayout = deleteSelectedLayout;
window.openProjectImportDialog = openProjectImportDialog;
window.handleProjectFileSelection = handleProjectFileSelection;
window.exportProjectConfig = exportProjectConfig;

refreshMainPanel();
scheduleSceneResize();
refreshPanelSections();
updateLayoutUI();
window.onDeviceProtocolChange();
window.onSetupDeviceProtocolChange();
loadConfig();

[
  'setup-appliance-count',
  'setup-appliance-type',
  'setup-appliance-prefix',
  'setup-appliance-group',
  'setup-scenes-enabled',
  'setup-scenes-focus-enabled'
].forEach(function(id) {
  const node = document.getElementById(id);
  if (!node) return;
  node.addEventListener(node.tagName === 'SELECT' ? 'change' : 'input', function() {
    const modal = document.getElementById('setup-modal');
    if (modal && modal.classList.contains('show')) {
      renderSetupWizard();
    }
  });
});

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    refreshStatus({ force: true, silent: true });
  } else {
    clearStatusPoll();
  }
});

window.addEventListener('focus', function() {
  scheduleStatusPoll(0);
});

// Tibber 风格 HUD: 时钟 + 室外温度 (温度暂用伪数据, 后续接入实际传感器)
(function startHudWidgets() {
  function pad(num) { return num < 10 ? '0' + num : '' + num; }
  function tickClock() {
    const el = document.getElementById('hud-clock');
    if (!el) return;
    const now = new Date();
    el.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
  }
  tickClock();
  setInterval(tickClock, 15000);

  // 用一个低频随机游走的伪温度. 等接入气象/传感器后替换.
  let main = -0.4;
  let high = 0.7;
  let low = -1.1;
  function fmt(v) {
    return (v >= 0 ? '' : '') + v.toFixed(1) + ' °C';
  }
  function tickTemp() {
    const m = document.getElementById('hud-temp-main');
    const h = document.getElementById('hud-temp-high');
    const l = document.getElementById('hud-temp-low');
    if (!m || !h || !l) return;
    main = Math.max(low, Math.min(high, main + (Math.random() - 0.5) * 0.2));
    m.textContent = fmt(main);
    h.textContent = fmt(high);
    l.textContent = fmt(low);
  }
  tickTemp();
  setInterval(tickTemp, 12000);
})();
