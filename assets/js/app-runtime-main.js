// Runtime state, device actions, and enhanced lamp rendering.

function animate() {
  requestAnimationFrame(animate);
  const time = performance.now() * 0.001;
  const delta = animate._lastTime == null ? 0.016 : Math.min(0.05, time - animate._lastTime);
  animate._lastTime = time;
  lamps.forEach(function(lamp) {
    if (lamp.tick) lamp.tick(time);
  });
  if (walkMode) updateWalkMovement(delta);
  else controls.update();
  if (typeof updateRoofFade === 'function') updateRoofFade();
  if (typeof updateWalkInteractionState === 'function') updateWalkInteractionState();
  renderer.render(scene, camera);
}
animate();

const DEFAULT_DEVICE_PROTOCOL = 'modbus_tcp';
const DEFAULT_DEVICE_CHANNEL_COUNT = 16;
const STATUS_POLL_INTERVAL_MS = 1500;
const DEVICE_PROTOCOLS = Object.freeze({
  modbus_tcp: {
    key: 'modbus_tcp',
    label: 'Modbus TCP',
    defaultPort: 502
  },
  siemens_s7: {
    key: 'siemens_s7',
    label: 'Siemens S7-1200',
    defaultPort: 102
  }
});

const UNGROUPED_GROUP_KEY = '__ungrouped__';
const SETUP_WIZARD_STEPS = ['device', 'appliances', 'scenes'];

let config = { devices: [], lights: [], scenes: [], layout: normalizeLayoutData(DEFAULT_LAYOUT) };
let deviceStatus = {};
let editingLights = [];
let editingScenes = [];
let editingDeviceIp = null;
let statusPollTimer = null;
let statusRefreshInFlight = false;
let statusRefreshQueued = false;
let runtimeOpsInFlight = 0;
let batchAllInFlight = false;
let toastSequence = 0;
let setupWizardState = {
  step: 0,
  deviceTargetIp: null,
  deviceConnected: false,
  lastGroupName: ''
};
const deviceActionLocks = new Set();
const lightToggleLocks = new Set();

function parseIntOr(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInteger(value, fallback, min, max) {
  const parsed = parseIntOr(value, fallback);
  return clamp(parsed, min, max);
}

function getDeviceProtocolMeta(deviceOrProtocol) {
  const protocol = typeof deviceOrProtocol === 'string'
    ? deviceOrProtocol
    : (deviceOrProtocol && deviceOrProtocol.protocol);
  return DEVICE_PROTOCOLS[protocol] || DEVICE_PROTOCOLS[DEFAULT_DEVICE_PROTOCOL];
}

function getDeviceChannelCount(device) {
  return clampInteger(device && device.channel_count, DEFAULT_DEVICE_CHANNEL_COUNT, 1, 128);
}

function normalizeDevice(device) {
  const source = Object.assign({}, device || {});
  const protocol = getDeviceProtocolMeta(source).key;
  const meta = getDeviceProtocolMeta(protocol);
  const next = {
    name: String(source.name || '未命名设备'),
    ip: String(source.ip || '').trim(),
    protocol: protocol,
    port: clampInteger(source.port, meta.defaultPort, 1, 65535),
    channel_count: getDeviceChannelCount(source)
  };

  if (protocol === 'siemens_s7') {
    next.rack = clampInteger(source.rack, 0, 0, 7);
    next.slot = clampInteger(source.slot, 1, 1, 32);
    next.db_number = clampInteger(source.db_number, 1, 1, 65535);
    next.start_byte = clampInteger(source.start_byte, 0, 0, 65535);
  } else {
    next.unit_id = clampInteger(source.unit_id, 254, 0, 255);
  }

  return next;
}

function normalizeDevices(devices) {
  return (devices || [])
    .map(normalizeDevice)
    .filter(function(device) { return !!device.ip; });
}

function getDeviceByIp(ip) {
  return (config.devices || []).find(function(device) {
    return device.ip === ip;
  }) || null;
}

function getLightDevice(light) {
  return light ? getDeviceByIp(light.device_ip) : null;
}

function getDeviceDisplayName(deviceOrIp) {
  if (!deviceOrIp) return '未命名设备';
  if (typeof deviceOrIp === 'string') {
    const found = getDeviceByIp(deviceOrIp);
    return found ? (found.name || found.ip) : deviceOrIp;
  }
  return deviceOrIp.name || deviceOrIp.ip || '未命名设备';
}

function getDeviceSummary(device) {
  const meta = getDeviceProtocolMeta(device);
  const channelText = getDeviceChannelCount(device) + ' 路';
  if (meta.key === 'siemens_s7') {
    return [
      meta.label,
      device.ip + ':' + device.port,
      '机架 ' + device.rack + ' / 槽号 ' + device.slot,
      '数据块 ' + device.db_number + ' / 字节 ' + device.start_byte,
      channelText
    ].join(' / ');
  }
  return [
    meta.label,
    device.ip + ':' + device.port,
    '站号 ' + device.unit_id,
    channelText
  ].join(' / ');
}

function getErrorMessage(error, fallback) {
  if (error && error.message) return error.message;
  return fallback || '未知错误';
}

function normalizeGroupName(value) {
  return String(value || '').trim();
}

function getLightGroupKey(light) {
  const groupName = normalizeGroupName(light && light.group);
  return groupName || UNGROUPED_GROUP_KEY;
}

function getGroupLabel(groupKey) {
  return groupKey === UNGROUPED_GROUP_KEY ? '未分组' : groupKey;
}

function normalizeScene(scene) {
  const source = Object.assign({}, scene || {});
  const states = {};
  Object.keys(source.states || {}).forEach(function(key) {
    const normalizedKey = normalizeGroupName(key) || UNGROUPED_GROUP_KEY;
    const value = source.states[key];
    if (value === 'on' || value === 'off') {
      states[normalizedKey] = value;
    }
  });
  return {
    name: String(source.name || '新场景').trim() || '新场景',
    description: String(source.description || '').trim(),
    states: states
  };
}

function normalizeScenes(scenes) {
  return (scenes || [])
    .map(normalizeScene)
    .filter(function(scene) {
      return !!scene.name;
    });
}

function getKnownGroupKeys(includeSceneOnlyGroups) {
  const keys = [];
  const used = new Set();

  (config.lights || []).forEach(function(light) {
    const key = getLightGroupKey(light);
    if (!used.has(key)) {
      used.add(key);
      keys.push(key);
    }
  });

  if (includeSceneOnlyGroups) {
    (config.scenes || []).forEach(function(scene) {
      Object.keys((scene && scene.states) || {}).forEach(function(key) {
        if (!used.has(key)) {
          used.add(key);
          keys.push(key);
        }
      });
    });
  }

  return keys;
}

function getFriendlyMessage(message, context) {
  const raw = String(message || '').trim();
  const lower = raw.toLowerCase();
  if (!raw) return '未知错误';
  if (lower.indexOf('s7 driver is not wired in yet') >= 0) {
    return '当前已展示 Siemens S7-1200 参数，但 S7 驱动尚未接通。请先使用 Modbus TCP，或将该协议标记为测试版。';
  }
  if (lower.indexOf('connection failed') >= 0) {
    return '连接失败，请检查 IP、端口、协议，以及当前网络下设备是否可达。';
  }
  if (lower.indexOf('device is not connected') >= 0) {
    return '目标设备当前离线，请先连接设备再执行该操作。';
  }
  if (lower.indexOf('channel range exceeds') >= 0) {
    return '所选通道超出了该设备当前配置的通道数量。';
  }
  if (context === 'save') {
    return '保存失败。' + raw;
  }
  return raw;
}

function showToast(tone, title, body, options) {
  const root = document.getElementById('toast-stack');
  if (!root) return;

  const toast = document.createElement('div');
  const duration = options && typeof options.duration === 'number' ? options.duration : 3800;
  toastSequence += 1;
  toast.className = 'toast ' + (tone || 'info');
  toast.dataset.toastId = String(toastSequence);
  toast.innerHTML =
    '<div class="toast-title">' + escapeHtml(title || '提示') + '</div>' +
    '<div class="toast-body">' + escapeHtml(body || '') + '</div>';
  root.appendChild(toast);

  setTimeout(function() {
    toast.remove();
  }, duration);
}

function setNotice(id, tone, title, body) {
  const notice = document.getElementById(id);
  if (!notice) return;
  notice.hidden = false;
  notice.className = 'modal-notice ' + (tone || 'info');
  notice.innerHTML =
    '<div class="notice-title">' + escapeHtml(title || 'Notice') + '</div>' +
    '<div>' + escapeHtml(body || '') + '</div>';
}

function clearNotice(id) {
  const notice = document.getElementById(id);
  if (!notice) return;
  notice.hidden = true;
  notice.className = 'modal-notice';
  notice.innerHTML = '';
}

function getDeviceFieldId(prefix, field) {
  return prefix + '-' + field;
}

function getDeviceField(prefix, field) {
  return document.getElementById(getDeviceFieldId(prefix, field));
}

function fillDeviceForm(prefix, device) {
  const next = normalizeDevice(device || {});
  const defaults = {
    name: prefix === 'setup-device' ? '主控器' : '新设备',
    ip: '192.168.1.100',
    protocol: DEFAULT_DEVICE_PROTOCOL,
    port: getDeviceProtocolMeta(DEFAULT_DEVICE_PROTOCOL).defaultPort,
    channel_count: DEFAULT_DEVICE_CHANNEL_COUNT,
    unit_id: 254,
    rack: 0,
    slot: 1,
    db_number: 1,
    start_byte: 0
  };
  const merged = Object.assign({}, defaults, next);

  const nameInput = getDeviceField(prefix, 'name');
  const ipInput = getDeviceField(prefix, 'ip');
  const protocolInput = getDeviceField(prefix, 'protocol');
  const portInput = getDeviceField(prefix, 'port');
  const channelCountInput = getDeviceField(prefix, 'channel-count');
  const unitInput = getDeviceField(prefix, 'unit');
  const rackInput = getDeviceField(prefix, 'rack');
  const slotInput = getDeviceField(prefix, 'slot');
  const dbInput = getDeviceField(prefix, 'db-number');
  const startByteInput = getDeviceField(prefix, 'start-byte');

  if (nameInput) nameInput.value = merged.name;
  if (ipInput) ipInput.value = merged.ip;
  if (protocolInput) protocolInput.value = merged.protocol;
  if (portInput) portInput.value = String(merged.port);
  if (channelCountInput) channelCountInput.value = String(merged.channel_count);
  if (unitInput) unitInput.value = String(merged.unit_id);
  if (rackInput) rackInput.value = String(merged.rack);
  if (slotInput) slotInput.value = String(merged.slot);
  if (dbInput) dbInput.value = String(merged.db_number);
  if (startByteInput) startByteInput.value = String(merged.start_byte);
  syncProtocolForm(prefix);
}

function buildDeviceFromForm(prefix) {
  const protocol = getDeviceProtocolMeta(getDeviceField(prefix, 'protocol') ? getDeviceField(prefix, 'protocol').value : DEFAULT_DEVICE_PROTOCOL).key;
  const meta = getDeviceProtocolMeta(protocol);
  const device = {
    name: getDeviceField(prefix, 'name') ? getDeviceField(prefix, 'name').value : '未命名设备',
    ip: getDeviceField(prefix, 'ip') ? getDeviceField(prefix, 'ip').value.trim() : '',
    protocol: protocol,
    port: parseIntOr(getDeviceField(prefix, 'port') ? getDeviceField(prefix, 'port').value : '', meta.defaultPort),
    channel_count: clampInteger(
      getDeviceField(prefix, 'channel-count') ? getDeviceField(prefix, 'channel-count').value : DEFAULT_DEVICE_CHANNEL_COUNT,
      DEFAULT_DEVICE_CHANNEL_COUNT,
      1,
      128
    )
  };

  if (protocol === 'siemens_s7') {
    device.rack = parseIntOr(getDeviceField(prefix, 'rack') ? getDeviceField(prefix, 'rack').value : '', 0);
    device.slot = parseIntOr(getDeviceField(prefix, 'slot') ? getDeviceField(prefix, 'slot').value : '', 1);
    device.db_number = parseIntOr(getDeviceField(prefix, 'db-number') ? getDeviceField(prefix, 'db-number').value : '', 1);
    device.start_byte = parseIntOr(getDeviceField(prefix, 'start-byte') ? getDeviceField(prefix, 'start-byte').value : '', 0);
  } else {
    device.unit_id = parseIntOr(getDeviceField(prefix, 'unit') ? getDeviceField(prefix, 'unit').value : '', 254);
  }

  return normalizeDevice(device);
}

function syncProtocolForm(prefix) {
  const protocolInput = getDeviceField(prefix, 'protocol');
  const portInput = getDeviceField(prefix, 'port');
  const unitInput = getDeviceField(prefix, 'unit');
  const selectedProtocol = getDeviceProtocolMeta(protocolInput ? protocolInput.value : DEFAULT_DEVICE_PROTOCOL);
  const prefixMarker = prefix === 'setup-device' ? 'setup-device:' : '';

  if (portInput) {
    const currentPort = parseIntOr(portInput.value, selectedProtocol.defaultPort);
    const knownDefaultPorts = Object.keys(DEVICE_PROTOCOLS).map(function(key) {
      return DEVICE_PROTOCOLS[key].defaultPort;
    });
    if (!portInput.value || knownDefaultPorts.indexOf(currentPort) >= 0) {
      portInput.value = String(selectedProtocol.defaultPort);
    }
  }

  document.querySelectorAll('[data-device-protocol]').forEach(function(node) {
    const marker = node.getAttribute('data-device-protocol') || '';
    if (!prefixMarker && marker.indexOf(':') >= 0) return;
    if (prefixMarker && marker.indexOf(prefixMarker) !== 0) return;
    node.hidden = marker !== prefixMarker + selectedProtocol.key;
  });

  if (unitInput && unitInput.closest('.form-item')) {
    unitInput.closest('.form-item').hidden = selectedProtocol.key !== 'modbus_tcp';
  }
}

function resetDeviceForm() {
  editingDeviceIp = null;
  clearNotice('dev-modal-notice');
  fillDeviceForm('in', null);
}

function resetSetupWizardDeviceForm(device) {
  clearNotice('setup-device-notice');
  fillDeviceForm('setup-device', device || null);
}

window.onDeviceProtocolChange = function() {
  syncProtocolForm('in');
};

window.onSetupDeviceProtocolChange = function() {
  syncProtocolForm('setup-device');
};

async function api(path, method, body) {
  const opts = { method: method || 'GET' };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, opts);
  } catch (error) {
    throw new Error(getErrorMessage(error, '请求失败'));
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {}

  if (!response.ok) {
    throw new Error((payload && payload.error) || ('请求失败（' + response.status + '）'));
  }
  return payload;
}

