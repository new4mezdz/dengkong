// UI bindings, panel state, and bootstrap.

canvas.addEventListener('pointerdown', function(e) {
  if (e.button !== 0 || layoutMode || walkMode) return;
  screenToRay(e);
  const hits = lamps.map(function(lamp) { return lamp.hit; });
  const inter = raycaster.intersectObjects(hits);
  if (inter.length > 0) {
    const idx = inter[0].object.userData.lightIdx;
    // 操控视图下: 点 3D 灯直接开关; 建模视图下: 仅聚焦/选中
    if (typeof topView !== 'undefined' && topView === 'control') {
      if (typeof toggleLight === 'function') toggleLight(idx);
    } else {
      focusLamp(idx);
    }
  } else if (!labelsPinned && !(typeof topView !== 'undefined' && topView === 'control')) {
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
window.addLightRow = addLightRow;
window.bindLightRange = bindLightRange;
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
window.showUsageModal = showUsageModal;
window.hideUsageModal = hideUsageModal;
window.refreshUsageReport = refreshUsageReport;
window.renderUsageReport = renderUsageReport;
window.exportUsageCsv = exportUsageCsv;

// ========== 顶层视图切换 + 操控页 ==========
let topView = 'modeling';      // 'modeling' | 'control'
let controlMode = 'channel';   // 'channel' | 'appliance'
let controlDeviceDetailsOpen = {};
const CONTROL_RESERVED_MODES = [
  { key: 'work', label: '上班模式', meta: '待配置' },
  { key: 'eco', label: '节能模式', meta: '待配置' },
  { key: 'offwork', label: '下班模式', meta: '待配置' }
];

function switchTopView(view) {
  topView = (view === 'control' || view === 'stats') ? view : 'modeling';
  const isStats = topView === 'stats';
  const app = document.getElementById('app');
  const panel = document.getElementById('panel');
  const ctrl = document.getElementById('control-panel');
  const stats = document.getElementById('view-stats');
  // 统计=整页看板(隐藏 3D); 配置/操控 共用 #app(3D 常驻), 只切右侧栏
  if (app) app.style.display = isStats ? 'none' : 'flex';
  if (stats) stats.style.display = isStats ? 'block' : 'none';
  if (!isStats) {
    if (panel) panel.style.display = (topView === 'control') ? 'none' : '';
    if (ctrl) ctrl.style.display = (topView === 'control') ? 'flex' : 'none';
  }
  document.body.classList.toggle('control-mode', topView === 'control');
  const tabs = document.querySelectorAll('.top-tab');
  for (let i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === topView);
  }
  if (topView === 'control') {
    // 操控视图下关掉编辑/漫游/布局, 保证点 3D 灯就是开关
    if (typeof editMode !== 'undefined' && editMode && typeof toggleEditMode === 'function') toggleEditMode(false);
    if (typeof walkMode !== 'undefined' && walkMode && typeof toggleWalkMode === 'function') toggleWalkMode(false);
    if (typeof layoutMode !== 'undefined' && layoutMode && typeof toggleLayoutMode === 'function') toggleLayoutMode(false);
    renderControlView();
  }
  if (isStats) refreshStatsData();
  if (!isStats && typeof scheduleSceneResize === 'function') scheduleSceneResize();
}

function setControlMode(mode) {
  controlMode = (mode === 'appliance') ? 'appliance' : 'channel';
  const btns = document.querySelectorAll('.cv-mode');
  for (let i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].getAttribute('data-mode') === controlMode);
  }
  renderControlView();
}

const CONTROL_PENDING_MIN_MS = 650;
const CONTROL_PENDING_TIMEOUT_MS = 9000;
const pendingControlOps = {};

function controlPendingKey(ip, channel) {
  return String(ip || '') + '#' + String(channel);
}

function getRelayActualState(ip, channel) {
  const status = deviceStatus[ip];
  if (!status || !status.connected || !status.relay_states) return null;
  if (!Object.prototype.hasOwnProperty.call(status.relay_states, channel)) return null;
  return !!status.relay_states[channel];
}

function getPendingControl(ip, channel) {
  const key = controlPendingKey(ip, channel);
  const pending = pendingControlOps[key];
  if (!pending) return null;
  const now = Date.now();
  const actual = getRelayActualState(ip, channel);
  const minElapsed = now - pending.startedAt >= CONTROL_PENDING_MIN_MS;
  if (actual === pending.target && minElapsed) {
    delete pendingControlOps[key];
    return null;
  }
  if (now > pending.expiresAt) {
    delete pendingControlOps[key];
    showToast('warn', '确认超时', '设备回读暂未确认该通道状态，请稍后刷新查看。');
    return null;
  }
  return pending;
}

function isChannelPending(ip, channel) {
  return !!getPendingControl(ip, channel);
}

function getChannelPendingTarget(ip, channel) {
  const pending = getPendingControl(ip, channel);
  return pending ? pending.target : null;
}

function reconcilePendingControls() {
  Object.keys(pendingControlOps).forEach(function(key) {
    const parts = key.split('#');
    getPendingControl(parts[0], parseInt(parts[1], 10));
  });
}

function markChannelPending(ip, channel, target) {
  pendingControlOps[controlPendingKey(ip, channel)] = {
    ip: ip,
    channel: channel,
    target: !!target,
    startedAt: Date.now(),
    expiresAt: Date.now() + CONTROL_PENDING_TIMEOUT_MS
  };
  setTimeout(function() {
    reconcilePendingControls();
    if (typeof applyStatus === 'function') applyStatus();
  }, CONTROL_PENDING_MIN_MS + 40);
  setTimeout(function() {
    reconcilePendingControls();
    if (typeof applyStatus === 'function') applyStatus();
  }, CONTROL_PENDING_TIMEOUT_MS + 40);
}

function clearChannelPending(ip, channel) {
  delete pendingControlOps[controlPendingKey(ip, channel)];
}

window.isChannelPending = isChannelPending;
window.getChannelPendingTarget = getChannelPendingTarget;
window.reconcilePendingControls = reconcilePendingControls;

async function toggleDeviceChannel(ip, channel) {
  const status = deviceStatus[ip];
  if (!status || !status.connected) {
    showToast('warn', '设备离线', '请先连接该继电器再操作。');
    return;
  }
  const current = !!(status.relay_states && status.relay_states[channel]);
  const target = !current;
  if (isChannelPending(ip, channel)) return;
  markChannelPending(ip, channel, target);
  applyStatus();
  try {
    const result = await api('/api/toggle', 'POST', { ip: ip, channel: channel, value: target });
    if (result.ok) {
      refreshStatus({ force: true, silent: true });
      scheduleStatusPoll(200);
    } else {
      clearChannelPending(ip, channel);
      applyStatus();
      showToast('error', '控制失败', getFriendlyMessage(result.error || '未知错误', 'control'));
    }
  } catch (error) {
    clearChannelPending(ip, channel);
    applyStatus();
    showToast('error', '控制失败', getFriendlyMessage(getErrorMessage(error, '未知错误'), 'control'));
  }
}

async function toggleDeviceAll(ip, value) {
  const status = deviceStatus[ip];
  if (!status || !status.connected) {
    showToast('warn', '设备未连接', '请先连接该继电器再操作。');
    return;
  }

  const device = (config.devices || []).find(function(item) {
    return item.ip === ip;
  });
  const channelCount = device && typeof getDeviceChannelCount === 'function'
    ? getDeviceChannelCount(device)
    : (parseInt(device && device.channel_count, 10) || 32);

  beginRuntimeOperation();
  try {
    const result = await api('/api/batch', 'POST', {
      ip: ip,
      start: 0,
      end: channelCount,
      value: !!value
    });

    if (result.ok) {
      deviceStatus[ip].relay_states = new Array(channelCount).fill(!!value);
      applyStatus();
      scheduleStatusPoll(200);
      showToast(
        'success',
        value ? '继电器已全开' : '继电器已全关',
        getDeviceDisplayName(device || ip) + ' 已更新 ' + channelCount + ' 路。'
      );
    } else {
      showToast('error', '控制失败', getFriendlyMessage(result.error || '未知错误', 'control'));
    }
  } catch (error) {
    showToast('error', '控制失败', getFriendlyMessage(getErrorMessage(error, '未知错误'), 'control'));
  } finally {
    endRuntimeOperation();
  }
}

function controlBreakerHtml(o) {
  // 胶囊滑动开关: 开=绿光在左+ON, 关=橙光在右+OFF; 只显示灯名(如"灯 4-1")
  const cls = 'lsw' + (o.on ? ' on' : '') + (o.pending ? ' pending' : '') + (o.connected ? '' : ' offline');
  return '<div class="' + cls + '" data-ip="' + escapeHtml(o.ip) + '" data-ch="' + o.channel +
    '" data-light="' + o.lightIdx + '" title="' + escapeHtml(o.label) + '">' +
    '<div class="lsw-pill"><span class="lsw-glow"></span>' +
      '<span class="lsw-text">' + (o.pending ? 'WAIT' : (o.on ? 'ON' : 'OFF')) + '</span></div>' +
    '<div class="lsw-label">' + escapeHtml(o.label) + '</div>' +
  '</div>';
}

function pad2(n) { return String(n).padStart(2, '0'); }