function hasConnectedDevices() {
  return Object.keys(deviceStatus).some(function(ip) {
    return !!(deviceStatus[ip] && deviceStatus[ip].connected);
  });
}

function clearStatusPoll() {
  if (statusPollTimer) {
    clearTimeout(statusPollTimer);
    statusPollTimer = null;
  }
}

function scheduleStatusPoll(delayMs) {
  clearStatusPoll();
  if (statusRefreshInFlight || runtimeOpsInFlight > 0 || batchAllInFlight) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (!hasConnectedDevices()) return;
  const delay = typeof delayMs === 'number' ? delayMs : STATUS_POLL_INTERVAL_MS;
  statusPollTimer = setTimeout(function() {
    refreshStatus({ silent: true, force: false, reason: 'poll' });
  }, Math.max(0, delay));
}

function beginRuntimeOperation() {
  runtimeOpsInFlight += 1;
  clearStatusPoll();
}

function endRuntimeOperation() {
  runtimeOpsInFlight = Math.max(0, runtimeOpsInFlight - 1);
  if (runtimeOpsInFlight === 0 && !batchAllInFlight) {
    scheduleStatusPoll();
  }
}

async function saveConfigData() {
  config.devices = normalizeDevices(config.devices);
  config.lights = (config.lights || []).map(normalizeLight);
  config.scenes = normalizeScenes(config.scenes);
  const result = await api('/api/config', 'POST', config);
  if (result.ok) setLayoutDirty(false);
  return result;
}

async function loadConfig() {
  try {
    const data = await api('/api/config');
    config.devices = normalizeDevices(data.devices || []);
    config.lights = (data.lights || []).map(normalizeLight);
    config.scenes = normalizeScenes(data.scenes || []);
    config.layout = normalizeLayoutData(data.layout);
    clampLightPositionsToBuilding();
    rebuildFactoryScene();
    selectedLayout = null;
    focusedLampIdx = null;
    labelsPinned = false;
    renderDeviceList();
    renderLightRows();
    rebuildLayoutScene();
    rebuildLamps();
    applyStatus();
    setLayoutDirty(false);
    updateLayoutUI();
    refreshLabelToggleUI();
    refreshPanelSections();
    syncProtocolForm('in');
    syncProtocolForm('setup-device');
    scheduleStatusPoll(0);
    return true;
  } catch (error) {
    showToast('error', '加载失败', getFriendlyMessage(getErrorMessage(error, '未知错误')));
    return false;
  }
}

function buildProjectConfigSnapshot() {
  const layoutSnapshot = typeof normalizeLayoutData === 'function'
    ? normalizeLayoutData(config.layout)
    : (config.layout || {});
  return {
    devices: normalizeDevices(config.devices),
    lights: (config.lights || []).map(normalizeLight),
    scenes: normalizeScenes(config.scenes),
    layout: JSON.parse(JSON.stringify(layoutSnapshot))
  };
}

function buildProjectExportBundle() {
  return {
    format: 'dengkong-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    config: buildProjectConfigSnapshot()
  };
}

function makeProjectExportFileName() {
  const now = new Date();
  const pad = function(value) {
    return String(value).padStart(2, '0');
  };
  return 'dengkong-project-' +
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) + '-' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds()) + '.json';
}

function exportProjectConfig() {
  try {
    const bundle = buildProjectExportBundle();
    const fileName = makeProjectExportFileName();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function() {
      URL.revokeObjectURL(url);
    }, 0);
    showToast('success', '工程已导出', '当前厂房、设备、灯具和场景已导出到 ' + fileName);
  } catch (error) {
    showToast('error', '导出失败', getFriendlyMessage(getErrorMessage(error, '无法生成工程文件')));
  }
}

function unwrapImportedProjectData(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('工程文件内容无效');
  }
  const source = payload.config && typeof payload.config === 'object'
    ? payload.config
    : payload;
  return {
    devices: Array.isArray(source.devices) ? source.devices : [],
    lights: Array.isArray(source.lights) ? source.lights : [],
    scenes: Array.isArray(source.scenes) ? source.scenes : [],
    layout: source.layout && typeof source.layout === 'object' ? source.layout : {}
  };
}

function openProjectImportDialog() {
  const input = document.getElementById('project-import-input');
  if (!input) return;
  input.value = '';
  input.click();
}

async function handleProjectFileSelection(event) {
  const input = event && event.target ? event.target : document.getElementById('project-import-input');
  const file = input && input.files ? input.files[0] : null;
  if (!file) return;

  const shouldImport = window.confirm('导入工程文件会覆盖当前设备、灯具、场景和厂房布局，是否继续？');
  if (!shouldImport) {
    input.value = '';
    return;
  }

  beginRuntimeOperation();
  try {
    const text = await file.text();
    const imported = unwrapImportedProjectData(JSON.parse(text));
    const result = await api('/api/config', 'POST', imported);
    if (!result.ok) {
      throw new Error(result.error || '保存导入工程时失败');
    }
    const loaded = await loadConfig();
    if (!loaded) {
      throw new Error('导入成功，但重新加载当前工程失败');
    }
    showToast('success', '工程已导入', '已从 ' + file.name + ' 恢复当前厂房方案');
  } catch (error) {
    showToast('error', '导入失败', getFriendlyMessage(getErrorMessage(error, '无法读取工程文件')));
  } finally {
    if (input) input.value = '';
    endRuntimeOperation();
  }
}