function getDeviceBoardStats(device) {
  const channelCount = typeof getDeviceChannelCount === 'function'
    ? getDeviceChannelCount(device)
    : (parseInt(device && device.channel_count, 10) || 32);
  const status = device ? deviceStatus[device.ip] : null;
  const connected = !!(status && status.connected);
  let onCount = 0;
  for (let ch = 0; ch < channelCount; ch++) {
    if (connected && status.relay_states && status.relay_states[ch]) onCount += 1;
  }
  return {
    channelCount: channelCount,
    connected: connected,
    onCount: onCount,
    anyOn: onCount > 0,
    allOn: connected && onCount === channelCount
  };
}

function getDeviceBoardMeta(stats) {
  if (!stats.connected) return '未连接 · 自动重连中';
  return stats.onCount + '/' + stats.channelCount + ' 已开 · 点击' + (stats.anyOn ? '全关' : '全开');
}

function applyReservedMode(modeKey) {
  const mode = CONTROL_RESERVED_MODES.find(function(item) { return item.key === modeKey; });
  showToast('info', mode ? mode.label : '模式预留', '模式联动规则后续可在这里配置。');
}

function renderPrimaryControlButtons() {
  const root = document.getElementById('cv-main-actions');
  if (!root) return;
  root.innerHTML = '';

  const devices = config.devices || [];
  devices.forEach(function(device) {
    const stats = getDeviceBoardStats(device);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cv-big-btn relay' + (stats.anyOn ? ' on' : '') + (stats.connected ? '' : ' offline');
    btn.innerHTML =
      '<span class="cv-big-kicker">继电器</span>' +
      '<span class="cv-big-title">' + escapeHtml(device.name || device.ip) + '</span>' +
      '<span class="cv-big-meta">' + escapeHtml(getDeviceBoardMeta(stats)) + '</span>';
    btn.onclick = function() {
      const freshStats = getDeviceBoardStats(device);
      toggleDeviceAll(device.ip, !freshStats.anyOn);
    };
    root.appendChild(btn);
  });

  CONTROL_RESERVED_MODES.forEach(function(mode) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cv-big-btn mode';
    btn.innerHTML =
      '<span class="cv-big-kicker">模式</span>' +
      '<span class="cv-big-title">' + escapeHtml(mode.label) + '</span>' +
      '<span class="cv-big-meta">' + escapeHtml(mode.meta) + '</span>';
    btn.onclick = function() { applyReservedMode(mode.key); };
    root.appendChild(btn);
  });
}

function renderRelayQuick() {
  const relaysEl = document.getElementById('cv-relays');
  if (!relaysEl) return;

  const devices = config.devices || [];
  relaysEl.innerHTML = '';
  if (!devices.length) {
    relaysEl.innerHTML = '<span class="cv-empty">暂无设备</span>';
    return;
  }

  devices.forEach(function(device) {
    const status = deviceStatus[device.ip];
    const connected = !!(status && status.connected);
    const channelCount = typeof getDeviceChannelCount === 'function'
      ? getDeviceChannelCount(device)
      : (parseInt(device.channel_count, 10) || 32);
    const row = document.createElement('div');
    row.className = 'cv-group' + (connected ? '' : ' offline');

    const info = document.createElement('div');
    info.className = 'cv-group-info';
    const name = document.createElement('span');
    name.className = 'cv-group-name';
    name.textContent = device.name || device.ip;
    const meta = document.createElement('span');
    meta.className = 'cv-group-meta';
    meta.textContent = channelCount + ' 路 · ' + (connected ? '已连接' : '未连接');
    info.appendChild(name);
    info.appendChild(meta);

    const btns = document.createElement('div');
    btns.className = 'cv-group-btns';
    const onBtn = document.createElement('button');
    onBtn.className = 'cv-mini on';
    onBtn.textContent = '全开';
    onBtn.disabled = !connected;
    onBtn.onclick = function() { toggleDeviceAll(device.ip, true); };
    const offBtn = document.createElement('button');
    offBtn.className = 'cv-mini off';
    offBtn.textContent = '全关';
    offBtn.disabled = !connected;
    offBtn.onclick = function() { toggleDeviceAll(device.ip, false); };
    btns.appendChild(onBtn);
    btns.appendChild(offBtn);

    row.appendChild(info);
    row.appendChild(btns);
    relaysEl.appendChild(row);
  });
}

function renderControlQuickActions() {
  const groupsEl = document.getElementById('cv-groups');
  const scenesEl = document.getElementById('cv-scenes');
  if (groupsEl) {
    const stats = (typeof getGroupStats === 'function') ? getGroupStats() : [];
    groupsEl.innerHTML = stats.length ? '' : '<span class="cv-empty">暂无分组</span>';
    stats.forEach(function(g) {
      const chip = document.createElement('div');
      chip.className = 'cv-group';
      chip.innerHTML = '<div class="cv-group-info"><span class="cv-group-name">' + escapeHtml(g.label) +
        '</span><span class="cv-group-meta">' + g.on + '/' + g.count + ' 开</span></div>' +
        '<div class="cv-group-btns"><button class="cv-mini on">开</button><button class="cv-mini off">关</button></div>';
      chip.querySelector('.on').onclick = function() { applyGroupState(g.key, true); };
      chip.querySelector('.off').onclick = function() { applyGroupState(g.key, false); };
      groupsEl.appendChild(chip);
    });
  }
  if (scenesEl) {
    const scenes = (config.scenes || []);
    scenesEl.innerHTML = scenes.length ? '' : '<span class="cv-empty">暂无场景</span>';
    scenes.forEach(function(scene, i) {
      const btn = document.createElement('button');
      btn.className = 'cv-scene';
      btn.textContent = scene.name || ('场景' + (i + 1));
      btn.onclick = function() { applyScene(i); };
      scenesEl.appendChild(btn);
    });
  }
  renderRelayQuick();
}

function renderControlByChannel(body) {
  const devices = config.devices || [];
  if (!devices.length) { body.innerHTML = '<div class="cv-empty-big">还没有设备，请在「配置」里添加。</div>'; return; }
  const lightByKey = {};
  (config.lights || []).forEach(function(l, i) { lightByKey[l.device_ip + '#' + l.channel] = { idx: i, light: l }; });
  let html = '';
  devices.forEach(function(device) {
    const stats = getDeviceBoardStats(device);
    const expanded = !!controlDeviceDetailsOpen[device.ip];
    const connected = stats.connected;
    const status = deviceStatus[device.ip];
    let maxCh = (typeof getDeviceChannelCount === 'function') ? getDeviceChannelCount(device) : (device.channel_count || 32);
    (config.lights || []).forEach(function(l) { if (l.device_ip === device.ip) maxCh = Math.max(maxCh, l.channel + 1); });
    html += '<div class="cv-card ' + (expanded ? 'expanded' : 'collapsed') + '" data-card-ip="' + escapeHtml(device.ip) + '"><div class="cv-card-head">' +
      '<span class="cv-dot ' + (connected ? 'on' : '') + '"></span>' +
      '<span class="cv-card-name">' + escapeHtml(device.name || device.ip) + '</span>' +
      '<span class="cv-card-sub" data-role="device-meta">' + escapeHtml(getDeviceBoardMeta(stats)) + '</span>' +
      '<button class="cv-mini ' + (stats.anyOn ? 'off' : 'on') + '" data-device-toggle-ip="' + escapeHtml(device.ip) + '"' + (connected ? '' : ' disabled') + '>' +
        (stats.anyOn ? '全关' : '全开') +
      '</button>' +
      '<button class="cv-mini" data-detail-ip="' + escapeHtml(device.ip) + '">' + (expanded ? '收起通道' : '展开通道') + '</button>' +
      '</div>';
    if (expanded) {
      html += '<div class="cv-grid">';
      for (let ch = 0; ch < maxCh; ch++) {
        const bound = lightByKey[device.ip + '#' + ch];
        const on = connected && status && status.relay_states && !!status.relay_states[ch];
        const pending = connected && isChannelPending(device.ip, ch);
        html += controlBreakerHtml({
          ip: device.ip, channel: ch, lightIdx: bound ? bound.idx : -1, on: on, pending: pending, connected: connected,
          label: bound ? (bound.light.name || ('通道' + pad2(ch + 1))) : ('通道' + pad2(ch + 1)),
          sub: bound ? ('通道' + pad2(ch + 1)) : '未绑定'
        });
      }
      html += '</div>';
    }
    html += '</div>';
  });
  body.innerHTML = html;
  const toggleBtns = body.querySelectorAll('.cv-mini[data-device-toggle-ip]');
  for (let i = 0; i < toggleBtns.length; i++) {
    toggleBtns[i].onclick = function() {
      const ip = this.getAttribute('data-device-toggle-ip');
      const device = getDeviceByIp(ip);
      const stats = getDeviceBoardStats(device);
      toggleDeviceAll(ip, !stats.anyOn);
    };
  }
  const detailBtns = body.querySelectorAll('.cv-mini[data-detail-ip]');
  for (let i = 0; i < detailBtns.length; i++) {
    detailBtns[i].onclick = function() {
      const ip = this.getAttribute('data-detail-ip');
      controlDeviceDetailsOpen[ip] = !controlDeviceDetailsOpen[ip];
      renderControlView();
    };
  }
}