function buildSceneStateSummary(scene) {
  const states = (scene && scene.states) || {};
  const keys = Object.keys(states);
  if (keys.length === 0) return '暂未配置分组目标';
  return keys.map(function(key) {
    return getGroupLabel(key) + ' ' + (states[key] === 'on' ? '开启' : '关闭');
  }).join(' · ');
}

function getGroupStats() {
  const buckets = {};
  const order = [];

  (config.lights || []).forEach(function(light, index) {
    const key = getLightGroupKey(light);
    if (!buckets[key]) {
      buckets[key] = {
        key: key,
        label: getGroupLabel(key),
        count: 0,
        on: 0,
        connected: 0,
        indices: []
      };
      order.push(key);
    }
    const bucket = buckets[key];
    const status = deviceStatus[light.device_ip];
    bucket.count += 1;
    bucket.indices.push(index);
    if (status && status.connected) {
      bucket.connected += 1;
      if (status.relay_states && status.relay_states[light.channel]) {
        bucket.on += 1;
      }
    }
  });

  return order.map(function(key) { return buckets[key]; });
}

function renderRuntimeSummary() {
  const el = document.getElementById('runtime-summary');
  if (!el) return;

  const offlineErrors = config.devices.filter(function(device) {
    return !!(deviceStatus[device.ip] && deviceStatus[device.ip].error);
  });
  if (offlineErrors.length > 0) {
    const names = offlineErrors.slice(0, 2).map(function(device) {
      return getDeviceDisplayName(device);
    }).join(', ');
    el.innerHTML =
      '<div class="inline-summary">' +
        '<div class="summary-title">需要处理</div>' +
        '<div>' + escapeHtml(names + (offlineErrors.length > 2 ? ' +' + (offlineErrors.length - 2) + ' 台' : '')) + ' 需要检查连接。</div>' +
      '</div>';
    return;
  }

  const groupCount = getGroupStats().length;
  const sceneCount = (config.scenes || []).length;
  el.innerHTML =
    '<div class="inline-summary">' +
      '<div class="summary-title">客户可直接使用</div>' +
      '<div>' + escapeHtml(groupCount + ' 个分组 · ' + sceneCount + ' 个预设 · ' + getConnectedDeviceCount() + ' 台设备在线') + '</div>' +
    '</div>';
}

function renderSetupCard() {
  const card = document.getElementById('setup-card');
  const list = document.getElementById('setup-checklist');
  if (!card || !list) return;

  const steps = [
    {
      done: (config.devices || []).length > 0,
      title: '设备已保存',
      meta: (config.devices || []).length > 0
        ? getConnectedDeviceCount() + ' / ' + config.devices.length + ' 已连接'
        : '请至少添加一台控制设备'
    },
    {
      done: (config.lights || []).length > 0,
      title: '电器已绑定',
      meta: (config.lights || []).length > 0
        ? config.lights.length + ' 个电器已映射到通道'
        : '请先创建电器绑定供客户使用'
    },
    {
      done: (config.scenes || []).length > 0,
      title: '场景预设已就绪',
      meta: (config.scenes || []).length > 0
        ? config.scenes.length + ' 个快捷预设可用'
        : '请至少创建一个可复用场景'
    }
  ];

  card.hidden = steps.every(function(step) { return step.done; });
  list.innerHTML = '';
  steps.forEach(function(step) {
    const item = document.createElement('div');
    item.className = 'setup-check-item' + (step.done ? ' done' : '');
    item.innerHTML =
      '<div class="setup-check-dot"></div>' +
      '<div class="setup-check-copy">' +
        '<div class="setup-check-title">' + escapeHtml(step.title) + '</div>' +
        '<div class="setup-check-meta">' + escapeHtml(step.meta) + '</div>' +
      '</div>';
    list.appendChild(item);
  });
}

function renderStatusStrip() {
  const el = document.getElementById('status-strip');
  if (!el) return;
  el.innerHTML = '';

  const disconnected = config.devices.filter(function(device) {
    return deviceStatus[device.ip] && deviceStatus[device.ip].error;
  });
  if (disconnected.length > 0) {
    const item = document.createElement('div');
    item.className = 'status-callout warn';
    item.innerHTML =
      '<div class="callout-title">检测到连接异常</div>' +
      '<div>' + escapeHtml(disconnected.map(function(device) {
        return getDeviceDisplayName(device);
      }).join(', ')) + '</div>';
    el.appendChild(item);
  }

  if ((config.scenes || []).length === 0 && (config.lights || []).length > 0) {
    const item = document.createElement('div');
    item.className = 'status-callout';
    item.innerHTML =
      '<div class="callout-title">场景建议</div>' +
      '<div>建议创建 1 到 2 个场景预设，避免客户反复手动切换。</div>';
    el.appendChild(item);
  }
}

function renderGroupSummary() {
  const el = document.getElementById('group-list');
  if (!el) return;
  el.innerHTML = '';

  const groups = getGroupStats();
  if (groups.length === 0) {
    el.innerHTML = '<div class="empty-tip">请先创建电器绑定，再使用分组控制。</div>';
    return;
  }

  groups.forEach(function(group) {
    const card = document.createElement('div');
    card.className = 'group-card';
    card.innerHTML =
      '<div class="group-card-head">' +
        '<div class="group-card-title">' + escapeHtml(group.label) + '</div>' +
        '<div class="group-card-title">' + group.on + '/' + group.count + '</div>' +
      '</div>' +
      '<div class="group-card-meta">' + escapeHtml(group.connected + ' 台已连接 · ' + group.count + ' 个已绑定') + '</div>';

    const actions = document.createElement('div');
    actions.className = 'group-card-actions';
    const onBtn = document.createElement('button');
    onBtn.className = 'mini-btn primary';
    onBtn.textContent = '开启';
    onBtn.addEventListener('click', function() {
      applyGroupState(group.key, true);
    });
    const offBtn = document.createElement('button');
    offBtn.className = 'mini-btn danger';
    offBtn.textContent = '关闭';
    offBtn.addEventListener('click', function() {
      applyGroupState(group.key, false);
    });
    actions.appendChild(onBtn);
    actions.appendChild(offBtn);
    card.appendChild(actions);
    el.appendChild(card);
  });
}

function renderSceneSummary() {
  const el = document.getElementById('scene-list');
  if (!el) return;
  el.innerHTML = '';

  if (!config.scenes || config.scenes.length === 0) {
    el.innerHTML = '<div class="empty-tip">还没有场景预设，可通过接入向导或场景编辑器创建。</div>';
    return;
  }

  config.scenes.forEach(function(scene, index) {
    const card = document.createElement('div');
    card.className = 'scene-card';
    card.innerHTML =
      '<div class="scene-card-head">' +
        '<div class="scene-card-title">' + escapeHtml(scene.name) + '</div>' +
      '</div>' +
      '<div class="scene-card-meta">' + escapeHtml(scene.description || buildSceneStateSummary(scene)) + '</div>';

    const actions = document.createElement('div');
    actions.className = 'scene-card-actions';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'mini-btn primary';
    applyBtn.textContent = '应用';
    applyBtn.addEventListener('click', function() {
      applyScene(index);
    });
    const editBtn = document.createElement('button');
    editBtn.className = 'mini-btn';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', function() {
      showScenesModal();
    });
    actions.appendChild(applyBtn);
    actions.appendChild(editBtn);
    card.appendChild(actions);
    el.appendChild(card);
  });
}

function refreshExperiencePanels() {
  renderRuntimeSummary();
  renderSetupCard();
  renderStatusStrip();
  renderGroupSummary();
  renderSceneSummary();
}

function renderDeviceList() {
  const el = document.getElementById('dev-list');
  el.innerHTML = '';
  if (config.devices.length === 0) {
    el.innerHTML = '<div class="empty-tip">还没有设备</div>';
    refreshPanelSections();
    return;
  }

  config.devices.forEach(function(device) {
    const status = deviceStatus[device.ip];
    const connected = !!(status && status.connected);
    const errorText = status && status.error ? getFriendlyMessage(status.error, 'connect') : '';
    const row = document.createElement('div');
    row.className = 'dev-item';
    row.innerHTML =
      '<div class="dev-dot ' + (connected ? 'on' : '') + '"></div>' +
      '<div class="dev-info">' +
        '<div class="dev-name">' + escapeHtml(device.name || '未命名设备') + '</div>' +
        '<div class="dev-ip">' + escapeHtml(getDeviceSummary(device)) + '</div>' +
        (errorText ? '<div class="dev-hint error">' + escapeHtml(errorText) + '</div>' : '') +
      '</div>' +
      '<div class="dev-actions">' +
        '<button class="dev-btn e" data-act="edit">编辑</button>' +
        (connected
          ? '<button class="dev-btn d" data-act="disc">断开</button>'
          : '<button class="dev-btn c" data-act="conn">连接</button>') +
        '<button class="dev-btn x" data-act="del" title="删除">x</button>' +
      '</div>';
    row.querySelector('[data-act="edit"]').addEventListener('click', function() { showDeviceModal(device.ip); });
    row.querySelector('[data-act="conn"]')?.addEventListener('click', function() { connectDevice(device); });
    row.querySelector('[data-act="disc"]')?.addEventListener('click', function() { disconnectDevice(device.ip); });
    row.querySelector('[data-act="del"]').addEventListener('click', function() { delDevice(device.ip); });
    el.appendChild(row);
  });

  refreshPanelSections();
}

async function connectDevice(device, options) {
  const normalized = normalizeDevice(device);
  const actionKey = 'connect:' + normalized.ip;
  if (!normalized.ip || deviceActionLocks.has(actionKey)) return { ok: false };

  deviceActionLocks.add(actionKey);
  beginRuntimeOperation();
  try {
    const result = await api('/api/connect', 'POST', normalized);
    if (result.ok) {
      deviceStatus[normalized.ip] = {
        connected: true,
        name: normalized.name,
        protocol: normalized.protocol,
        relay_states: Array.isArray(result.relay_states) ? result.relay_states.slice() : []
      };
      applyStatus();
      return result;
    }
    if (!options || !options.silent) {
      showToast('error', '连接失败', getDeviceDisplayName(normalized) + '：' + getFriendlyMessage(result.error || '未知错误', 'connect'));
    }
    return result;
  } catch (error) {
    const message = getErrorMessage(error, '未知错误');
    if (!options || !options.silent) {
      showToast('error', '连接失败', getDeviceDisplayName(normalized) + '：' + getFriendlyMessage(message, 'connect'));
    }
    return { ok: false, error: message };
  } finally {
    deviceActionLocks.delete(actionKey);
    endRuntimeOperation();
  }
}