function renderControlByAppliance(body) {
  const lights = config.lights || [];
  if (!lights.length) { body.innerHTML = '<div class="cv-empty-big">还没有电器，请在「配置」里添加。</div>'; return; }
  const stats = (typeof getGroupStats === 'function') ? getGroupStats() : [];
  let html = '';
  stats.forEach(function(g) {
    html += '<div class="cv-card"><div class="cv-card-head">' +
      '<span class="cv-card-name">' + escapeHtml(g.label) + '</span>' +
      '<span class="cv-card-sub">' + g.on + '/' + g.count + ' 开</span>' +
      '<button class="cv-mini on" data-group="' + escapeHtml(g.key) + '" data-val="1">全开</button>' +
      '<button class="cv-mini off" data-group="' + escapeHtml(g.key) + '" data-val="0">全关</button>' +
      '</div><div class="cv-grid">';
    g.indices.forEach(function(idx) {
      const light = lights[idx];
      const status = deviceStatus[light.device_ip];
      const connected = !!(status && status.connected);
      const on = connected && status.relay_states && !!status.relay_states[light.channel];
      const pending = connected && isChannelPending(light.device_ip, light.channel);
      html += controlBreakerHtml({
        ip: light.device_ip, channel: light.channel, lightIdx: idx, on: on, pending: pending, connected: connected,
        label: light.name || ('通道' + pad2(light.channel + 1)),
        sub: getDeviceDisplayName(light.device_ip) + ' · 通道' + pad2(light.channel + 1)
      });
    });
    html += '</div></div>';
  });
  body.innerHTML = html;
  // 分组全开/全关
  const minis = body.querySelectorAll('.cv-mini[data-group]');
  for (let i = 0; i < minis.length; i++) {
    minis[i].onclick = function() {
      applyGroupState(this.getAttribute('data-group'), this.getAttribute('data-val') === '1');
    };
  }
}

function renderControlView() {
  const ctrl = document.getElementById('control-panel');
  const body = document.getElementById('cv-body');
  if (!ctrl || !body || topView !== 'control') return;
  renderPrimaryControlButtons();
  renderControlQuickActions();
  if (controlMode === 'appliance') renderControlByAppliance(body);
  else renderControlByChannel(body);
  body.setAttribute('data-mode', controlMode);
}

// 原地更新各开关状态(保留滑动动画、避免每次轮询整块重绘闪烁)
function updateControlStates() {
  const body = document.getElementById('cv-body');
  if (!body) return;
  renderPrimaryControlButtons();
  const sws = body.querySelectorAll('.lsw');
  for (let i = 0; i < sws.length; i++) {
    const sw = sws[i];
    const ip = sw.getAttribute('data-ip');
    const ch = parseInt(sw.getAttribute('data-ch'), 10);
    const status = deviceStatus[ip];
    const connected = !!(status && status.connected);
    const on = connected && status.relay_states && !!status.relay_states[ch];
    const pending = connected && isChannelPending(ip, ch);
    sw.classList.toggle('on', !!on);
    sw.classList.toggle('pending', !!pending);
    sw.classList.toggle('offline', !connected);
    const txt = sw.querySelector('.lsw-text');
    if (txt) txt.textContent = pending ? 'WAIT' : (on ? 'ON' : 'OFF');
  }
  const cards = body.querySelectorAll('.cv-card[data-card-ip]');
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const ip = card.getAttribute('data-card-ip');
    const device = getDeviceByIp(ip);
    if (!device) continue;
    const stats = getDeviceBoardStats(device);
    const dot = card.querySelector('.cv-dot');
    const meta = card.querySelector('[data-role="device-meta"]');
    const toggle = card.querySelector('.cv-mini[data-device-toggle-ip]');
    if (dot) dot.classList.toggle('on', stats.connected);
    if (meta) meta.textContent = getDeviceBoardMeta(stats);
    if (toggle) {
      toggle.disabled = !stats.connected;
      toggle.textContent = stats.anyOn ? '全关' : '全开';
      toggle.classList.toggle('on', !stats.anyOn);
      toggle.classList.toggle('off', stats.anyOn);
    }
  }
  const deviceBtns = body.querySelectorAll('.cv-mini[data-device-toggle-ip]');
  for (let i = 0; i < deviceBtns.length; i++) {
    const btn = deviceBtns[i];
    const ip = btn.getAttribute('data-device-toggle-ip');
    const status = deviceStatus[ip];
    btn.disabled = !(status && status.connected);
  }
  renderControlQuickActions();
}

// 状态轮询时调用: 结构不变就原地更新, 否则全量重建
function syncControlView() {
  if (topView !== 'control') return;
  const body = document.getElementById('cv-body');
  if (!body) return;
  const canUpdateChannel = controlMode === 'channel' &&
    body.querySelectorAll('.cv-card[data-card-ip]').length === (config.devices || []).length;
  const canUpdateAppliance = controlMode === 'appliance' && body.querySelector('.lsw');
  if (body.getAttribute('data-mode') === controlMode && (canUpdateChannel || canUpdateAppliance)) {
    updateControlStates();
  } else {
    renderControlView();
  }
}