async function disconnectDevice(ip, options) {
  const actionKey = 'disconnect:' + ip;
  if (!ip || deviceActionLocks.has(actionKey)) return { ok: false };

  deviceActionLocks.add(actionKey);
  beginRuntimeOperation();
  try {
    const result = await api('/api/disconnect', 'POST', { ip: ip });
    if (deviceStatus[ip]) {
      deviceStatus[ip].connected = false;
      delete deviceStatus[ip].error;
    }
    applyStatus();
    return result;
  } catch (error) {
    const message = getErrorMessage(error, '未知错误');
    if (!options || !options.silent) {
      showToast('error', '断开失败', getDeviceDisplayName(ip) + '：' + getFriendlyMessage(message, 'connect'));
    }
    return { ok: false, error: message };
  } finally {
    deviceActionLocks.delete(actionKey);
    endRuntimeOperation();
  }
}

async function connectAll() {
  const failures = [];
  for (const device of config.devices) {
    if (deviceStatus[device.ip] && deviceStatus[device.ip].connected) continue;
    const result = await connectDevice(device, { silent: true });
    if (!result || !result.ok) {
      failures.push(getDeviceDisplayName(device));
    }
  }
  if (failures.length > 0) {
    showToast('warn', '仍有设备离线', failures.join('，'));
  } else if (config.devices.length > 0) {
    showToast('success', '设备已全部连接', '所有已保存设备均已在线。');
  }
}

async function disconnectAll() {
  beginRuntimeOperation();
  try {
    const result = await api('/api/disconnect', 'POST', {});
    Object.keys(deviceStatus).forEach(function(ip) {
      if (deviceStatus[ip]) {
        deviceStatus[ip].connected = false;
        delete deviceStatus[ip].error;
      }
    });
    applyStatus();
    return result;
  } catch (error) {
    showToast('error', '全部断开失败', getFriendlyMessage(getErrorMessage(error, '未知错误'), 'connect'));
    return { ok: false, error: getErrorMessage(error, '未知错误') };
  } finally {
    endRuntimeOperation();
  }
}

function showDeviceModal() {
  const modal = document.getElementById('dev-modal');
  const device = arguments.length > 0 ? getDeviceByIp(arguments[0]) : null;
  const title = modal ? modal.querySelector('h3') : null;
  const sub = modal ? modal.querySelector('.sub') : null;
  const submit = modal ? modal.querySelector('.btn.btn-primary') : null;

  editingDeviceIp = device ? device.ip : null;
  clearNotice('dev-modal-notice');
  fillDeviceForm('in', device || null);
  if (title) title.textContent = device ? '编辑设备' : '添加新设备';
  if (sub) {
    sub.textContent = device
      ? '修改设备参数后，客户后续会沿用这里的连接配置。'
      : '填写设备信息后，就可以继续做电器绑定和场景预设。';
  }
  if (submit) submit.textContent = device ? '保存修改' : '确认添加';
  if (modal) modal.classList.add('show');
}

function hideDeviceModal() {
  const modal = document.getElementById('dev-modal');
  clearNotice('dev-modal-notice');
  if (modal) modal.classList.remove('show');
}

function validateDeviceInput(device, existingIp) {
  if (!device.ip) return '请输入设备 IP。';
  if (config.devices.some(function(item) { return item.ip === device.ip && item.ip !== existingIp; })) {
    return '当前项目中已存在这个 IP。';
  }
  return '';
}

async function testDeviceModal() {
  const device = buildDeviceFromForm('in');
  const validation = validateDeviceInput(device, editingDeviceIp);
  if (validation) {
    setNotice('dev-modal-notice', 'warn', '请检查设备参数', validation);
    return { ok: false, error: validation };
  }

  const result = await connectDevice(device, { silent: true });
  if (result && result.ok) {
    setNotice('dev-modal-notice', 'success', '连接成功', '控制设备可达，现在可以保存。');
    showToast('success', '设备可达', getDeviceDisplayName(device) + ' 连接成功。');
  } else {
    const message = getFriendlyMessage((result && result.error) || '未知错误', 'connect');
    setNotice('dev-modal-notice', 'error', '连接失败', message);
    showToast('error', '连接失败', message);
  }
  return result;
}

async function upsertDeviceConfig(device, options) {
  const opts = Object.assign({ existingIp: null }, options || {});
  const existingIp = opts.existingIp;
  const validation = validateDeviceInput(device, existingIp);
  if (validation) {
    return { ok: false, error: validation };
  }

  if (existingIp && existingIp !== device.ip && deviceStatus[existingIp] && deviceStatus[existingIp].connected) {
    await disconnectDevice(existingIp, { silent: true });
  }

  config.devices = config.devices.filter(function(item) {
    return item.ip !== existingIp;
  });
  config.devices.push(device);

  if (existingIp && existingIp !== device.ip) {
    config.lights = config.lights.map(function(light) {
      if (light.device_ip !== existingIp) return light;
      return Object.assign({}, light, { device_ip: device.ip });
    });
    if (deviceStatus[existingIp]) {
      deviceStatus[device.ip] = Object.assign({}, deviceStatus[existingIp], {
        name: device.name,
        protocol: device.protocol
      });
      delete deviceStatus[existingIp];
    }
  } else if (deviceStatus[device.ip]) {
    deviceStatus[device.ip].name = device.name;
    deviceStatus[device.ip].protocol = device.protocol;
  }

  const result = await saveConfigData();
  if (!result.ok) return result;

  renderDeviceList();
  renderLightRows();
  rebuildLamps();
  applyStatus();
  return { ok: true };
}

async function saveDevice() {
  const device = buildDeviceFromForm('in');
  clearNotice('dev-modal-notice');
  try {
    const result = await upsertDeviceConfig(device, { existingIp: editingDeviceIp });
    if (result.ok) {
      showToast('success', editingDeviceIp ? '设备已更新' : '设备已保存', getDeviceDisplayName(device) + ' 已可使用。');
      renderDeviceList();
      hideDeviceModal();
    } else {
      const message = getFriendlyMessage(result.error || '未知错误', 'save');
      setNotice('dev-modal-notice', 'error', '保存失败', message);
    }
  } catch (error) {
    const message = getFriendlyMessage(getErrorMessage(error, '未知错误'), 'save');
    setNotice('dev-modal-notice', 'error', '保存失败', message);
  }
}

async function delDevice(ip) {
  const device = config.devices.find(function(item) { return item.ip === ip; });
  if (!device) return;

  const relatedLights = config.lights.filter(function(light) {
    return light.device_ip === ip;
  });
  let message = '确认删除设备“' + getDeviceDisplayName(device) + '”(' + ip + ') 吗？';
  if (relatedLights.length > 0) {
    message += '\n\n同时会删除 ' + relatedLights.length + ' 个关联电器。';
  }
  if (!confirm(message)) return;

  if (deviceStatus[ip] && deviceStatus[ip].connected) {
    await disconnectDevice(ip, { silent: true });
  }
  config.devices = config.devices.filter(function(item) { return item.ip !== ip; });
  config.lights = config.lights.filter(function(light) { return light.device_ip !== ip; });
  delete deviceStatus[ip];

  try {
    const result = await saveConfigData();
    if (result.ok) {
      renderDeviceList();
      renderLightRows();
      rebuildLamps();
      updateCounts();
      showToast('success', '设备已删除', getDeviceDisplayName(device) + ' 及其关联电器已删除。');
    } else {
      showToast('error', '删除失败', getFriendlyMessage(result.error || '未知错误', 'save'));
    }
  } catch (error) {
    showToast('error', '删除失败', getFriendlyMessage(getErrorMessage(error, '未知错误'), 'save'));
  }
}

function renderLightRows() {
  const el = document.getElementById('light-rows');
  el.innerHTML = '';
  if (config.lights.length === 0) {
    el.innerHTML = '<div class="empty-tip">还没有电器</div>';
    refreshPanelSections();
    return;
  }

  config.lights.forEach(function(light, index) {
    const meta = getItemMeta(light.type);
    const status = deviceStatus[light.device_ip];
    const connected = !!(status && status.connected);
    const on = connected && status.relay_states && status.relay_states[light.channel];
    const row = document.createElement('div');
    row.className = 'light-row' + (connected ? '' : ' disabled');
    row.id = 'lrow-' + index;
    const deviceName = getDeviceDisplayName(light.device_ip);
    const groupLabel = getGroupLabel(getLightGroupKey(light));
    row.innerHTML =
      '<div class="l-dot' + (on ? ' on' : '') + '"></div>' +
      '<div class="l-icon' + (on ? ' on' : '') + '" style="--icon-accent:' + meta.accent + ';">' + escapeHtml(meta.icon) + '</div>' +
      '<div class="l-info">' +
        '<div class="l-name' + (on ? ' on' : '') + '">' + escapeHtml(light.name || '未命名电器') + '</div>' +
        '<div class="l-sub">' + escapeHtml(meta.label) + ' / ' + escapeHtml(deviceName) + ' / 通道' + String(light.channel + 1).padStart(2, '0') + '</div>' +
        '<div class="l-meta-row"><span class="l-group">' + escapeHtml(groupLabel) + '</span></div>' +
      '</div>' +
      '<div class="l-state' + (on ? ' on' : '') + '">' + (connected ? (on ? '开' : '关') : '--') + '</div>' +
      '<div class="toggle' + (on ? ' on' : '') + '"><div class="toggle-knob"></div></div>';
    row.onclick = function() { toggleLight(index); };
    el.appendChild(row);
  });

  refreshPanelSections();
}

function setLightRowUI(index, on, connected) {
  const row = document.getElementById('lrow-' + index);
  if (!row) return;
  const dot = row.querySelector('.l-dot');
  const icon = row.querySelector('.l-icon');
  const name = row.querySelector('.l-name');
  const state = row.querySelector('.l-state');
  const toggle = row.querySelector('.toggle');

  if (on) {
    dot.classList.add('on');
    icon.classList.add('on');
    name.classList.add('on');
    state.classList.add('on');
    state.textContent = '开';
    toggle.classList.add('on');
  } else {
    dot.classList.remove('on');
    icon.classList.remove('on');
    name.classList.remove('on');
    state.classList.remove('on');
    state.textContent = connected ? '关' : '--';
    toggle.classList.remove('on');
  }

  row.classList.toggle('disabled', !connected);
}

async function toggleLight(lightIdx) {
  if (lightToggleLocks.has(lightIdx)) return;
  const light = config.lights[lightIdx];
  if (!light) return;

  const status = deviceStatus[light.device_ip];
  if (!status || !status.connected) {
    showToast('warn', '设备离线', '请先连接目标控制设备，再切换该电器。');
    return;
  }

  lightToggleLocks.add(lightIdx);
  beginRuntimeOperation();
  try {
    const current = !!(lamps[lightIdx] && lamps[lightIdx].state);
    const result = await api('/api/toggle', 'POST', {
      ip: light.device_ip,
      channel: light.channel,
      value: !current
    });

    if (result.ok) {
      status.relay_states[light.channel] = !current;
      setLampState(lightIdx, !current);
      setLightRowUI(lightIdx, !current, true);
      updateCounts();
      scheduleStatusPoll(200);
    } else {
      showToast('error', '控制失败', getFriendlyMessage(result.error || '未知错误', 'control'));
    }
  } catch (error) {
    showToast('error', '控制失败', getFriendlyMessage(getErrorMessage(error, '未知错误'), 'control'));
  } finally {
    lightToggleLocks.delete(lightIdx);
    endRuntimeOperation();
  }
}

async function batchAll(value) {
  if (batchAllInFlight) return;
  const connectedDevices = config.devices.filter(function(device) {
    return !!(deviceStatus[device.ip] && deviceStatus[device.ip].connected);
  });

  if (connectedDevices.length === 0) {
    showToast('warn', '没有已连接设备', '执行批量操作前，请先连接至少一台控制设备。');
    return;
  }

  batchAllInFlight = true;
  beginRuntimeOperation();
  try {
    const results = await Promise.all(connectedDevices.map(async function(device) {
      try {
        const response = await api('/api/batch', 'POST', {
          ip: device.ip,
          start: 0,
          end: getDeviceChannelCount(device),
          value: value
        });
        return {
          device: device,
          ok: !!response.ok,
          error: response.error || ''
        };
      } catch (error) {
        return {
          device: device,
          ok: false,
          error: getErrorMessage(error, '未知错误')
        };
      }
    }));

    await refreshStatus({ force: true, silent: true });

    const failures = results.filter(function(item) { return !item.ok; });
    if (failures.length > 0) {
      const failedNames = failures.map(function(item) {
        return getDeviceDisplayName(item.device);
      }).join(', ');
      showToast('warn', '批量操作部分成功', failedNames);
    } else {
      showToast('success', value ? '全部开启' : '全部关闭', '已连接设备已完成批量操作。');
    }
  } finally {
    batchAllInFlight = false;
    endRuntimeOperation();
  }
}

async function refreshStatus(options) {
  const opts = Object.assign(
    {
      force: arguments.length === 0,
      silent: false
    },
    options || {}
  );

  if (statusRefreshInFlight) {
    statusRefreshQueued = true;
    return { ok: false, skipped: true };
  }

  if (!opts.force) {
    if (runtimeOpsInFlight > 0 || batchAllInFlight) {
      scheduleStatusPoll();
      return { ok: false, skipped: true };
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      clearStatusPoll();
      return { ok: false, skipped: true };
    }
    if (!hasConnectedDevices()) {
      clearStatusPoll();
      return { ok: true, skipped: true };
    }
  }

  clearStatusPoll();
  statusRefreshInFlight = true;
  try {
    const result = await api('/api/status');
    deviceStatus = result.devices || {};
    applyStatus();
    return result;
  } catch (error) {
    const message = getErrorMessage(error, '未知错误');
    if (!opts.silent) {
      showToast('error', '刷新失败', getFriendlyMessage(message, 'refresh'));
    }
    return { ok: false, error: message };
  } finally {
    statusRefreshInFlight = false;
    if (statusRefreshQueued) {
      statusRefreshQueued = false;
      refreshStatus({ force: true, silent: true });
      return;
    }
    scheduleStatusPoll();
  }
}

function applyStatus() {
  renderDeviceList();
  config.lights.forEach(function(light, index) {
    const status = deviceStatus[light.device_ip];
    const connected = !!(status && status.connected);
    const on = connected && status.relay_states && status.relay_states[light.channel];
    setLampState(index, !!on);
    setLightRowUI(index, !!on, connected);
  });
  updateCounts();
  refreshExperiencePanels();
}

function updateCounts() {
  let on = 0;
  const total = config.lights.length;
  config.lights.forEach(function(light) {
    const status = deviceStatus[light.device_ip];
    if (status && status.connected && status.relay_states && status.relay_states[light.channel]) {
      on += 1;
    }
  });
  document.getElementById('stat-on').textContent = on;
  document.getElementById('stat-off').textContent = total - on;
  refreshPanelSections();
}

function getTypeOptionsHtml(selectedType) {
  return ITEM_TYPE_KEYS.map(function(type) {
    const meta = getItemMeta(type);
    return '<option value="' + type + '"' +
      (selectedType === type ? ' selected' : '') + '>' +
      escapeHtml(meta.icon + ' ' + meta.label) + '</option>';
  }).join('');
}

function showLightsModal() {
  if (config.devices.length === 0) {
    showToast('warn', '请先添加设备', '绑定电器前，请先创建或保存至少一台控制设备。');
    return;
  }
  clearNotice('lights-modal-notice');
  editingLights = config.lights.map(normalizeLight);
  renderLightsConfig();
  document.getElementById('lights-modal').classList.add('show');
}

function hideLightsModal() {
  clearNotice('lights-modal-notice');
  document.getElementById('lights-modal').classList.remove('show');
}

function renderLightGroupSuggestions() {
  const datalist = document.getElementById('light-group-options');
  if (!datalist) return;
  datalist.innerHTML = '';

  const keys = [];
  const used = new Set();
  editingLights.forEach(function(light) {
    const key = normalizeGroupName(light.group);
    if (key && !used.has(key)) {
      used.add(key);
      keys.push(key);
    }
  });
  getKnownGroupKeys(true).forEach(function(key) {
    if (key === UNGROUPED_GROUP_KEY || used.has(key)) return;
    used.add(key);
    keys.push(key);
  });

  keys.forEach(function(groupName) {
    const option = document.createElement('option');
    option.value = groupName;
    datalist.appendChild(option);
  });
}

function renderLightsConfig() {
  const el = document.getElementById('lc-list');
  el.innerHTML = '';
  renderLightGroupSuggestions();
  if (editingLights.length === 0) {
    el.innerHTML = '<div class="empty-tip">点击下方按钮，开始配置电器。</div>';
    return;
  }

  editingLights.forEach(function(light, index) {
    const row = document.createElement('div');
    row.className = 'lc-row';
    row.id = 'light-config-row-' + index;
    let deviceOptions = '';
    config.devices.forEach(function(device) {
      deviceOptions += '<option value="' + escapeHtml(device.ip) + '"' +
        (light.device_ip === device.ip ? ' selected' : '') + '>' +
        escapeHtml(device.name) + '</option>';
    });

    const selectedDevice = getDeviceByIp(light.device_ip) || config.devices[0] || null;
    const channelCount = Math.max(getDeviceChannelCount(selectedDevice), parseIntOr(light.channel, 0) + 1);
    let channelOptions = '';
    for (let channel = 0; channel < channelCount; channel++) {
      channelOptions += '<option value="' + channel + '"' +
        (light.channel === channel ? ' selected' : '') +
        '>通道' + String(channel + 1).padStart(2, '0') + '</option>';
    }

    const hasScenePos = Number.isFinite(light.x) && Number.isFinite(light.z);
    const posText = hasScenePos
      ? '场景位置：X ' + formatNum(light.x) + ' / Z ' + formatNum(light.z)
      : '场景位置：按设备分组自动排布';
    row.innerHTML =
      '<input class="lc-name" type="text" placeholder="电器名称" value="' + escapeHtml(light.name || '') + '">' +
      '<select class="lc-type">' + getTypeOptionsHtml(light.type) + '</select>' +
      '<input class="lc-size" type="number" min="0.4" max="3" step="0.1" value="' + light.scale + '" title="模型缩放">' +
      '<input class="lc-group" type="text" list="light-group-options" placeholder="分组名称" value="' + escapeHtml(normalizeGroupName(light.group)) + '">' +
      '<select class="lc-dev">' + deviceOptions + '</select>' +
      '<select class="lc-ch">' + channelOptions + '</select>' +
      '<button class="lc-del" title="删除">x</button>';

    const nameInput = row.querySelector('.lc-name');
    const typeInput = row.querySelector('.lc-type');
    const sizeInput = row.querySelector('.lc-size');
    const groupInput = row.querySelector('.lc-group');
    const deviceInput = row.querySelector('.lc-dev');
    const channelInput = row.querySelector('.lc-ch');
    const extra = document.createElement('div');
    extra.className = 'lc-row-extra';
    extra.innerHTML =
      '<div class="lc-pos">' + escapeHtml(posText) + '</div>' +
      '<button type="button" class="lc-place pick">场景取点</button>' +
      (hasScenePos ? '<button type="button" class="lc-place reset">恢复自动排布</button>' : '');
    row.appendChild(extra);

    nameInput.oninput = function() { editingLights[index].name = nameInput.value; };
    typeInput.onchange = function() {
      const hadAutoName = isAutoName(editingLights[index].name);
      editingLights[index].type = typeInput.value;
      if (hadAutoName) {
        editingLights[index].name = getSuggestedLightName(typeInput.value);
        nameInput.value = editingLights[index].name;
      }
    };
    sizeInput.oninput = function() {
      editingLights[index].scale = clamp(Number(sizeInput.value) || editingLights[index].scale || 1, 0.4, 3);
    };
    groupInput.oninput = function() {
      editingLights[index].group = normalizeGroupName(groupInput.value);
      renderLightGroupSuggestions();
    };
    deviceInput.onchange = function() {
      editingLights[index].device_ip = deviceInput.value;
      const nextDevice = getDeviceByIp(deviceInput.value);
      const nextChannelCount = getDeviceChannelCount(nextDevice);
      if (editingLights[index].channel >= nextChannelCount) {
        editingLights[index].channel = Math.max(0, nextChannelCount - 1);
      }
      renderLightsConfig();
    };
    channelInput.onchange = function() {
      editingLights[index].channel = parseInt(channelInput.value, 10);
    };
    extra.querySelector('.lc-place.pick').onclick = function() {
      startLightPlacement(index);
    };
    const resetBtn = extra.querySelector('.lc-place.reset');
    if (resetBtn) {
      resetBtn.onclick = function() {
        delete editingLights[index].x;
        delete editingLights[index].z;
        renderLightsConfig();
      };
    }
    row.querySelector('.lc-del').onclick = function() {
      editingLights.splice(index, 1);
      renderLightsConfig();
    };
    el.appendChild(row);
  });
}