function onControlBodyClick(event) {
  const sw = event.target && event.target.closest ? event.target.closest('.lsw') : null;
  if (!sw) return;
  if (sw.classList.contains('offline')) {
    showToast('warn', '设备离线', '请先在「配置」里连接该继电器再操作。');
    return;
  }
  // 乐观动画: 立即翻转胶囊, 服务器确认后由状态同步校正
  if (sw.classList.contains('pending')) return;
  const lightIdx = parseInt(sw.getAttribute('data-light'), 10);
  if (Number.isFinite(lightIdx) && lightIdx >= 0) {
    toggleLight(lightIdx);
  } else {
    toggleDeviceChannel(sw.getAttribute('data-ip'), parseInt(sw.getAttribute('data-ch'), 10));
  }
}

// ========== 使用统计看板 ==========
let statsRange = 7;       // 1 | 7 | 30 天
let statsDim = 'light';   // 'light' | 'group' | 'device'

function _statsLights() {
  return (config.lights || []).map(function(l, i) {
    const key = l.device_ip + '#' + l.channel;
    const u = (usageData && usageData.usage && usageData.usage[key]) ||
      { total_seconds: 0, today_seconds: 0, switch_count: 0, on: false, daily: {} };
    return { light: l, idx: i, key: key, u: u };
  });
}

function _statsDayList(n) {
  const out = [];
  const today = (usageData && usageData.today) || null;
  let base;
  if (today) { const p = today.split('-'); base = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  else base = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400000);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    out.push({ iso: d.getFullYear() + '-' + mm + '-' + dd, label: mm + '-' + dd });
  }
  return out;
}

function _statsAgg(items, dim) {
  if (dim === 'light') {
    return items.map(function(it) {
      return { label: it.light.name || ('通道' + pad2(it.light.channel + 1)),
        total: it.u.total_seconds || 0, today: it.u.today_seconds || 0,
        count: it.u.switch_count || 0, on: !!it.u.on, daily: it.u.daily || {} };
    });
  }
  const map = {}; const order = [];
  items.forEach(function(it) {
    let k, label;
    if (dim === 'group') {
      k = (typeof getLightGroupKey === 'function') ? getLightGroupKey(it.light) : (it.light.group || '未分组');
      label = (typeof getGroupLabel === 'function') ? getGroupLabel(k) : k;
    } else {
      k = it.light.device_ip;
      label = (typeof getDeviceDisplayName === 'function') ? getDeviceDisplayName(it.light.device_ip) : it.light.device_ip;
    }
    if (!map[k]) { map[k] = { label: label, total: 0, today: 0, count: 0, on: 0, daily: {} }; order.push(k); }
    const m = map[k];
    m.total += it.u.total_seconds || 0; m.today += it.u.today_seconds || 0;
    m.count += it.u.switch_count || 0; if (it.u.on) m.on += 1;
    const d = it.u.daily || {};
    for (const day in d) { if (Object.prototype.hasOwnProperty.call(d, day)) m.daily[day] = (m.daily[day] || 0) + d[day]; }
  });
  return order.map(function(k) { return map[k]; });
}

function _fmtDur(sec) { return (typeof formatUsageDuration === 'function') ? formatUsageDuration(sec) : (Math.round(sec) + ' 秒'); }
function _fmtShort(sec) {
  if (sec >= 3600) return (sec / 3600).toFixed(1) + 'h';
  if (sec >= 60) return Math.round(sec / 60) + 'm';
  return Math.round(sec) + 's';
}

function _statsLightLabel(item) {
  if (!item || !item.light) return '暂无灯具';
  return item.light.name || ('通道' + pad2(item.light.channel + 1));
}

function _statsMaxLight(items, fieldName) {
  let best = null;
  (items || []).forEach(function(item) {
    const value = item && item.u ? (item.u[fieldName] || 0) : 0;
    if (!best || value > best.value) {
      best = { item: item, value: value };
    }
  });
  return best || { item: null, value: 0 };
}

function _statsDailyMaxLight(items, dayIso) {
  let maxValue = 0;
  (items || []).forEach(function(item) {
    const daily = item && item.u && item.u.daily ? item.u.daily : {};
    maxValue = Math.max(maxValue, daily[dayIso] || 0);
  });
  return maxValue;
}

function drawTrendChart(canvas, labels, values) {
  if (!canvas) return;
  const w = Math.max(280, canvas.clientWidth || 600);
  const h = 190;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const padL = 10, padR = 10, padTop = 18, padBot = 22;
  const plotW = w - padL - padR, plotH = h - padTop - padBot;
  const n = values.length || 1;
  let max = 1; for (let i = 0; i < values.length; i++) max = Math.max(max, values[i]);
  const bw = plotW / n;
  ctx.strokeStyle = '#2c313c'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, padTop + plotH); ctx.lineTo(padL + plotW, padTop + plotH); ctx.stroke();
  const labelStep = n > 12 ? Math.ceil(n / 8) : 1;
  for (let i = 0; i < n; i++) {
    const v = values[i] || 0;
    const bh = (v / max) * plotH;
    const x = padL + i * bw + bw * 0.18;
    const barW = Math.max(2, bw * 0.64);
    const y = padTop + plotH - bh;
    const g = ctx.createLinearGradient(0, y, 0, padTop + plotH);
    g.addColorStop(0, '#3ee066'); g.addColorStop(1, '#1f7a36');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, barW, bh);
    if (v > 0 && bw > 26) { ctx.fillStyle = '#cfd3da'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(_fmtShort(v), x + barW / 2, y - 4); }
    if (i % labelStep === 0) { ctx.fillStyle = '#8a9099'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(labels[i], padL + i * bw + bw / 2, h - 7); }
  }
}

function _statCard(label, value, sub) {
  return '<div class="stat-card"><div class="stat-card-label">' + escapeHtml(label) +
    '</div><div class="stat-card-val">' + escapeHtml(value) + '</div>' +
    (sub ? '<div class="stat-card-sub">' + escapeHtml(sub) + '</div>' : '') + '</div>';
}

function renderStatsRank(items) {
  const el = document.getElementById('stats-rank');
  if (!el) return;
  if (!items.length) { el.innerHTML = '<div class="cv-empty">暂无数据</div>'; return; }
  let max = 1; for (let i = 0; i < items.length; i++) max = Math.max(max, items[i].total);
  el.innerHTML = items.map(function(it) {
    const pct = (it.total / max * 100).toFixed(1);
    return '<div class="rank-row"><div class="rank-name" title="' + escapeHtml(it.label) + '">' + escapeHtml(it.label) + '</div>' +
      '<div class="rank-track"><div class="rank-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="rank-val">' + escapeHtml(_fmtDur(it.total)) + '</div></div>';
  }).join('');
}

function renderStatsTable(items) {
  const el = document.getElementById('stats-table');
  if (!el) return;
  if (!items.length) { el.innerHTML = '<div class="cv-empty">暂无数据</div>'; return; }
  let html = '<div class="st-row st-head"><span class="st-name">名称</span><span>今日</span><span>累计</span><span>次数</span></div>';
  html += items.map(function(it) {
    return '<div class="st-row"><span class="st-name" title="' + escapeHtml(it.label) + '">' + escapeHtml(it.label) + '</span>' +
      '<span>' + escapeHtml(_fmtDur(it.today)) + '</span>' +
      '<span>' + escapeHtml(_fmtDur(it.total)) + '</span>' +
      '<span>' + (it.count || 0) + '</span></div>';
  }).join('');
  el.innerHTML = html;
}

function renderStatsView() {
  if (topView !== 'stats') return;
  const cardsEl = document.getElementById('stats-cards');
  if (!cardsEl || !usageData || !usageData.usage) return;
  const items = _statsLights();
  let count = 0, on = 0;
  items.forEach(function(it) {
    count += it.u.switch_count || 0; if (it.u.on) on += 1;
  });
  const todayMax = _statsMaxLight(items, 'today_seconds');
  const totalMax = _statsMaxLight(items, 'total_seconds');
  cardsEl.innerHTML =
    _statCard('今日单灯最长', _fmtDur(todayMax.value), _statsLightLabel(todayMax.item)) +
    _statCard('累计单灯最长', _fmtDur(totalMax.value), _statsLightLabel(totalMax.item)) +
    _statCard('当前点亮', on + ' / ' + items.length) +
    _statCard('开关次数合计', String(count));
  const days = _statsDayList(statsRange);
  const series = days.map(function(d) { return _statsDailyMaxLight(items, d.iso); });
  const tt = document.getElementById('stats-trend-title');
  if (tt) tt.textContent = (statsRange === 1 ? '今日单灯最长点亮时长' : '近 ' + statsRange + ' 天每日单灯最长点亮时长趋势');
  drawTrendChart(document.getElementById('stats-trend'), days.map(function(d) { return d.label; }), series);
  const agg = _statsAgg(items, statsDim).slice().sort(function(a, b) { return b.total - a.total; });
  renderStatsRank(agg.slice(0, 10));
  renderStatsTable(agg);
}