function addLight() {
  if (config.devices.length === 0) {
    showToast('warn', '还没有设备', '创建电器前，请先添加一台控制设备。');
    return;
  }

  const defaultDevice = config.devices[0];
  const usedChannels = new Set(editingLights
    .filter(function(light) { return light.device_ip === defaultDevice.ip; })
    .map(function(light) { return light.channel; }));
  let channel = 0;
  const channelCount = getDeviceChannelCount(defaultDevice);
  for (let index = 0; index < channelCount; index++) {
    if (!usedChannels.has(index)) {
      channel = index;
      break;
    }
  }

  editingLights.push({
    name: getSuggestedLightName(DEFAULT_ITEM_TYPE),
    type: DEFAULT_ITEM_TYPE,
    scale: 1,
    group: normalizeGroupName(editingLights[editingLights.length - 1] && editingLights[editingLights.length - 1].group),
    device_ip: defaultDevice.ip,
    channel: channel
  });
  renderLightsConfig();
}

async function saveLights() {
  clearNotice('lights-modal-notice');
  const seen = {};
  for (const light of editingLights) {
    const key = light.device_ip + '#' + light.channel;
    if (seen[key]) {
      setNotice('lights-modal-notice', 'warn', '通道冲突', '同一台设备的同一个通道不能同时绑定多个电器。');
      return;
    }
    seen[key] = true;
  }

  config.lights = editingLights.map(function(light) {
    const next = {
      name: light.name || getSuggestedLightName(light.type),
      type: ITEM_TYPES[light.type] ? light.type : DEFAULT_ITEM_TYPE,
      scale: clamp(Number(light.scale) || 1, 0.4, 3),
      device_ip: light.device_ip,
      channel: parseInt(light.channel, 10)
    };
    if (normalizeGroupName(light.group)) next.group = normalizeGroupName(light.group);
    if (typeof light.x === 'number') next.x = light.x;
    if (typeof light.z === 'number') next.z = light.z;
    return next;
  });

  clampLightPositionsToBuilding();
  try {
    const result = await saveConfigData();
    if (result.ok) {
      hideLightsModal();
      renderLightRows();
      rebuildLamps();
      applyStatus();
      showToast('success', '电器已保存', '绑定、分组和摆放更新已生效。');
    } else {
      setNotice('lights-modal-notice', 'error', '保存失败', getFriendlyMessage(result.error || '未知错误', 'save'));
    }
  } catch (error) {
    setNotice('lights-modal-notice', 'error', '保存失败', getFriendlyMessage(getErrorMessage(error, '未知错误'), 'save'));
  }
}

async function applyLightAssignments(assignments, options) {
  const opts = Object.assign({
    title: '操作已完成',
    successBody: '目标通道已更新。',
    emptyBody: '这次操作没有找到可执行的通道。'
  }, options || {});

  const deduped = new Map();
  (assignments || []).forEach(function(item) {
    if (!item || !item.device_ip || !Number.isFinite(item.channel)) return;
    deduped.set(item.device_ip + '#' + item.channel, item);
  });

  const targets = Array.from(deduped.values());
  if (targets.length === 0) {
    showToast('warn', opts.title, opts.emptyBody);
    return { ok: false, skipped: true };
  }

  const failures = [];
  let applied = 0;
  let skippedOffline = 0;

  beginRuntimeOperation();
  try {
    for (const target of targets) {
      const status = deviceStatus[target.device_ip];
      if (!status || !status.connected) {
        skippedOffline += 1;
        continue;
      }

      const current = !!(status.relay_states && status.relay_states[target.channel]);
      if (current === target.value) continue;

      try {
        const result = await api('/api/toggle', 'POST', {
          ip: target.device_ip,
          channel: target.channel,
          value: target.value
        });
        if (!result.ok) {
          throw new Error(result.error || '未知错误');
        }
        if (!Array.isArray(status.relay_states)) status.relay_states = [];
        status.relay_states[target.channel] = target.value;
        applied += 1;
      } catch (error) {
        failures.push({
          target: target,
          error: getFriendlyMessage(getErrorMessage(error, '未知错误'), 'control')
        });
      }
    }
  } finally {
    endRuntimeOperation();
  }

  applyStatus();
  scheduleStatusPoll(200);

  if (failures.length > 0) {
    showToast(
      'error',
      opts.title,
      '已更新 ' + applied + ' 个通道，但有 ' + failures.length + ' 个失败，另有 ' + skippedOffline + ' 个离线通道被跳过。'
    );
    return { ok: false, applied: applied, failures: failures, skippedOffline: skippedOffline };
  }

  showToast(
    skippedOffline > 0 ? 'warn' : 'success',
    opts.title,
    opts.successBody + (skippedOffline > 0 ? ' 已跳过 ' + skippedOffline + ' 个离线通道。' : '')
  );
  return { ok: true, applied: applied, skippedOffline: skippedOffline };
}

function applyGroupState(groupKey, value) {
  const assignments = (config.lights || [])
    .filter(function(light) {
      return getLightGroupKey(light) === groupKey;
    })
    .map(function(light) {
      return {
        device_ip: light.device_ip,
        channel: light.channel,
        value: value
      };
    });

  return applyLightAssignments(assignments, {
    title: getGroupLabel(groupKey),
    successBody: '分组操作已执行。'
  });
}

function applyScene(sceneIndex) {
  const scene = config.scenes && config.scenes[sceneIndex];
  if (!scene) return Promise.resolve({ ok: false });

  const states = scene.states || {};
  const assignments = [];
  (config.lights || []).forEach(function(light) {
    const groupKey = getLightGroupKey(light);
    const state = states[groupKey];
    if (state !== 'on' && state !== 'off') return;
    assignments.push({
      device_ip: light.device_ip,
      channel: light.channel,
      value: state === 'on'
    });
  });

  return applyLightAssignments(assignments, {
    title: scene.name,
    successBody: '场景预设已应用。',
    emptyBody: '当前场景没有命中任何现有电器分组。'
  });
}

function showScenesModal() {
  if ((config.lights || []).length === 0 && (!config.scenes || config.scenes.length === 0)) {
    showToast('warn', '还没有电器', '创建场景预设前，请先绑定电器。');
    return;
  }
  clearNotice('scenes-modal-notice');
  editingScenes = (config.scenes || []).map(normalizeScene);
  renderScenesConfig();
  document.getElementById('scenes-modal').classList.add('show');
}

function hideScenesModal() {
  clearNotice('scenes-modal-notice');
  document.getElementById('scenes-modal').classList.remove('show');
}

function renderScenesConfig() {
  const el = document.getElementById('scene-config-list');
  if (!el) return;
  el.innerHTML = '';

  const groupKeys = getKnownGroupKeys(true);
  if (editingScenes.length === 0) {
    el.innerHTML = '<div class="empty-tip">在下方添加预设，保存分组级控制组合。</div>';
    return;
  }

  editingScenes.forEach(function(scene, index) {
    const row = document.createElement('div');
    row.className = 'scene-row';

    const head = document.createElement('div');
    head.className = 'scene-row-head';
    head.innerHTML =
      '<div class="scene-name-wrap"><input type="text" class="scene-name-input" placeholder="场景名称" value="' + escapeHtml(scene.name || '') + '"></div>' +
      '<div class="scene-actions-inline">' +
        '<button type="button" class="mini-btn primary">应用</button>' +
        '<button type="button" class="mini-btn danger">删除</button>' +
      '</div>';
    row.appendChild(head);

    const meta = document.createElement('textarea');
    meta.placeholder = '给客户看的简短说明';
    meta.value = scene.description || '';
    row.appendChild(meta);

    const grid = document.createElement('div');
    grid.className = 'scene-grid';
    groupKeys.forEach(function(groupKey) {
      const item = document.createElement('div');
      item.className = 'scene-grid-item';
      item.innerHTML =
        '<label>' + escapeHtml(getGroupLabel(groupKey)) + '</label>' +
        '<select>' +
          '<option value="keep">保持不变</option>' +
          '<option value="on">开启</option>' +
          '<option value="off">关闭</option>' +
        '</select>';
      const select = item.querySelector('select');
      select.value = scene.states[groupKey] || 'keep';
      select.addEventListener('change', function() {
        if (select.value === 'keep') delete editingScenes[index].states[groupKey];
        else editingScenes[index].states[groupKey] = select.value;
      });
      grid.appendChild(item);
    });
    row.appendChild(grid);

    head.querySelector('.scene-name-input').addEventListener('input', function(event) {
      editingScenes[index].name = event.target.value;
    });
    meta.addEventListener('input', function() {
      editingScenes[index].description = meta.value;
    });
    head.querySelector('.mini-btn.primary').addEventListener('click', function() {
      config.scenes = editingScenes.map(normalizeScene);
      applyScene(index);
    });
    head.querySelector('.mini-btn.danger').addEventListener('click', function() {
      editingScenes.splice(index, 1);
      renderScenesConfig();
    });
    el.appendChild(row);
  });
}

function addScene() {
  const groupKeys = getKnownGroupKeys(true);
  const states = {};
  if (groupKeys.length > 0) {
    states[groupKeys[0]] = 'on';
  }
  editingScenes.push({
    name: '新场景',
    description: '',
    states: states
  });
  renderScenesConfig();
}

async function saveScenes() {
  clearNotice('scenes-modal-notice');
  const normalized = editingScenes.map(normalizeScene).filter(function(scene) {
    return !!scene.name;
  });
  const invalid = normalized.some(function(scene) {
    return Object.keys(scene.states || {}).length === 0;
  });
  if (invalid) {
    setNotice('scenes-modal-notice', 'warn', '场景缺少目标', '每个场景至少要让一个分组开启或关闭。');
    return;
  }

  config.scenes = normalized;
  try {
    const result = await saveConfigData();
    if (result.ok) {
      hideScenesModal();
      refreshExperiencePanels();
      showToast('success', '场景已保存', '当前共有 ' + config.scenes.length + ' 个预设可用。');
    } else {
      setNotice('scenes-modal-notice', 'error', '保存失败', getFriendlyMessage(result.error || '未知错误', 'save'));
    }
  } catch (error) {
    setNotice('scenes-modal-notice', 'error', '保存失败', getFriendlyMessage(getErrorMessage(error, '未知错误'), 'save'));
  }
}

function hideSetupWizard() {
  ['setup-device-notice', 'setup-appliance-notice', 'setup-scenes-notice'].forEach(clearNotice);
  const modal = document.getElementById('setup-modal');
  if (modal) modal.classList.remove('show');
}

function openSetupWizard() {
  const primaryDevice = (config.devices || [])[0] || null;
  setupWizardState = {
    step: 0,
    deviceTargetIp: primaryDevice ? primaryDevice.ip : null,
    deviceConnected: !!(primaryDevice && deviceStatus[primaryDevice.ip] && deviceStatus[primaryDevice.ip].connected),
    lastGroupName: normalizeGroupName((config.lights[config.lights.length - 1] || {}).group)
  };

  resetSetupWizardDeviceForm(primaryDevice || null);
  document.getElementById('setup-appliance-count').value = String(
    Math.min(4, getDeviceChannelCount(primaryDevice))
  );
  document.getElementById('setup-appliance-type').value = DEFAULT_ITEM_TYPE;
  document.getElementById('setup-appliance-prefix').value = '区域';
  document.getElementById('setup-appliance-group').value = setupWizardState.lastGroupName || '主区域';
  document.getElementById('setup-scenes-enabled').checked = true;
  document.getElementById('setup-scenes-focus-enabled').checked = true;
  renderSetupWizard();
  document.getElementById('setup-modal').classList.add('show');
}

function renderSetupWizard() {
  const stepper = document.getElementById('setup-stepper');
  if (stepper) {
    stepper.innerHTML = '';
    SETUP_WIZARD_STEPS.forEach(function(stepKey, index) {
      const node = document.createElement('div');
      node.className = 'setup-step' + (setupWizardState.step === index ? ' active' : '');
      node.innerHTML =
        '<div class="setup-step-kicker">步骤 ' + (index + 1) + '</div>' +
        '<div class="setup-step-title">' + escapeHtml(stepKey === 'device' ? '设备' : (stepKey === 'appliances' ? '电器' : '场景')) + '</div>' +
        '<div class="setup-step-meta">' + escapeHtml(stepKey === 'device' ? '连接参数' : (stepKey === 'appliances' ? '通道绑定和分组' : '一键预设')) + '</div>';
      stepper.appendChild(node);
    });
  }

  SETUP_WIZARD_STEPS.forEach(function(stepKey, index) {
    const pane = document.getElementById('setup-pane-' + stepKey);
    if (pane) pane.hidden = setupWizardState.step !== index;
  });

  const backBtn = document.getElementById('setup-back-btn');
  const testBtn = document.getElementById('setup-test-btn');
  const nextBtn = document.getElementById('setup-next-btn');
  if (backBtn) backBtn.textContent = setupWizardState.step === 0 ? '取消' : '上一步';
  if (testBtn) testBtn.style.display = setupWizardState.step === 0 ? '' : 'none';
  if (nextBtn) {
    nextBtn.textContent = setupWizardState.step === 0
      ? '保存并继续'
      : (setupWizardState.step === 1 ? '生成并继续' : '完成向导');
  }

  const targetDevice = getDeviceByIp(setupWizardState.deviceTargetIp) || (config.devices || [])[0] || null;
  const deviceSummary = document.getElementById('setup-device-summary');
  if (deviceSummary) {
    deviceSummary.textContent = targetDevice
      ? getDeviceDisplayName(targetDevice) + ' · ' + getDeviceSummary(targetDevice)
      : '还没有保存设备';
  }

  const preview = document.getElementById('setup-appliance-preview');
  if (preview) {
    const count = clampInteger(document.getElementById('setup-appliance-count').value, 4, 1, 128);
    const prefix = String(document.getElementById('setup-appliance-prefix').value || '区域').trim() || '区域';
    const groupName = normalizeGroupName(document.getElementById('setup-appliance-group').value) || '未分组';
    preview.textContent = '将创建 ' + count + ' 个电器，名称前缀为“' + prefix + '”，分组为“' + groupName + '”。';
  }

  const sceneSummary = document.getElementById('setup-scenes-summary');
  if (sceneSummary) {
    const nextGroupName = normalizeGroupName(document.getElementById('setup-appliance-group').value) || setupWizardState.lastGroupName || '当前分组';
    sceneSummary.textContent = '推荐生成“开工模式”“下班模式”，并为“' + nextGroupName + '”额外生成一个独立场景。';
  }
}

function setupWizardBack() {
  if (setupWizardState.step === 0) {
    hideSetupWizard();
    return;
  }
  setupWizardState.step = Math.max(0, setupWizardState.step - 1);
  renderSetupWizard();
}

async function setupWizardTestDevice() {
  const device = buildDeviceFromForm('setup-device');
  const validation = validateDeviceInput(device, setupWizardState.deviceTargetIp);
  if (validation) {
    setNotice('setup-device-notice', 'warn', '检查设备参数', validation);
    return { ok: false, error: validation };
  }
  const result = await connectDevice(device, { silent: true });
  if (result && result.ok) {
    setupWizardState.deviceConnected = true;
    setNotice('setup-device-notice', 'success', '连接成功', '设备可达，可以继续保存并进入下一步。');
  } else {
    setNotice('setup-device-notice', 'error', '连接失败', getFriendlyMessage((result && result.error) || '未知错误', 'connect'));
  }
  return result;
}

async function createWizardAppliances() {
  const device = getDeviceByIp(setupWizardState.deviceTargetIp) || (config.devices || [])[0];
  if (!device) {
    return { ok: false, error: '请先保存设备。' };
  }

  const count = clampInteger(document.getElementById('setup-appliance-count').value, 4, 1, getDeviceChannelCount(device));
  const type = document.getElementById('setup-appliance-type').value;
  const prefix = String(document.getElementById('setup-appliance-prefix').value || '区域').trim() || '区域';
  const groupName = normalizeGroupName(document.getElementById('setup-appliance-group').value);
  const usedChannels = new Set((config.lights || []).filter(function(light) {
    return light.device_ip === device.ip;
  }).map(function(light) {
    return light.channel;
  }));

  const availableChannels = [];
  for (let channel = 0; channel < getDeviceChannelCount(device); channel++) {
    if (!usedChannels.has(channel)) availableChannels.push(channel);
  }

  if (availableChannels.length === 0) {
    return { ok: false, error: '当前设备没有剩余可绑定的空闲通道。' };
  }

  const actualCount = Math.min(count, availableChannels.length);
  for (let index = 0; index < actualCount; index++) {
    const nextLight = {
      name: prefix + ' ' + String(index + 1).padStart(2, '0'),
      type: ITEM_TYPES[type] ? type : DEFAULT_ITEM_TYPE,
      scale: 1,
      device_ip: device.ip,
      channel: availableChannels[index]
    };
    if (groupName) nextLight.group = groupName;
    config.lights.push(nextLight);
  }

  const result = await saveConfigData();
  if (!result.ok) return result;
  setupWizardState.lastGroupName = groupName;
  renderLightRows();
  rebuildLamps();
  applyStatus();
  return { ok: true, count: actualCount };
}

function upsertSceneByName(scene) {
  const normalized = normalizeScene(scene);
  const existingIndex = (config.scenes || []).findIndex(function(item) {
    return item.name === normalized.name;
  });
  if (existingIndex >= 0) config.scenes[existingIndex] = normalized;
  else config.scenes.push(normalized);
}

async function createWizardScenes() {
  const enabled = !!document.getElementById('setup-scenes-enabled').checked;
  const focusEnabled = !!document.getElementById('setup-scenes-focus-enabled').checked;
  const groupKeys = getKnownGroupKeys(false);
  if (groupKeys.length === 0 || (!enabled && !focusEnabled)) {
    return { ok: true, count: 0 };
  }

  if (!Array.isArray(config.scenes)) config.scenes = [];
  if (enabled) {
    const allOnStates = {};
    const allOffStates = {};
    groupKeys.forEach(function(key) {
      allOnStates[key] = 'on';
      allOffStates[key] = 'off';
    });
    upsertSceneByName({
      name: '开工模式',
      description: '全部分组快速开启',
      states: allOnStates
    });
    upsertSceneByName({
      name: '下班模式',
      description: '全部分组快速关闭',
      states: allOffStates
    });
  }

  const lastGroupKey = normalizeGroupName(setupWizardState.lastGroupName) || groupKeys[groupKeys.length - 1];
  if (focusEnabled && lastGroupKey) {
    const focusStates = {};
    groupKeys.forEach(function(key) {
      focusStates[key] = key === lastGroupKey ? 'on' : 'off';
    });
    upsertSceneByName({
      name: getGroupLabel(lastGroupKey) + ' 模式',
      description: '仅保留当前分组开启',
      states: focusStates
    });
  }

  const result = await saveConfigData();
  if (!result.ok) return result;
  refreshExperiencePanels();
  return { ok: true, count: config.scenes.length };
}