async function refreshStatsData() {
  if (topView !== 'stats') return;
  const msg = document.getElementById('stats-msg');
  try {
    const res = await fetch('/api/usage');
    let json = null;
    if (res.ok) json = await res.json();
    if (!json || json.ok !== true) {
      if (msg) { msg.hidden = false; msg.textContent = '用量统计暂不可用：需要重启后端服务后才能统计。'; }
      return;
    }
    if (msg) msg.hidden = true;
    usageData = json;
    renderStatsView();
  } catch (error) {
    if (msg) { msg.hidden = false; msg.textContent = '无法获取统计数据，请检查后端服务。'; }
  }
}

function setStatsRange(n) {
  statsRange = (n === 1 || n === 30) ? n : 7;
  const seg = document.getElementById('stats-range-seg');
  if (seg) {
    const bs = seg.querySelectorAll('.seg-btn');
    for (let i = 0; i < bs.length; i++) bs[i].classList.toggle('active', parseInt(bs[i].getAttribute('data-range'), 10) === statsRange);
  }
  renderStatsView();
}

function setStatsDim(d) {
  statsDim = (d === 'group' || d === 'device') ? d : 'light';
  const seg = document.getElementById('stats-dim-seg');
  if (seg) {
    const bs = seg.querySelectorAll('.seg-btn');
    for (let i = 0; i < bs.length; i++) bs[i].classList.toggle('active', bs[i].getAttribute('data-dim') === statsDim);
  }
  renderStatsView();
}

// 导出统计 CSV: 跟随当前"维度 + 时间范围", 含每日明细
function exportStatsCsv() {
  if (!usageData || !usageData.usage) {
    showToast('warn', '暂无数据', '还没有可导出的统计数据。');
    return;
  }
  const items = _statsLights();
  const agg = _statsAgg(items, statsDim).slice().sort(function(a, b) { return b.total - a.total; });
  const days = _statsDayList(statsRange);
  const dimName = statsDim === 'group' ? '分组' : (statsDim === 'device' ? '继电器' : '灯');
  function field(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const header = ['名称', '今日点亮(分钟)', '累计点亮(分钟)', '开关次数'].concat(days.map(function(d) { return d.label + '(分钟)'; }));
  const rows = [header];
  agg.forEach(function(it) {
    const row = [it.label, (it.today / 60).toFixed(1), (it.total / 60).toFixed(1), String(it.count || 0)];
    days.forEach(function(d) { const s = (it.daily && it.daily[d.iso]) || 0; row.push((s / 60).toFixed(1)); });
    rows.push(row);
  });
  const csv = '﻿' + rows.map(function(r) { return r.map(field).join(','); }).join('\r\n');
  try {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '使用统计_' + dimName + '_' + (statsRange === 1 ? '今日' : '近' + statsRange + '天') + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  } catch (error) {
    showToast('error', '导出失败', getErrorMessage(error, '无法生成 CSV'));
  }
}

window.switchTopView = switchTopView;
window.setControlMode = setControlMode;
window.renderControlView = renderControlView;
window.toggleDeviceAll = toggleDeviceAll;
window.refreshStatsData = refreshStatsData;
window.setStatsRange = setStatsRange;
window.setStatsDim = setStatsDim;
window.exportStatsCsv = exportStatsCsv;

(function initControlView() {
  const body = document.getElementById('cv-body');
  if (body) body.addEventListener('click', onControlBodyClick);
})();

refreshMainPanel();
scheduleSceneResize();
refreshPanelSections();
updateLayoutUI();
window.onDeviceProtocolChange();
window.onSetupDeviceProtocolChange();
loadConfig();
switchTopView('control');   // 默认打开"操控"界面

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
  if (typeof runAutoReconnectCheck === 'function') runAutoReconnectCheck();
});

// Tibber 风格 HUD: 时钟 + 室外温度 (真实天气来自 /api/weather)
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

  function fmtTemp(v) {
    return (v == null || !isFinite(v)) ? '— °C' : (Math.round(v * 10) / 10).toFixed(1) + ' °C';
  }
  async function tickWeather() {
    let next = 600000;
    try {
      const res = await fetch('/api/weather');
      const json = await res.json();
      if (json && json.ok) {
        const m = document.getElementById('hud-temp-main');
        const h = document.getElementById('hud-temp-high');
        const l = document.getElementById('hud-temp-low');
        const t = document.getElementById('hud-weather-text');
        if (m) m.textContent = fmtTemp(json.temperature);
        if (h) h.textContent = fmtTemp(json.high);
        if (l) l.textContent = fmtTemp(json.low);
        if (t) t.textContent = '西昌 · ' + (json.weather_text || '--');
      } else {
        throw new Error('weather not ok');
      }
    } catch (err) {
      // 接口不可用 (如后端未重启返回 404) 时静默重试, 界面保持原值
      next = 120000;
    } finally {
      setTimeout(tickWeather, next);
    }
  }
  tickWeather();
})();