async function setupWizardNext() {
  if (setupWizardState.step === 0) {
    clearNotice('setup-device-notice');
    try {
      const device = buildDeviceFromForm('setup-device');
      const result = await upsertDeviceConfig(device, { existingIp: setupWizardState.deviceTargetIp });
      if (!result.ok) {
        setNotice('setup-device-notice', 'error', '保存失败', getFriendlyMessage(result.error || '未知错误', 'save'));
        return;
      }
      setupWizardState.deviceTargetIp = device.ip;
      setupWizardState.step = 1;
      renderSetupWizard();
      showToast('success', '设备已保存', getDeviceDisplayName(device) + ' 已进入项目配置。');
      return;
    } catch (error) {
      setNotice('setup-device-notice', 'error', '保存失败', getFriendlyMessage(getErrorMessage(error, '未知错误'), 'save'));
      return;
    }
  }

  if (setupWizardState.step === 1) {
    clearNotice('setup-appliance-notice');
    try {
      const result = await createWizardAppliances();
      if (!result.ok) {
        setNotice('setup-appliance-notice', 'error', '生成失败', getFriendlyMessage(result.error || '未知错误', 'save'));
        return;
      }
      setupWizardState.step = 2;
      renderSetupWizard();
      showToast('success', '电器已生成', '已生成 ' + result.count + ' 个默认电器绑定。');
      return;
    } catch (error) {
      setNotice('setup-appliance-notice', 'error', '生成失败', getFriendlyMessage(getErrorMessage(error, '未知错误'), 'save'));
      return;
    }
  }

  clearNotice('setup-scenes-notice');
  try {
    const result = await createWizardScenes();
    if (!result.ok) {
      setNotice('setup-scenes-notice', 'error', '保存失败', getFriendlyMessage(result.error || '未知错误', 'save'));
      return;
    }
    hideSetupWizard();
    refreshExperiencePanels();
    showToast('success', '接入完成', '设备、分组和场景已经准备好交给客户使用。');
  } catch (error) {
    setNotice('setup-scenes-notice', 'error', '保存失败', getFriendlyMessage(getErrorMessage(error, '未知错误'), 'save'));
  }
}

function isLampLabelVisible(index) {
  return labelsPinned || focusedLampIdx === index;
}

function refreshLabelToggleUI() {
  const btn = document.getElementById('label-toggle-btn');
  if (!btn) return;
  btn.classList.toggle('on', !!labelsPinned);
  btn.setAttribute('aria-pressed', labelsPinned ? 'true' : 'false');
  btn.title = labelsPinned ? '标签已常显' : '点击后显示标签';
}

function drawLabel(lamp, on) {
  const ctx = lamp.labelCanvas.getContext('2d');
  const meta = lamp.meta;
  const width = lamp.labelCanvas.width;
  const height = lamp.labelCanvas.height;
  const deviceLine = (lamp.deviceName || lamp.deviceIp || meta.label || '').slice(0, 18);
  const channelLine = '路' + String((lamp.channel || 0) + 1).padStart(2, '0');

  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(8, 8, width - 16, height - 16, 14);
  ctx.fillStyle = on ? 'rgba(12,12,16,0.94)' : 'rgba(28,28,30,0.92)';
  ctx.strokeStyle = on ? meta.accent : '#48484a';
  ctx.fill();
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = on ? meta.accent : '#8e8e93';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(meta.short, 22, 28);

  ctx.textAlign = 'right';
  ctx.fillStyle = on ? '#dfe7f0' : '#7c828b';
  ctx.font = '600 12px sans-serif';
  ctx.fillText(channelLine, width - 22, 28);

  ctx.textAlign = 'left';
  ctx.fillStyle = on ? '#ffffff' : '#d0d0d6';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText((lamp.name || meta.label).slice(0, 12), 22, 54);

  ctx.fillStyle = on ? '#c5d0db' : '#7c828b';
  ctx.font = '12px sans-serif';
  ctx.fillText(deviceLine, 22, 78);
  lamp.labelTex.needsUpdate = true;
}

function refreshLampLabels() {
  lamps.forEach(function(lamp, index) {
    drawLabel(lamp, lamp.state);
    lamp.label.visible = isLampLabelVisible(index);
  });
  refreshLabelToggleUI();
}

function focusLamp(index) {
  if (typeof index === 'number' && index >= 0 && index < lamps.length) {
    focusedLampIdx = index;
  } else if (!labelsPinned) {
    focusedLampIdx = null;
  }
  refreshLampLabels();
}

function toggleLabelPins(forceValue) {
  labelsPinned = typeof forceValue === 'boolean' ? forceValue : !labelsPinned;
  if (!labelsPinned && (focusedLampIdx == null || focusedLampIdx >= lamps.length)) {
    focusedLampIdx = null;
  }
  refreshLampLabels();
}

function getItemMountedY(item, built, scale) {
  const mount = typeof item.mount === 'string' ? item.mount : (getItemMeta(item.type).mount || 'free');
  switch (mount) {
    case 'ceiling': {
      if (!Number.isFinite(built.mountY)) return 0;
      const ceilingY = clamp(BUILDING.wallH - 0.6, 10, BUILDING.ridgeH - 1.6);
      return ceilingY - built.mountY * scale;
    }
    case 'wall_high': {
      if (!Number.isFinite(built.mountY)) return 0;
      const wallY = clamp(BUILDING.wallH * 0.76, 12, BUILDING.wallH - 2.2);
      return wallY - built.mountY * scale;
    }
    case 'wall_mid': {
      if (!Number.isFinite(built.mountY)) return 0;
      const wallY = clamp(BUILDING.wallH * 0.42, 6.2, BUILDING.wallH - 6);
      return wallY - built.mountY * scale;
    }
    case 'floor':
      return -((Number.isFinite(built.floorY) ? built.floorY : 0) * scale);
    default:
      return 0;
  }
}

function createLamp(lightIdx, x, z, item) {
  const meta = getItemMeta(item.type);
  const scale = clamp(Number(item.scale) || 1, 0.4, 3);
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const modelRoot = new THREE.Group();
  group.add(modelRoot);
  const built = buildItemModel(item.type, modelRoot, meta);
  group.position.y = getItemMountedY(item, built, scale);
  modelRoot.scale.setScalar(scale);

  const hitW = Math.max(built.hit.w * scale, 2.4);
  const hitH = Math.max(built.hit.h * scale, 1.4);
  const hitD = Math.max(built.hit.d * scale, 2.4);
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(hitW, hitH, hitD),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hit.position.y = built.hit.y * scale;
  hit.userData.lightIdx = lightIdx;
  group.add(hit);

  const labelY = Math.max(built.labelY * scale, built.labelY * 0.84) + 0.18;
  const labelSprite = createCanvasSprite(256, 96, 7.8, 2.8, labelY);
  group.add(labelSprite.sprite);

  scene.add(group);

  const lamp = {
    group: group,
    hit: hit,
    labelCanvas: labelSprite.canvas,
    labelTex: labelSprite.tex,
    label: labelSprite.sprite,
    state: false,
    name: item.name || '',
    meta: meta,
    channel: item.channel,
    deviceIp: item.device_ip,
    deviceName: getDeviceDisplayName(item.device_ip),
    scale: scale,
    applyState: built.applyState,
    tick: built.tick || null
  };
  if (lamp.applyState) lamp.applyState(false);
  lamp.label.visible = false;
  drawLabel(lamp, false);
  return lamp;
}

function disposeLamp(lamp) {
  if (!lamp) return;
  disposeObjectGraph(lamp.group);
  if (lamp.labelTex) lamp.labelTex.dispose();
}

function computeLayout(lights) {
  const positions = new Array(lights.length);
  const needAutoIdxs = [];
  lights.forEach(function(light, index) {
    if (typeof light.x === 'number' && typeof light.z === 'number') {
      const point = clampFloorPoint({ x: light.x, z: light.z });
      positions[index] = { x: point.x, z: point.z };
    } else {
      needAutoIdxs.push(index);
    }
  });
  if (needAutoIdxs.length === 0) return positions;

  const groups = {};
  const order = [];
  needAutoIdxs.forEach(function(index) {
    const ip = lights[index].device_ip;
    if (!groups[ip]) {
      groups[ip] = [];
      order.push(ip);
    }
    groups[ip].push(index);
  });

  const groupCount = order.length || 1;
  const zSpan = Math.max(12 * SCALE, BUILDING.depth - 8 * SCALE);
  const xSpan = Math.max(18 * SCALE, BUILDING.width - 12 * SCALE);
  const bandH = zSpan / groupCount;

  order.forEach(function(ip, groupIndex) {
    const indices = groups[ip];
    const count = indices.length;
    const perRow = Math.min(8, Math.max(1, count));
    const rows = Math.ceil(count / perRow);
    const bandCenter = -zSpan / 2 + bandH * (groupIndex + 0.5);

    indices.forEach(function(lightIndex, orderIndex) {
      const row = Math.floor(orderIndex / perRow);
      const column = orderIndex % perRow;
      const xSpacing = Math.min(6 * SCALE, xSpan / Math.max(perRow, 1));
      const x = (column - (perRow - 1) / 2) * xSpacing;
      const rowOffset = (row - (rows - 1) / 2) * Math.min(4 * SCALE, bandH / Math.max(rows, 1));
      positions[lightIndex] = clampFloorPoint({ x: x, z: bandCenter + rowOffset });
    });
  });
  return positions;
}

function rebuildLamps() {
  lamps.forEach(disposeLamp);
  lamps = [];
  config.lights = (config.lights || []).map(normalizeLight);
  clampLightPositionsToBuilding();

  const lights = config.lights || [];
  const positions = computeLayout(lights);
  lights.forEach(function(light, index) {
    const point = positions[index] || { x: 0, z: 0 };
    lamps.push(createLamp(index, point.x, point.z, light));
  });

  if (focusedLampIdx != null && focusedLampIdx >= lamps.length) {
    focusedLampIdx = null;
  }
  refreshLampLabels();
}

function setLampState(index, state) {
  const lamp = lamps[index];
  if (!lamp) return;
  const changed = lamp.state !== state;
  lamp.state = state;
  if (changed && lamp.applyState) lamp.applyState(state);
  drawLabel(lamp, state);
  lamp.label.visible = isLampLabelVisible(index);
}
