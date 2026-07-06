(function () {
  'use strict';

  if (typeof BABYLON === 'undefined') {
    showFatal('Babylon.js 没有加载成功，请检查 libs/babylon.js。');
    return;
  }

  var SCALE = 10;
  var DEFAULT_BUILDING = { width: 120, depth: 64, wallH: 33, ridgeH: 50 };
  var MAX_DYNAMIC_LIGHTS = 14;
  var DEFAULT_VIEW_ALPHA = 1.70;
  var DEFAULT_VIEW_BETA = 0.72;
  var DEFAULT_VIEW_RADIUS_SCALE = 0.92;

  var state = {
    config: { devices: [], lights: [], scenes: [], layout: { building: DEFAULT_BUILDING } },
    status: {},
    activeStyle: 'tech',
    selectedLight: null,
    walkMode: false,
    lightEntries: [],
    layoutEntries: [],
    sceneRoot: null,
    materials: Object.create(null)
  };
  var orbitPanKeys = Object.create(null);

  var canvas = document.getElementById('scene');
  var engine = new BABYLON.Engine(canvas, true, {
    antialias: true,
    stencil: true,
    preserveDrawingBuffer: false
  });

  function resizeScene() {
    var pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5);
    if (engine.setHardwareScalingLevel) engine.setHardwareScalingLevel(1 / pixelRatio);
    engine.resize();
  }

  var scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.060, 0.070, 0.083, 1);
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.00062;
  scene.fogColor = new BABYLON.Color3(0.060, 0.070, 0.083);
  scene.collisionsEnabled = true;
  scene.environmentIntensity = 0.90;

  if (scene.imageProcessingConfiguration) {
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
    scene.imageProcessingConfiguration.exposure = 1.42;
    scene.imageProcessingConfiguration.contrast = 1.03;
  }

  var orbitCamera = new BABYLON.ArcRotateCamera(
    'orbit-camera',
    DEFAULT_VIEW_ALPHA,
    DEFAULT_VIEW_BETA,
    850,
    new BABYLON.Vector3(0, 35, 0),
    scene
  );
  orbitCamera.attachControl(canvas, true);
  orbitCamera.lowerBetaLimit = 0.32;
  orbitCamera.upperBetaLimit = 1.38;
  orbitCamera.lowerRadiusLimit = 150;
  orbitCamera.upperRadiusLimit = 1400;
  orbitCamera.wheelPrecision = 7;
  orbitCamera.wheelDeltaPercentage = 0.035;
  orbitCamera.panningSensibility = 38;
  orbitCamera.inertia = 0.72;
  orbitCamera.minZ = 0.3;
  orbitCamera.maxZ = 3200;

  var walkCamera = new BABYLON.UniversalCamera('walk-camera', new BABYLON.Vector3(-260, 38, 190), scene);
  walkCamera.setTarget(new BABYLON.Vector3(0, 30, 0));
  walkCamera.speed = 6.0;
  walkCamera.angularSensibility = 2600;
  walkCamera.inertia = 0.66;
  walkCamera.minZ = 0.25;
  walkCamera.maxZ = 2400;
  walkCamera.ellipsoid = new BABYLON.Vector3(8, 18, 8);
  walkCamera.checkCollisions = true;
  walkCamera.keysUp = [87, 38];
  walkCamera.keysDown = [83, 40];
  walkCamera.keysLeft = [65, 37];
  walkCamera.keysRight = [68, 39];

  scene.activeCamera = orbitCamera;

  canvas.addEventListener('wheel', function (event) {
    if (scene.activeCamera !== orbitCamera) return;
    event.preventDefault();
    var delta = Math.sign(event.deltaY || 0);
    if (!delta) return;
    var factor = delta > 0 ? 1.11 : 0.90;
    orbitCamera.radius = clamp(
      orbitCamera.radius * factor,
      orbitCamera.lowerRadiusLimit || 80,
      orbitCamera.upperRadiusLimit || 1600
    );
  }, { passive: false });

  function isTypingTarget(target) {
    if (!target) return false;
    var tag = String(target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function orbitPanDirection(code) {
    var map = {
      KeyW: 'forward',
      ArrowUp: 'forward',
      KeyS: 'back',
      ArrowDown: 'back',
      KeyA: 'left',
      ArrowLeft: 'left',
      KeyD: 'right',
      ArrowRight: 'right'
    };
    return map[code] || null;
  }

  function clearOrbitPanKeys() {
    orbitPanKeys = Object.create(null);
  }

  function handleOrbitPanKey(event, pressed) {
    if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    var direction = orbitPanDirection(event.code);
    if (!direction) return;
    if (!pressed) orbitPanKeys[direction] = false;
    if (scene.activeCamera !== orbitCamera || state.walkMode) return;
    orbitPanKeys[direction] = pressed;
    event.preventDefault();
  }

  function clampOrbitTarget(target) {
    var b = state.config && state.config.layout && state.config.layout.building;
    if (!b) return target;
    var margin = 160;
    target.x = clamp(target.x, -b.halfW - margin, b.halfW + margin);
    target.z = clamp(target.z, -b.halfD - margin, b.halfD + margin);
    target.y = clamp(target.y, 10, Math.max(80, b.ridgeH + 35));
    return target;
  }

  function updateOrbitKeyboardPan() {
    if (scene.activeCamera !== orbitCamera || state.walkMode) return;
    if (!orbitPanKeys.forward && !orbitPanKeys.back && !orbitPanKeys.left && !orbitPanKeys.right) return;

    var forward = orbitCamera.target.subtract(orbitCamera.position);
    forward.y = 0;
    if (forward.lengthSquared() < 0.0001) {
      forward = new BABYLON.Vector3(Math.sin(orbitCamera.alpha), 0, Math.cos(orbitCamera.alpha));
    }
    forward.normalize();
    var right = BABYLON.Vector3.Cross(BABYLON.Axis.Y, forward);
    right.normalize();

    var move = BABYLON.Vector3.Zero();
    if (orbitPanKeys.forward) move.addInPlace(forward);
    if (orbitPanKeys.back) move.subtractInPlace(forward);
    if (orbitPanKeys.right) move.addInPlace(right);
    if (orbitPanKeys.left) move.subtractInPlace(right);
    if (move.lengthSquared() < 0.0001) return;

    var dt = Math.min(engine.getDeltaTime() / 1000 || 1 / 60, 0.05);
    var speed = clamp((orbitCamera.radius || 420) * 0.45, 80, 420);
    move.normalize().scaleInPlace(speed * dt);
    orbitCamera.target.addInPlace(move);
    clampOrbitTarget(orbitCamera.target);
  }

  window.addEventListener('keydown', function (event) {
    handleOrbitPanKey(event, true);
  });
  window.addEventListener('keyup', function (event) {
    handleOrbitPanKey(event, false);
  });
  window.addEventListener('blur', clearOrbitPanKeys);

  var hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0.1, 1, 0.25), scene);
  hemi.intensity = 1.00;
  hemi.diffuse = new BABYLON.Color3(0.72, 0.82, 0.92);
  hemi.groundColor = new BABYLON.Color3(0.14, 0.17, 0.15);

  var keyLight = new BABYLON.DirectionalLight('key-light', new BABYLON.Vector3(0.42, -0.82, 0.38), scene);
  keyLight.position = new BABYLON.Vector3(-420, 580, -360);
  keyLight.intensity = 3.05;
  keyLight.diffuse = new BABYLON.Color3(1.0, 0.88, 0.68);

  var shadow = new BABYLON.ShadowGenerator(2048, keyLight);
  shadow.useBlurExponentialShadowMap = true;
  shadow.blurKernel = 24;
  shadow.setDarkness(0.27);

  var glow = new BABYLON.GlowLayer('main-glow', scene, { mainTextureSamples: 4 });
  glow.intensity = 0.58;

  var highlight = new BABYLON.HighlightLayer('selection-highlight', scene);
  highlight.innerGlow = false;
  highlight.outerGlow = true;
  highlight.blurHorizontalSize = 0.8;
  highlight.blurVerticalSize = 0.8;

  var pipeline = null;
  var ssaoPipeline = null;
  if (BABYLON.DefaultRenderingPipeline) {
    pipeline = new BABYLON.DefaultRenderingPipeline('main-pipeline', true, scene, [orbitCamera, walkCamera]);
    pipeline.samples = 4;
    pipeline.fxaaEnabled = true;
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.62;
    pipeline.bloomWeight = 0.34;
    pipeline.bloomKernel = 72;
    pipeline.imageProcessingEnabled = true;
  }
  try {
    if (BABYLON.SSAO2RenderingPipeline) {
      ssaoPipeline = new BABYLON.SSAO2RenderingPipeline(
        'main-ssao',
        scene,
        { ssaoRatio: 0.55, blurRatio: 0.5 },
        [orbitCamera, walkCamera]
      );
      ssaoPipeline.radius = 4.2;
      ssaoPipeline.totalStrength = 0.74;
      ssaoPipeline.base = 0.08;
      ssaoPipeline.samples = 8;
      ssaoPipeline.maxZ = 1800;
    }
  } catch (error) {
    ssaoPipeline = null;
    console.warn('[BabylonApp] SSAO unavailable:', error);
  }

  var palette = {
    tech: {
      clear: new BABYLON.Color4(0.060, 0.070, 0.083, 1),
      fog: new BABYLON.Color3(0.060, 0.070, 0.083),
      floor: '#172432',
      ground: '#0c1118',
      wall: '#1b3240',
      steel: '#9cadbb',
      body: '#3a4652',
      glow: '#35e6a8',
      warm: '#ffbf67'
    },
    soft: {
      clear: new BABYLON.Color4(0.70, 0.73, 0.75, 1),
      fog: new BABYLON.Color3(0.70, 0.73, 0.75),
      floor: '#d4d8d7',
      ground: '#8b9492',
      wall: '#c8cecc',
      steel: '#6e767a',
      body: '#7b8789',
      glow: '#30d158',
      warm: '#ff9f0a'
    }
  };

  function showFatal(message) {
    document.body.innerHTML = '<div style="padding:24px;color:#fff;background:#111;font-family:sans-serif">' + escapeHtml(message) + '</div>';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function toNumber(value, fallback) {
    var next = Number(value);
    return Number.isFinite(next) ? next : fallback;
  }

  function mapConfigPoint(x, z) {
    return {
      x: -toNumber(x, 0),
      z: toNumber(z, 0)
    };
  }

  function mapLayoutItem(item) {
    var next = Object.assign({}, item || {});
    if (next.x != null || next.z != null) {
      var point = mapConfigPoint(next.x, next.z);
      next.x = point.x;
      next.z = point.z;
    }
    if (next.rotation != null) next.rotation = -toNumber(next.rotation, 0);
    return next;
  }

  function mapLayoutItems(items) {
    return Array.isArray(items) ? items.map(mapLayoutItem) : [];
  }

  function looksBrokenText(value) {
    if (!value) return true;
    return /[�\u0590-\u05ff]/.test(value) || /[鐏鏂鍘惧僵佃灞扮]/.test(value);
  }

  function cleanName(value, fallback) {
    var text = String(value == null ? '' : value).trim();
    return looksBrokenText(text) ? fallback : text;
  }

  function color3(hex) {
    return BABYLON.Color3.FromHexString(hex);
  }

  function hexToRgb(hex) {
    var value = String(hex || '#ffffff').replace('#', '');
    if (value.length === 3) value = value.replace(/(.)/g, '$1$1');
    var num = parseInt(value, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  function pbr(name, options) {
    options = options || {};
    var mat = new BABYLON.PBRMaterial(name, scene);
    mat.albedoColor = color3(options.color || '#ffffff');
    mat.metallic = options.metallic == null ? 0.1 : options.metallic;
    mat.roughness = options.roughness == null ? 0.58 : options.roughness;
    if (options.emissive) mat.emissiveColor = color3(options.emissive);
    if (options.alpha != null && options.alpha < 1) {
      mat.alpha = options.alpha;
      mat.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_ALPHABLEND;
      mat.backFaceCulling = false;
      mat.disableDepthWrite = true;
    }
    return mat;
  }

  function standard(name, options) {
    options = options || {};
    var mat = new BABYLON.StandardMaterial(name, scene);
    mat.diffuseColor = color3(options.color || '#ffffff');
    mat.specularColor = color3(options.specular || '#050505');
    if (options.emissive) mat.emissiveColor = color3(options.emissive);
    if (options.alpha != null && options.alpha < 1) {
      mat.alpha = options.alpha;
      mat.backFaceCulling = false;
    }
    return mat;
  }

  function disposeMaterials() {
    Object.keys(state.materials).forEach(function (key) {
      var mat = state.materials[key];
      if (mat && mat.dispose) mat.dispose();
    });
    state.materials = Object.create(null);
  }

  function buildMaterials() {
    disposeMaterials();
    var p = palette[state.activeStyle];
    state.materials.outdoor = pbr('outdoor', { color: p.ground, metallic: 0.05, roughness: 0.72 });
    state.materials.floor = makeGridMaterial('floor-grid-' + state.activeStyle, state.activeStyle);
    state.materials.wall = pbr('wall', { color: p.wall, metallic: 0.12, roughness: 0.42, alpha: state.activeStyle === 'tech' ? 0.18 : 0.72 });
    state.materials.glass = pbr('glass', { color: '#b9f3f0', metallic: 0.0, roughness: 0.18, alpha: state.activeStyle === 'tech' ? 0.14 : 0.42 });
    state.materials.steel = pbr('steel', { color: p.steel, metallic: 0.74, roughness: 0.28 });
    state.materials.dark = pbr('dark-shell', { color: state.activeStyle === 'tech' ? '#171b20' : '#5d676b', metallic: 0.42, roughness: 0.38 });
    state.materials.body = pbr('machine-body', { color: p.body, metallic: 0.36, roughness: 0.42 });
    state.materials.door = pbr('door-panel', { color: state.activeStyle === 'tech' ? '#4c7488' : '#9aa8ad', metallic: 0.34, roughness: 0.34, emissive: state.activeStyle === 'tech' ? '#0a1d24' : null });
    state.materials.path = pbr('path', { color: state.activeStyle === 'tech' ? '#245245' : '#9aa7a2', metallic: 0.05, roughness: 0.56, alpha: 0.78 });
    state.materials.zone = pbr('zone', { color: state.activeStyle === 'tech' ? '#214454' : '#b9c2c0', metallic: 0.05, roughness: 0.52, alpha: state.activeStyle === 'tech' ? 0.54 : 0.64 });
    state.materials.lampFrame = pbr('lamp-frame', { color: state.activeStyle === 'tech' ? '#9bb3c2' : '#d1d8dc', metallic: 0.64, roughness: 0.30 });
    state.materials.lampBody = pbr('lamp-body', { color: state.activeStyle === 'tech' ? '#252f38' : '#eef3f4', metallic: 0.58, roughness: 0.32 });
    state.materials.lampEndCap = pbr('lamp-endcap', { color: state.activeStyle === 'tech' ? '#12171d' : '#6a7479', metallic: 0.74, roughness: 0.26 });
    state.materials.lampTrim = pbr('lamp-trim', { color: state.activeStyle === 'tech' ? '#c5d4dd' : '#f8fbfc', metallic: 0.70, roughness: 0.24 });
    state.materials.lampCable = pbr('lamp-cable', { color: state.activeStyle === 'tech' ? '#70828e' : '#4c565b', metallic: 0.82, roughness: 0.22 });
    state.materials.floorLine = standard('floor-line', { color: '#35e6a8', emissive: '#35e6a8', alpha: state.activeStyle === 'tech' ? 0.28 : 0.18 });
    state.materials.floorLine.disableDepthWrite = true;
    state.materials.floorLine.alphaMode = BABYLON.Engine.ALPHA_ADD;
    state.materials.label = standard('label-fallback', { color: '#ffffff', emissive: '#ffffff' });
  }

  function makeGridMaterial(name, style) {
    var tex = new BABYLON.DynamicTexture(name + '-texture', { width: 1024, height: 1024 }, scene, false);
    var ctx = tex.getContext();
    var bg = style === 'tech' ? '#172432' : '#cdd3d1';
    var major = style === 'tech' ? 'rgba(53,230,168,0.36)' : 'rgba(40,70,62,0.23)';
    var minor = style === 'tech' ? 'rgba(255,255,255,0.11)' : 'rgba(20,30,30,0.10)';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1024, 1024);
    for (var i = 0; i <= 1024; i += 32) {
      ctx.strokeStyle = i % 128 === 0 ? major : minor;
      ctx.lineWidth = i % 128 === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 1024);
      ctx.moveTo(0, i);
      ctx.lineTo(1024, i);
      ctx.stroke();
    }
    ctx.fillStyle = style === 'tech' ? 'rgba(53,230,168,0.045)' : 'rgba(255,255,255,0.12)';
    for (var band = 0; band < 4; band++) {
      var bx = 96 + band * 248;
      ctx.fillRect(bx, 0, 18, 1024);
      ctx.fillRect(0, bx, 1024, 14);
    }
    var seed = 17;
    function rnd() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    for (var dot = 0; dot < 1800; dot++) {
      var alpha = style === 'tech' ? 0.055 + rnd() * 0.055 : 0.045 + rnd() * 0.05;
      ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
      ctx.fillRect(Math.floor(rnd() * 1024), Math.floor(rnd() * 1024), rnd() > 0.72 ? 2 : 1, rnd() > 0.82 ? 2 : 1);
    }
    tex.update();
    tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.uScale = 7;
    tex.vScale = 4;

    var mat = pbr(name + '-mat', {
      color: '#ffffff',
      metallic: style === 'tech' ? 0.22 : 0.04,
      roughness: style === 'tech' ? 0.26 : 0.58
    });
    mat.albedoTexture = tex;
    return mat;
  }

  function normalizeBuilding(building) {
    var src = building || DEFAULT_BUILDING;
    var width = clamp(toNumber(src.width, DEFAULT_BUILDING.width), 24, 140);
    var depth = clamp(toNumber(src.depth, DEFAULT_BUILDING.depth), 18, 110);
    var wallH = clamp(toNumber(src.wallH, DEFAULT_BUILDING.wallH), 12, 56);
    var ridgeH = clamp(toNumber(src.ridgeH, DEFAULT_BUILDING.ridgeH), wallH + 6, 84);
    return {
      configWidth: width,
      configDepth: depth,
      width: width * SCALE,
      depth: depth * SCALE,
      wallH: wallH,
      ridgeH: ridgeH,
      halfW: width * SCALE / 2,
      halfD: depth * SCALE / 2
    };
  }

  function normalizeLight(light, index) {
    var item = light || {};
    return {
      name: cleanName(item.name, '灯具 ' + pad(index + 1)),
      rawName: item.name || '',
      type: item.type || 'lamp',
      scale: clamp(toNumber(item.scale, 3), 1.2, 6),
      device_ip: item.device_ip || '',
      channel: Math.max(0, Math.floor(toNumber(item.channel, index))),
      group: cleanName(item.group, '默认分组'),
      x: toNumber(item.x, 0),
      z: toNumber(item.z, 0),
      mount: item.mount || 'ceiling'
    };
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function getRuntimeConfig() {
    return (typeof config !== 'undefined' && config) ? config : null;
  }

  function getRuntimeStatus() {
    return (typeof deviceStatus !== 'undefined' && deviceStatus) ? deviceStatus : {};
  }

  function syncRuntimeState() {
    var cfg = getRuntimeConfig() || {};
    var layout = cfg.layout || {};
    var building = normalizeBuilding(layout.building || DEFAULT_BUILDING);
    var rawLights = Array.isArray(cfg.lights) ? cfg.lights : [];
    var positions = null;
    if (typeof computeLayout === 'function') {
      try {
        positions = computeLayout(rawLights);
      } catch (error) {
        positions = null;
      }
    }
    var lights = rawLights.map(function(light, index) {
      var next = normalizeLight(light, index);
      var point = positions && positions[index];
      var sourceX = point && Number.isFinite(point.x) ? point.x : next.x;
      var sourceZ = point && Number.isFinite(point.z) ? point.z : next.z;
      var mapped = mapConfigPoint(sourceX, sourceZ);
      next.x = mapped.x;
      next.z = mapped.z;
      return next;
    });

    state.config = {
      devices: Array.isArray(cfg.devices) ? cfg.devices : [],
      lights: lights,
      scenes: Array.isArray(cfg.scenes) ? cfg.scenes : [],
      layout: {
        building: building,
        walls: mapLayoutItems(layout.walls),
        zones: mapLayoutItems(layout.zones),
        pillars: mapLayoutItems(layout.pillars),
        doors: mapLayoutItems(layout.doors),
        paths: mapLayoutItems(layout.paths),
        workstations: mapLayoutItems(layout.workstations),
        racks: mapLayoutItems(layout.racks),
        safetyStations: mapLayoutItems(layout.safetyStations)
      }
    };
    state.status = getRuntimeStatus();
  }

  function isLightConnected(light) {
    var status = state.status[light.device_ip];
    return !!(status && status.connected);
  }

  function isLightOn(light, index) {
    var status = state.status[light.device_ip];
    if (status && status.relay_states && Object.prototype.hasOwnProperty.call(status.relay_states, light.channel)) {
      return !!(status.connected && status.relay_states[light.channel]);
    }
    return false;
  }

  function getLightActivity() {
    var lights = state.config.lights || [];
    var total = lights.length;
    var on = 0;
    lights.forEach(function (light, index) {
      if (isLightOn(light, index)) on++;
    });
    return {
      total: total,
      on: on,
      ratio: total ? on / total : 0
    };
  }

  function updateSceneLighting() {
    var activity = getLightActivity();
    var ratio = clamp(activity.ratio, 0, 1);
    var hasLight = activity.on > 0 ? 1 : 0;
    var style = state.activeStyle;
    var base = style === 'tech'
      ? { hemi: 1.00, key: 3.20, glow: 0.62, env: 0.92, fog: 0.00062, exposure: 1.42, contrast: 1.03, bloom: 0.36, threshold: 0.58, shadow: 0.27, ssao: 0.74, ssaoBase: 0.08 }
      : { hemi: 0.84, key: 1.86, glow: 0.46, env: 0.82, fog: 0.00078, exposure: 1.30, contrast: 1.02, bloom: 0.26, threshold: 0.70, shadow: 0.30, ssao: 0.68, ssaoBase: 0.10 };
    var lift = hasLight * 0.12 + ratio * 0.42;

    scene.environmentIntensity = base.env + lift * 0.48;
    scene.fogDensity = Math.max(base.fog * (1 - ratio * 0.28 - hasLight * 0.06), base.fog * 0.64);
    hemi.intensity = base.hemi + lift * 0.56;
    keyLight.intensity = base.key + lift * 0.92;
    glow.intensity = base.glow + hasLight * 0.08 + ratio * 0.26;
    shadow.setDarkness(Math.max(0.16, base.shadow - hasLight * 0.03 - ratio * 0.09));

    if (scene.imageProcessingConfiguration) {
      scene.imageProcessingConfiguration.exposure = base.exposure + hasLight * 0.08 + ratio * 0.24;
      scene.imageProcessingConfiguration.contrast = base.contrast;
    }
    if (pipeline) {
      pipeline.bloomWeight = base.bloom + hasLight * 0.04 + ratio * 0.18;
      pipeline.bloomThreshold = Math.max(0.44, base.threshold - hasLight * 0.03 - ratio * 0.10);
    }
    if (ssaoPipeline) {
      ssaoPipeline.totalStrength = Math.max(0.48, base.ssao - hasLight * 0.06 - ratio * 0.16);
      ssaoPipeline.base = base.ssaoBase + hasLight * 0.02 + ratio * 0.05;
    }
  }

  function rebuildScene() {
    syncRuntimeState();
    if (state.sceneRoot) {
      state.sceneRoot.dispose(false, true);
      state.sceneRoot = null;
    }
    buildMaterials();
    state.lightEntries = [];
    state.layoutEntries = [];
    highlight.removeAllMeshes();

    var root = new BABYLON.TransformNode('babylon-app-root', scene);
    state.sceneRoot = root;

    createFactory(root);
    createLayoutObjects(root);
    createLights(root);
  }

  function addShadow(mesh, cast, receive) {
    if (cast !== false) shadow.addShadowCaster(mesh, true);
    mesh.receiveShadows = receive !== false;
    return mesh;
  }

  function box(name, size, position, material, parent, cast, receive) {
    var mesh = BABYLON.MeshBuilder.CreateBox(name, {
      width: size.x,
      height: size.y,
      depth: size.z
    }, scene);
    mesh.position.copyFrom(position);
    mesh.material = material;
    if (parent) mesh.parent = parent;
    mesh.checkCollisions = true;
    return addShadow(mesh, cast, receive);
  }

  function cylinder(name, options, position, material, parent, cast, receive) {
    var mesh = BABYLON.MeshBuilder.CreateCylinder(name, options, scene);
    mesh.position.copyFrom(position);
    mesh.material = material;
    if (parent) mesh.parent = parent;
    return addShadow(mesh, cast, receive);
  }

  function createFactory(root) {
    var b = state.config.layout.building;
    var outdoor = BABYLON.MeshBuilder.CreateGround('outdoor-ground', {
      width: b.width + 320,
      height: b.depth + 280,
      subdivisions: 2
    }, scene);
    outdoor.position.y = -2;
    outdoor.material = state.materials.outdoor;
    outdoor.receiveShadows = true;
    outdoor.parent = root;

    var floor = BABYLON.MeshBuilder.CreateGround('factory-floor', {
      width: b.width,
      height: b.depth,
      subdivisions: 2
    }, scene);
    floor.material = state.materials.floor;
    floor.receiveShadows = true;
    floor.parent = root;
    createFloorAccents(root, b);

    box('center-path', new BABYLON.Vector3(b.width * 0.94, 1.2, Math.max(26, b.depth * 0.07)), new BABYLON.Vector3(0, 1.2, 0), state.materials.path, root, false, true);
    box('front-zone', new BABYLON.Vector3(b.width * 0.88, 1.2, b.depth * 0.28), new BABYLON.Vector3(0, 1.4, -b.depth * 0.28), state.materials.zone, root, false, true);
    box('back-zone', new BABYLON.Vector3(b.width * 0.88, 1.2, b.depth * 0.28), new BABYLON.Vector3(0, 1.4, b.depth * 0.28), state.materials.zone, root, false, true);

    var wallH = b.wallH;
    var sideDoorW = Math.min(190, b.depth * 0.34);
    var sideDoorH = wallH * 0.72;
    var sideWallSegment = Math.max(20, (b.depth - sideDoorW) / 2);
    box('back-wall', new BABYLON.Vector3(b.width, wallH, 5), new BABYLON.Vector3(0, wallH / 2, b.halfD), state.materials.wall, root, true, true);
    box('left-wall', new BABYLON.Vector3(5, wallH, b.depth), new BABYLON.Vector3(-b.halfW, wallH / 2, 0), state.materials.wall, root, true, true);
    box('right-wall-front', new BABYLON.Vector3(5, wallH, sideWallSegment), new BABYLON.Vector3(b.halfW, wallH / 2, -sideDoorW / 2 - sideWallSegment / 2), state.materials.wall, root, true, true);
    box('right-wall-back', new BABYLON.Vector3(5, wallH, sideWallSegment), new BABYLON.Vector3(b.halfW, wallH / 2, sideDoorW / 2 + sideWallSegment / 2), state.materials.wall, root, true, true);
    box('right-door-header', new BABYLON.Vector3(5, wallH - sideDoorH, sideDoorW), new BABYLON.Vector3(b.halfW, sideDoorH + (wallH - sideDoorH) / 2, 0), state.materials.wall, root, true, true);
    box('front-wall', new BABYLON.Vector3(b.width, wallH, 5), new BABYLON.Vector3(0, wallH / 2, -b.halfD), state.materials.wall, root, true, true);

    createRightMiddleGate(root, b, sideDoorW, sideDoorH);

    createRoof(root, b);
    createFrame(root, b);
  }

  function createFloorAccents(root, b) {
    var y = 1.92;
    var sideX = b.width * 0.23;
    var lineW = Math.max(3, b.width * 0.004);
    [
      [-sideX, 0, lineW, b.depth * 0.88],
      [sideX, 0, lineW, b.depth * 0.88],
      [0, -b.depth * 0.24, b.width * 0.86, lineW],
      [0, b.depth * 0.24, b.width * 0.86, lineW]
    ].forEach(function (item, index) {
      var mesh = box(
        'floor-accent-' + index,
        new BABYLON.Vector3(item[2], 0.22, item[3]),
        new BABYLON.Vector3(item[0], y, item[1]),
        state.materials.floorLine,
        root,
        false,
        false
      );
      mesh.checkCollisions = false;
      mesh.isPickable = false;
    });
  }

  function createRightMiddleGate(root, b, width, height) {
    var x = b.halfW + 3.4;
    var panelDepth = width * 0.46;
    box('main-gate-left-panel', new BABYLON.Vector3(3.2, height, panelDepth), new BABYLON.Vector3(x, height / 2, -width * 0.24), state.materials.door, root, true, true);
    box('main-gate-right-panel', new BABYLON.Vector3(3.2, height, panelDepth), new BABYLON.Vector3(x, height / 2, width * 0.24), state.materials.door, root, true, true);
    box('main-gate-center-line', new BABYLON.Vector3(3.6, height * 0.92, 1.2), new BABYLON.Vector3(x + 0.1, height * 0.46, 0), state.materials.steel, root, true, true);
    box('main-gate-top-track', new BABYLON.Vector3(6.4, 3.0, width * 1.08), new BABYLON.Vector3(x, height + 1.5, 0), state.materials.steel, root, true, true);
    box('main-gate-floor-track', new BABYLON.Vector3(6.0, 1.0, width * 1.1), new BABYLON.Vector3(x, 0.7, 0), state.materials.steel, root, true, true);
    box('main-gate-apron', new BABYLON.Vector3(86, 0.9, width * 1.08), new BABYLON.Vector3(b.halfW + 46, 0.8, 0), state.materials.path, root, false, true).checkCollisions = false;
    createGateSign(root, new BABYLON.Vector3(b.halfW + 22, height + 30, 0));
  }

  function createGateSign(parent, position) {
    var tex = new BABYLON.DynamicTexture('main-gate-sign-texture', { width: 360, height: 120 }, scene, false);
    tex.hasAlpha = true;
    var ctx = tex.getContext();
    ctx.clearRect(0, 0, 360, 120);
    ctx.fillStyle = 'rgba(8,18,25,0.82)';
    roundRect(ctx, 18, 18, 324, 84, 16);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(53,230,168,0.88)';
    ctx.stroke();
    ctx.fillStyle = '#eafff6';
    ctx.font = '700 38px Microsoft YaHei, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('主入口', 180, 60);
    tex.update();

    var mat = new BABYLON.StandardMaterial('main-gate-sign-material', scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.disableLighting = true;
    mat.backFaceCulling = false;

    var sign = BABYLON.MeshBuilder.CreatePlane('main-gate-sign', { width: 112, height: 37 }, scene);
    sign.position.copyFrom(position);
    sign.material = mat;
    sign.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    sign.isPickable = false;
    sign.parent = parent;
  }

  function createRoof(root, b) {
    var width = b.width + 46;
    var depth = b.depth + 42;
    var hw = width / 2;
    var hd = depth / 2;
    var positions = [
      -hw, b.wallH, -hd, 0, b.ridgeH, -hd, 0, b.ridgeH, hd, -hw, b.wallH, hd,
      hw, b.wallH, -hd, 0, b.ridgeH, -hd, 0, b.ridgeH, hd, hw, b.wallH, hd
    ];
    var indices = [0, 1, 2, 0, 2, 3, 4, 7, 6, 4, 6, 5];
    var normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);

    var mesh = new BABYLON.Mesh('factory-roof', scene);
    var data = new BABYLON.VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.uvs = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
    data.applyToMesh(mesh);
    mesh.material = pbr('roof-material', {
      color: state.activeStyle === 'tech' ? '#2e4050' : '#aeb6b6',
      metallic: state.activeStyle === 'tech' ? 0.46 : 0.18,
      roughness: state.activeStyle === 'tech' ? 0.25 : 0.48,
      alpha: state.activeStyle === 'tech' ? 0.045 : 0.48
    });
    mesh.parent = root;
    mesh.isPickable = false;
    addShadow(mesh, true, true);
  }

  function createFrame(root, b) {
    var count = Math.max(4, Math.round(b.width / 260));
    for (var i = 0; i < count; i++) {
      var x = -b.halfW + 48 + i * ((b.width - 96) / Math.max(1, count - 1));
      box('steel-column-front-' + i, new BABYLON.Vector3(7, b.wallH, 7), new BABYLON.Vector3(x, b.wallH / 2, -b.halfD + 22), state.materials.steel, root, true, true);
      box('steel-column-back-' + i, new BABYLON.Vector3(7, b.wallH, 7), new BABYLON.Vector3(x, b.wallH / 2, b.halfD - 22), state.materials.steel, root, true, true);
    }

  }

  function createLayoutObjects(root) {
    var layout = state.config.layout;
    layout.workstations.forEach(function (item, index) {
      createWorkstation(item, index, root);
    });
    layout.racks.forEach(function (item, index) {
      createRack(item, index, root);
    });
    layout.paths.forEach(function (item, index) {
      createPath(item, index, root);
    });
    layout.zones.forEach(function (item, index) {
      createZone(item, index, root);
    });
  }

  function createRotatedRoot(name, item, parent) {
    var node = new BABYLON.TransformNode(name, scene);
    node.position = new BABYLON.Vector3(toNumber(item.x, 0), 0, toNumber(item.z, 0));
    node.rotation.y = toNumber(item.rotation, 0) * Math.PI / 180;
    node.parent = parent;
    return node;
  }

  function createWorkstation(item, index, parent) {
    var width = Math.max(24, toNumber(item.width, 80));
    var depth = Math.max(16, toNumber(item.depth, 42));
    var height = Math.max(5, toNumber(item.height, 9));
    var root = createRotatedRoot('workstation-' + index, item, parent);
    var surface = box('workstation-zone-' + index, new BABYLON.Vector3(width, 0.8, depth), new BABYLON.Vector3(0, 0.7, 0), state.materials.zone, root, false, true);
    surface.checkCollisions = false;

    if (item.variant === 'cigarette') {
      var baseW = width * 0.86;
      var baseD = depth * 0.30;
      box('cig-base-' + index, new BABYLON.Vector3(baseW, height * 0.18, baseD), new BABYLON.Vector3(0, height * 0.09 + 1, 0), state.materials.body, root, true, true);
      box('cig-left-block-' + index, new BABYLON.Vector3(width * 0.16, height * 0.48, depth * 0.44), new BABYLON.Vector3(-width * 0.34, height * 0.35 + 1, 0), state.materials.dark, root, true, true);
      box('cig-top-arm-' + index, new BABYLON.Vector3(width * 0.55, height * 0.12, depth * 0.14), new BABYLON.Vector3(width * 0.12, height * 0.88 + 1, 0), state.materials.steel, root, true, true);
      box('cig-motor-' + index, new BABYLON.Vector3(width * 0.18, height * 0.42, depth * 0.48), new BABYLON.Vector3(-width * 0.12, height * 1.08 + 1, 0), state.materials.body, root, true, true);
      box('cig-plate-' + index, new BABYLON.Vector3(width * 0.07, height * 0.54, depth * 0.45), new BABYLON.Vector3(width * 0.40, height * 1.06 + 1, 0), state.materials.steel, root, true, true);
      cylinder('cig-drum-' + index, { height: depth * 0.28, diameter: depth * 0.24, tessellation: 24 }, new BABYLON.Vector3(width * 0.29, height * 0.48 + 1, 0), state.materials.steel, root, true, false).rotation.x = Math.PI / 2;
    } else {
      box('work-base-' + index, new BABYLON.Vector3(width * 0.7, height * 0.28, depth * 0.42), new BABYLON.Vector3(0, height * 0.18 + 1, 0), state.materials.body, root, true, true);
      box('work-post-' + index, new BABYLON.Vector3(width * 0.12, height * 0.72, depth * 0.14), new BABYLON.Vector3(-width * 0.22, height * 0.48 + 1, 0), state.materials.steel, root, true, true);
    }

    state.layoutEntries.push({
      kind: 'workstation',
      name: cleanName(item.name, '工位 ' + pad(index + 1)),
      meta: Math.round(width) + ' × ' + Math.round(depth),
      focus: new BABYLON.Vector3(toNumber(item.x, 0), 12, toNumber(item.z, 0))
    });
  }

  function createRack(item, index, parent) {
    var root = createRotatedRoot('rack-' + index, item, parent);
    var width = Math.max(24, toNumber(item.width, 80));
    var depth = Math.max(16, toNumber(item.depth, 32));
    var height = Math.max(8, toNumber(item.height, 16));
    box('rack-zone-' + index, new BABYLON.Vector3(width, 0.8, depth), new BABYLON.Vector3(0, 0.7, 0), state.materials.zone, root, false, true);
    var legW = Math.max(1.2, depth * 0.08);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (pair) {
      box('rack-leg-' + index + pair.join('-'), new BABYLON.Vector3(legW, height, legW), new BABYLON.Vector3(pair[0] * (width / 2 - legW), height / 2 + 1, pair[1] * (depth / 2 - legW)), state.materials.steel, root, true, true);
    });
    for (var i = 1; i <= 3; i++) {
      box('rack-shelf-' + index + '-' + i, new BABYLON.Vector3(width * 0.9, 0.42, depth * 0.82), new BABYLON.Vector3(0, 1 + i * height / 4, 0), state.materials.body, root, true, true);
    }
  }

  function createPath(item, index, parent) {
    var root = createRotatedRoot('path-' + index, item, parent);
    box('path-fill-' + index, new BABYLON.Vector3(Math.max(8, toNumber(item.width, 80)), 0.9, Math.max(8, toNumber(item.depth, 24))), new BABYLON.Vector3(0, 0.8, 0), state.materials.path, root, false, true);
  }

  function createZone(item, index, parent) {
    var root = createRotatedRoot('zone-' + index, item, parent);
    box('zone-fill-' + index, new BABYLON.Vector3(Math.max(8, toNumber(item.width, 80)), 0.75, Math.max(8, toNumber(item.depth, 42))), new BABYLON.Vector3(0, 0.7, 0), state.materials.zone, root, false, true);
  }

  function createLights(root) {
    var lights = state.config.lights;
    var b = state.config.layout.building;
    lights.forEach(function (light, index) {
      var entry = createLightNode(light, index, b, root);
      state.lightEntries[index] = entry;
      updateLightVisual(index);
    });
    updateSceneLighting();
  }

  function createLightNode(light, index, b, parent) {
    var root = new BABYLON.TransformNode('light-root-' + index, scene);
    root.position = new BABYLON.Vector3(clamp(light.x, -b.halfW + 10, b.halfW - 10), 0, clamp(light.z, -b.halfD + 10, b.halfD - 10));
    root.parent = parent;
    root.metadata = { lightIndex: index };

    var size = clamp(light.scale * 4.5, 8, 24);
    var y = light.mount === 'floor' ? 16 : Math.max(b.wallH + 6, b.ridgeH - 8);
    var meshes = [];

    var panelW = size * 2.35;
    var panelH = Math.max(3.6, size * 0.34);
    var panelD = size * 1.05;

    var supportHeight = Math.max(10, y - b.wallH);
    var supportOffset = Math.max(4.6, panelW * 0.31);
    if (light.mount === 'floor') {
      meshes.push(cylinder('lamp-floor-base-' + index, { height: 1.0, diameter: Math.max(10, panelD * 0.82), tessellation: 28 }, new BABYLON.Vector3(0, 0.5, 0), state.materials.lampEndCap, root, true, false));
      meshes.push(cylinder('lamp-floor-post-' + index, { height: Math.max(8, y - panelH), diameter: 1.7, tessellation: 12 }, new BABYLON.Vector3(0, Math.max(8, y - panelH) / 2 + 1, panelD * 0.42), state.materials.lampCable, root, true, false));
    } else {
      [-supportOffset, supportOffset].forEach(function (offset, cableIndex) {
        meshes.push(cylinder(
          'lamp-suspension-cable-' + index + '-' + cableIndex,
          { height: supportHeight, diameter: Math.max(0.52, panelH * 0.12), tessellation: 10 },
          new BABYLON.Vector3(offset, y + panelH * 0.58 + supportHeight / 2, 0),
          state.materials.lampCable,
          root,
          true,
          false
        ));
        meshes.push(box(
          'lamp-ceiling-anchor-' + index + '-' + cableIndex,
          new BABYLON.Vector3(Math.max(3.6, panelH * 0.76), Math.max(0.7, panelH * 0.18), panelD * 0.34),
          new BABYLON.Vector3(offset, y + panelH * 0.58 + supportHeight + panelH * 0.1, 0),
          state.materials.lampTrim,
          root,
          true,
          false
        ));
      });
    }

    meshes.push(box(
      'lamp-body-' + index,
      new BABYLON.Vector3(panelW * 1.16, panelH * 0.82, panelD * 1.12),
      new BABYLON.Vector3(0, y + panelH * 0.12, 0),
      state.materials.lampBody,
      root,
      true,
      true
    ));
    meshes.push(box(
      'lamp-top-spine-' + index,
      new BABYLON.Vector3(panelW * 0.96, panelH * 0.22, panelD * 0.28),
      new BABYLON.Vector3(0, y + panelH * 0.64, 0),
      state.materials.lampTrim,
      root,
      true,
      false
    ));
    meshes.push(box(
      'lamp-endcap-left-' + index,
      new BABYLON.Vector3(panelH * 0.56, panelH * 0.98, panelD * 1.18),
      new BABYLON.Vector3(-panelW * 0.58, y + panelH * 0.04, 0),
      state.materials.lampEndCap,
      root,
      true,
      false
    ));
    meshes.push(box(
      'lamp-endcap-right-' + index,
      new BABYLON.Vector3(panelH * 0.56, panelH * 0.98, panelD * 1.18),
      new BABYLON.Vector3(panelW * 0.58, y + panelH * 0.04, 0),
      state.materials.lampEndCap,
      root,
      true,
      false
    ));

    var bulbMat = standard('lamp-diffuser-' + index, { color: palette[state.activeStyle].glow, emissive: palette[state.activeStyle].glow, alpha: 0.78 });
    bulbMat.specularColor = color3('#d9ffff');
    var coreMat = standard('lamp-core-' + index, { color: palette[state.activeStyle].glow, emissive: palette[state.activeStyle].glow, alpha: 1 });
    coreMat.disableLighting = true;
    coreMat.disableDepthWrite = true;
    coreMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
    var haloMat = standard('lamp-halo-' + index, { color: palette[state.activeStyle].glow, emissive: palette[state.activeStyle].glow, alpha: 0.18 });
    haloMat.disableLighting = true;
    haloMat.disableDepthWrite = true;
    haloMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
    var indicatorMat = standard('lamp-indicator-' + index, { color: '#53ffae', emissive: '#53ffae', alpha: 0.95 });
    var pool = createLightPool(index, panelW, panelD, size, root);
    var bulb = BABYLON.MeshBuilder.CreateBox('lamp-bulb-mesh-' + index, {
      width: panelW * 0.88,
      height: panelH * 0.34,
      depth: panelD * 0.72
    }, scene);
    bulb.position = new BABYLON.Vector3(0, y - panelH * 0.34, 0);
    bulb.material = bulbMat;
    bulb.parent = root;
    bulb.metadata = { skipLampHighlight: true };
    meshes.push(addShadow(bulb, false, false));

    var core = BABYLON.MeshBuilder.CreateBox('lamp-core-mesh-' + index, {
      width: panelW * 0.74,
      height: Math.max(0.5, panelH * 0.11),
      depth: panelD * 0.24
    }, scene);
    core.position = new BABYLON.Vector3(0, y - panelH * 0.57, 0);
    core.material = coreMat;
    core.parent = root;
    core.isPickable = false;

    [-1, 1].forEach(function (side) {
      var strip = BABYLON.MeshBuilder.CreateBox('lamp-side-glow-' + index + '-' + side, {
        width: panelW * 0.76,
        height: Math.max(0.42, panelH * 0.08),
        depth: Math.max(0.42, panelH * 0.08)
      }, scene);
      strip.position = new BABYLON.Vector3(0, y - panelH * 0.53, side * panelD * 0.38);
      strip.material = coreMat;
      strip.parent = root;
      strip.isPickable = false;
    });

    createLampFrame(root, index, panelW, panelH, panelD, bulb.position.y, meshes);

    var indicator = BABYLON.MeshBuilder.CreateSphere('lamp-indicator-mesh-' + index, {
      diameter: Math.max(1.25, panelH * 0.28),
      segments: 12
    }, scene);
    indicator.position = new BABYLON.Vector3(panelW * 0.43, y + panelH * 0.13, -panelD * 0.61);
    indicator.material = indicatorMat;
    indicator.parent = root;
    indicator.metadata = { skipLampHighlight: true };
    meshes.push(addShadow(indicator, false, false));

    var halo = BABYLON.MeshBuilder.CreateBox('lamp-halo-mesh-' + index, {
      width: panelW * 1.75,
      height: panelH * 1.4,
      depth: panelD * 1.9
    }, scene);
    halo.position = new BABYLON.Vector3(0, y - panelH * 0.48, 0);
    halo.material = haloMat;
    halo.parent = root;
    halo.isPickable = false;
    halo.checkCollisions = false;

    var point = null;
    if (index < MAX_DYNAMIC_LIGHTS) {
      point = new BABYLON.PointLight('lamp-point-' + index, new BABYLON.Vector3(0, y - size * 0.32, 0), scene);
      point.parent = root;
      point.diffuse = color3(palette[state.activeStyle].glow);
      point.specular = color3(palette[state.activeStyle].glow);
      point.range = 126;
    }

    meshes.forEach(function (mesh) {
      mesh.metadata = mesh.metadata || {};
      mesh.metadata.lightIndex = index;
      mesh.isPickable = true;
      mesh.checkCollisions = false;
    });

    var label = createLabel(index);
    label.parent = root;
    label.position = new BABYLON.Vector3(0, y + 15, 0);

    return {
      light: light,
      root: root,
      meshes: meshes,
      bulb: bulb,
      core: core,
      indicator: indicator,
      halo: halo,
      pool: pool.mesh,
      label: label,
      point: point,
      bulbMat: bulbMat,
      coreMat: coreMat,
      indicatorMat: indicatorMat,
      haloMat: haloMat,
      poolMat: pool.material,
      poolTex: pool.texture
    };
  }

  function createLightPool(index, panelW, panelD, size, root) {
    var tex = new BABYLON.DynamicTexture('lamp-pool-tex-' + index, { width: 256, height: 128 }, scene, false);
    tex.hasAlpha = true;
    var mat = new BABYLON.StandardMaterial('lamp-pool-mat-' + index, scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.alphaMode = BABYLON.Engine.ALPHA_ADD;
    mat.alpha = 0;

    var mesh = BABYLON.MeshBuilder.CreateGround('lamp-light-pool-' + index, {
      width: Math.max(52, panelW * 4.5),
      height: Math.max(38, panelD * 7.2),
      subdivisions: 1
    }, scene);
    mesh.position = new BABYLON.Vector3(0, 2.16 + index * 0.002, 0);
    mesh.material = mat;
    mesh.parent = root;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = false;

    paintLightPool(tex, palette[state.activeStyle].glow, false, size);
    return { mesh: mesh, material: mat, texture: tex };
  }

  function paintLightPool(tex, hex, on, size) {
    var ctx = tex.getContext();
    ctx.clearRect(0, 0, 256, 128);
    if (!on) {
      tex.update();
      return;
    }

    var rgb = hexToRgb(hex);
    function rgba(alpha) {
      return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')';
    }

    var strength = clamp(size / 20, 0.52, 1);
    var outer = ctx.createRadialGradient(128, 64, 12, 128, 64, 120);
    outer.addColorStop(0, rgba(0.22 * strength));
    outer.addColorStop(0.34, rgba(0.15 * strength));
    outer.addColorStop(0.68, rgba(0.055 * strength));
    outer.addColorStop(1, rgba(0));
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.ellipse(128, 64, 116, 54, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    [
      [50, 39, 156, 50, 18, 0.15],
      [65, 45, 126, 38, 14, 0.12],
      [83, 52, 90, 24, 10, 0.11],
      [98, 58, 60, 12, 6, 0.10]
    ].forEach(function (item) {
      ctx.fillStyle = rgba(item[5] * strength);
      roundRect(ctx, item[0], item[1], item[2], item[3], item[4]);
      ctx.fill();
    });
    ctx.strokeStyle = rgba(0.18 * strength);
    ctx.lineWidth = 2;
    roundRect(ctx, 62, 43, 132, 42, 16);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    tex.update();
  }

  function createLampFrame(root, index, panelW, panelH, panelD, y, meshes) {
    var rail = Math.max(0.72, panelH * 0.16);
    var z = panelD * 0.43 + rail * 0.42;
    var x = panelW * 0.46 + rail * 0.42;
    [
      { name: 'front', size: new BABYLON.Vector3(panelW * 0.98, rail, rail), pos: new BABYLON.Vector3(0, y + panelH * 0.02, -z), mat: state.materials.lampFrame },
      { name: 'back', size: new BABYLON.Vector3(panelW * 0.98, rail, rail), pos: new BABYLON.Vector3(0, y + panelH * 0.02, z), mat: state.materials.lampFrame },
      { name: 'left', size: new BABYLON.Vector3(rail, rail, panelD * 0.9), pos: new BABYLON.Vector3(-x, y + panelH * 0.02, 0), mat: state.materials.lampEndCap },
      { name: 'right', size: new BABYLON.Vector3(rail, rail, panelD * 0.9), pos: new BABYLON.Vector3(x, y + panelH * 0.02, 0), mat: state.materials.lampEndCap },
      { name: 'center-rib', size: new BABYLON.Vector3(panelW * 0.68, rail * 0.55, rail * 0.55), pos: new BABYLON.Vector3(0, y - panelH * 0.12, 0), mat: state.materials.lampTrim }
    ].forEach(function (part) {
      var mesh = box('lamp-frame-' + part.name + '-' + index, part.size, part.pos, part.mat, root, true, false);
      mesh.checkCollisions = false;
      meshes.push(mesh);
    });
    [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1]
    ].forEach(function (corner, boltIndex) {
      var bolt = cylinder(
        'lamp-frame-bolt-' + index + '-' + boltIndex,
        { height: Math.max(0.18, rail * 0.24), diameter: rail * 1.08, tessellation: 12 },
        new BABYLON.Vector3(corner[0] * panelW * 0.38, y - panelH * 0.18, corner[1] * panelD * 0.31),
        state.materials.lampTrim,
        root,
        true,
        false
      );
      bolt.checkCollisions = false;
      meshes.push(bolt);
    });
  }

  function createLabel(index) {
    var tex = new BABYLON.DynamicTexture('label-tex-' + index, { width: 420, height: 142 }, scene, false);
    tex.hasAlpha = true;
    var mat = new BABYLON.StandardMaterial('label-mat-' + index, scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.backFaceCulling = false;
    mat.disableLighting = true;

    var plane = BABYLON.MeshBuilder.CreatePlane('label-' + index, { width: 70, height: 23 }, scene);
    plane.material = mat;
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    plane.metadata = { labelTexture: tex };
    return plane;
  }

  function drawLabel(entry, index, on, pending) {
    var tex = entry.label.metadata.labelTexture;
    var ctx = tex.getContext();
    var light = entry.light;
    pending = !!pending;
    var color = pending ? '#ffd36a' : (on ? palette[state.activeStyle].glow : 'rgba(255,255,255,0.18)');
    ctx.clearRect(0, 0, 420, 142);
    ctx.fillStyle = pending ? 'rgba(58,43,14,0.84)' : (on ? 'rgba(12,22,20,0.82)' : 'rgba(16,18,20,0.70)');
    roundRect(ctx, 12, 12, 396, 118, 18);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 33px Microsoft YaHei, sans-serif';
    ctx.fillText(light.name, 28, 60);
    ctx.fillStyle = pending ? '#ffd36a' : (on ? palette[state.activeStyle].glow : '#9aa2aa');
    ctx.font = '700 23px Microsoft YaHei, sans-serif';
    ctx.fillText(light.group + ' / ' + (pending ? '\u786e\u8ba4\u4e2d' : (on ? 'ON' : 'OFF')), 28, 101);
    tex.update();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function updateLightVisual(index) {
    state.status = getRuntimeStatus();
    var entry = state.lightEntries[index];
    var light = state.config.lights[index];
    if (!entry || !light) return;
    var on = isLightOn(light, index);
    var relayStatus = state.status[light.device_ip];
    var connected = !!(relayStatus && relayStatus.connected);
    var pending = connected && typeof isChannelPending === 'function' && isChannelPending(light.device_ip, light.channel);
    var base = on ? (light.group.indexOf('工位') >= 0 ? palette[state.activeStyle].warm : palette[state.activeStyle].glow) : '#3b4248';
    if (pending) base = '#ffd36a';
    entry.bulbMat.emissiveColor = color3(pending ? '#8a5b12' : (on ? base : '#101418'));
    entry.bulbMat.diffuseColor = color3(pending ? '#ffd36a' : (on ? base : (state.activeStyle === 'tech' ? '#54616b' : '#bac5c8')));
    entry.bulbMat.alpha = pending ? 0.74 : (on ? 0.88 : 0.58);
    if (entry.coreMat) {
      entry.coreMat.emissiveColor = color3(pending ? '#a66d19' : (on ? base : '#050607'));
      entry.coreMat.diffuseColor = color3(pending ? '#ffd36a' : (on ? base : '#30373d'));
      entry.coreMat.alpha = pending ? 0.55 : (on ? 1 : 0.16);
    }
    if (entry.indicatorMat) {
      entry.indicatorMat.emissiveColor = color3(pending ? '#ffd36a' : (on ? '#53ffae' : '#090b0d'));
      entry.indicatorMat.diffuseColor = color3(pending ? '#ffd36a' : (on ? '#53ffae' : '#4a535a'));
      entry.indicatorMat.alpha = pending ? 0.9 : (on ? 0.96 : 0.56);
    }
    entry.haloMat.emissiveColor = color3(base);
    entry.haloMat.diffuseColor = color3(base);
    entry.haloMat.alpha = pending ? 0.12 : (on ? 0.20 : 0.0);
    paintLightPool(entry.poolTex, base, pending || on, light.scale * (pending ? 3.7 : 4.5));
    entry.poolMat.alpha = pending ? 0.55 : (on ? 1 : 0);
    entry.pool.isVisible = !!(pending || on);
    if (entry.point) {
      entry.point.diffuse = color3(base);
      entry.point.specular = color3(base);
      entry.point.intensity = pending ? 0.18 : (on ? 0.52 : 0);
    }
    updateSceneLighting();
    drawLabel(entry, index, on, pending);
  }

  function focusLight(index, moveCamera) {
    if (index == null) {
      state.selectedLight = null;
      highlight.removeAllMeshes();
      var popEl = document.getElementById('device-pop');
      if (popEl) popEl.hidden = true;
      return;
    }
    state.selectedLight = index;
    highlight.removeAllMeshes();
    var entry = state.lightEntries[index];
    if (!entry) {
      var emptyPop = document.getElementById('device-pop');
      if (emptyPop) emptyPop.hidden = true;
      return;
    }
    entry.meshes.forEach(function (mesh) {
      if (!mesh.metadata || !mesh.metadata.skipLampHighlight) {
        highlight.addMesh(mesh, color3('#ffd68a'));
      }
    });
    if (moveCamera !== false) {
      orbitCamera.setTarget(entry.root.position.add(new BABYLON.Vector3(0, 25, 0)));
    }
    renderDevicePop(index);
  }

  function renderDevicePop(index) {
    var pop = document.getElementById('device-pop');
    var entry = state.lightEntries[index];
    var light = state.config.lights[index];
    if (!entry || !light) {
      pop.hidden = true;
      return;
    }
    var screen = BABYLON.Vector3.Project(
      entry.root.position.add(new BABYLON.Vector3(0, 56, 0)),
      BABYLON.Matrix.Identity(),
      scene.getTransformMatrix(),
      orbitCamera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
    );
    pop.style.left = clamp(screen.x + 16, 16, engine.getRenderWidth() - 300) + 'px';
    pop.style.top = clamp(screen.y - 38, 84, engine.getRenderHeight() - 170) + 'px';
    pop.innerHTML =
      '<div class="pop-title">' + escapeHtml(light.name) + '</div>' +
      '<div class="pop-meta">' + escapeHtml(light.group) + ' · ' + escapeHtml(light.device_ip) + ' / CH ' + light.channel + '</div>' +
      '<div class="pop-meta">状态: ' + (isLightOn(light, index) ? '已开启' : '关闭') + '</div>' +
      '<div class="pop-actions">' +
        '<button class="btn btn-primary" data-pop="toggle" type="button">切换</button>' +
        '<button class="btn btn-ghost" data-pop="close" type="button">关闭</button>' +
      '</div>';
    pop.querySelector('[data-pop="toggle"]').onclick = function () {
      if (typeof toggleDeviceChannel === 'function') toggleDeviceChannel(light.device_ip, light.channel);
    };
    pop.querySelector('[data-pop="close"]').onclick = function () { pop.hidden = true; };
    pop.hidden = false;
  }

  function findPickedLight(mesh) {
    var node = mesh;
    while (node) {
      if (node.metadata && node.metadata.lightIndex != null) return node.metadata.lightIndex;
      node = node.parent;
    }
    return null;
  }

  scene.onPointerObservable.add(function (pointerInfo) {
    if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERPICK) return;
    var pick = pointerInfo.pickInfo;
    if (!pick || !pick.hit || !pick.pickedMesh) return;
    var index = findPickedLight(pick.pickedMesh);
    if (index == null) return;
    var light = state.config.lights[index];
    if (typeof topView !== 'undefined' && topView === 'control' && light && typeof toggleDeviceChannel === 'function') {
      toggleDeviceChannel(light.device_ip, light.channel);
    } else if (typeof focusLamp === 'function') {
      focusLamp(index);
    } else {
      focusLight(index);
    }
  });

  function updateHud() {
    var source = document.getElementById('hud-source');
    var style = document.getElementById('hud-style');
    if (source) source.textContent = '后端实时配置';
    if (style) style.textContent = '科技夜景';
  }

  function fmtTemp(value) {
    var n = Number(value);
    return Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) + ' °C' : '— °C';
  }

  async function fetchWeatherJson() {
    var urls = ['/api/weather'];
    if (location.port !== '8888') urls.push('http://127.0.0.1:8888/api/weather');
    var lastError = null;
    for (var i = 0; i < urls.length; i++) {
      try {
        var res = await fetch(urls[i], { cache: 'no-store' });
        if (!res.ok) throw new Error('weather ' + res.status);
        return await res.json();
      } catch (error) {
        lastError = error;
      }
    }
    try {
      return await fetchOpenMeteoWeather();
    } catch (error) {
      throw lastError || error || new Error('weather unavailable');
    }
  }

  function getWeatherText(code) {
    var map = {
      0: '晴',
      1: '晴间多云',
      2: '多云',
      3: '阴',
      45: '雾',
      48: '雾凇',
      51: '小毛毛雨',
      53: '毛毛雨',
      55: '大毛毛雨',
      56: '冻雨',
      57: '冻雨',
      61: '小雨',
      63: '中雨',
      65: '大雨',
      66: '冻雨',
      67: '冻雨',
      71: '小雪',
      73: '中雪',
      75: '大雪',
      77: '雪粒',
      80: '阵雨',
      81: '阵雨',
      82: '强阵雨',
      85: '阵雪',
      86: '强阵雪',
      95: '雷雨',
      96: '雷雨伴冰雹',
      99: '雷雨伴冰雹'
    };
    return map[code] || '--';
  }

  async function fetchOpenMeteoWeather() {
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=27.8983&longitude=102.2641&current_weather=true&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FShanghai&forecast_days=1';
    var res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('open-meteo ' + res.status);
    var payload = await res.json();
    var current = payload.current_weather || {};
    var daily = payload.daily || {};
    var highs = daily.temperature_2m_max || [];
    var lows = daily.temperature_2m_min || [];
    var code = current.weathercode == null ? null : Number(current.weathercode);
    return {
      ok: true,
      city: '西昌',
      temperature: current.temperature,
      high: highs.length ? highs[0] : null,
      low: lows.length ? lows[0] : null,
      weather_code: code,
      weather_text: getWeatherText(code)
    };
  }

  async function tickWeather() {
    var next = 600000;
    try {
      var json = await fetchWeatherJson();
      if (!json || !json.ok) throw new Error('weather not ok');
      var main = document.getElementById('hud-temp-main');
      var high = document.getElementById('hud-temp-high');
      var low = document.getElementById('hud-temp-low');
      var text = document.getElementById('hud-weather-text');
      if (main) main.textContent = fmtTemp(json.temperature);
      if (high) high.textContent = fmtTemp(json.high);
      if (low) low.textContent = fmtTemp(json.low);
      if (text) text.textContent = (json.city || '西昌') + ' · ' + (json.weather_text || '--');
    } catch (error) {
      next = 120000;
    } finally {
      setTimeout(tickWeather, next);
    }
  }

  function fitCamera() {
    var b = state.config.layout.building || normalizeBuilding(DEFAULT_BUILDING);
    var bounds = getContentBounds();
    var centerX = bounds ? (bounds.minX + bounds.maxX) / 2 : 0;
    var centerZ = bounds ? (bounds.minZ + bounds.maxZ) / 2 : 0;
    var spanX = bounds ? Math.max(180, bounds.maxX - bounds.minX) : b.width;
    var spanZ = bounds ? Math.max(180, bounds.maxZ - bounds.minZ) : b.depth;
    orbitCamera.setTarget(new BABYLON.Vector3(centerX, 32, centerZ));
    orbitCamera.alpha = DEFAULT_VIEW_ALPHA;
    orbitCamera.beta = DEFAULT_VIEW_BETA;
    orbitCamera.radius = Math.max(spanX, spanZ, b.depth * 0.72) * DEFAULT_VIEW_RADIUS_SCALE;
  }

  function getContentBounds() {
    var xs = [];
    var zs = [];
    state.config.lights.forEach(function (light) {
      xs.push(light.x);
      zs.push(light.z);
    });
    (state.config.layout.workstations || []).forEach(function (item) {
      var x = toNumber(item.x, 0);
      var z = toNumber(item.z, 0);
      var halfW = Math.max(20, toNumber(item.width, 60) / 2);
      var halfD = Math.max(20, toNumber(item.depth, 40) / 2);
      xs.push(x - halfW, x + halfW);
      zs.push(z - halfD, z + halfD);
    });
    var b = state.config.layout.building;
    if (b) {
      xs.push(-b.halfW - 92, -b.halfW + 24);
      zs.push(-110, 110);
    }
    if (!xs.length || !zs.length) return null;
    return {
      minX: Math.min.apply(Math, xs),
      maxX: Math.max.apply(Math, xs),
      minZ: Math.min.apply(Math, zs),
      maxZ: Math.max.apply(Math, zs)
    };
  }

  function setStyle(style) {
    if (style === state.activeStyle) return;
    state.activeStyle = style;
    var p = palette[style];
    scene.clearColor = p.clear;
    scene.fogColor = p.fog;
    scene.fogDensity = style === 'tech' ? 0.00072 : 0.0009;
    hemi.intensity = style === 'tech' ? 0.86 : 0.68;
    keyLight.intensity = style === 'tech' ? 3.05 : 1.65;
    glow.intensity = style === 'tech' ? 0.58 : 0.42;
    if (pipeline) {
      pipeline.bloomWeight = style === 'tech' ? 0.34 : 0.24;
      pipeline.bloomThreshold = style === 'tech' ? 0.62 : 0.76;
    }
    rebuildScene();
    state.config.lights.forEach(function (_, i) { updateLightVisual(i); });
    updateSceneLighting();
    updateHud();
  }

  function toggleWalkMode(forceValue) {
    state.walkMode = typeof forceValue === 'boolean' ? forceValue : !state.walkMode;
    clearOrbitPanKeys();
    if (typeof walkMode !== 'undefined') walkMode = state.walkMode;
    var btn = document.getElementById('hud-walk') || document.getElementById('walk-toggle');
    var label = document.getElementById('walk-label');
    if (state.walkMode) {
      orbitCamera.detachControl(canvas);
      scene.activeCamera = walkCamera;
      walkCamera.attachControl(canvas, true);
      if (btn) btn.classList.add('active');
      if (label) label.textContent = '第一人称: 开';
      canvas.focus();
    } else {
      walkCamera.detachControl(canvas);
      scene.activeCamera = orbitCamera;
      orbitCamera.attachControl(canvas, true);
      if (btn) btn.classList.remove('active');
      if (label) label.textContent = '第一人称: 关';
    }
    var reticle = document.getElementById('walk-reticle');
    if (reticle) reticle.classList.toggle('show', state.walkMode);
  }

  function bindUI() {
    var walkToggle = document.getElementById('hud-walk') || document.getElementById('walk-toggle');
    if (walkToggle) walkToggle.onclick = function () {
      if (typeof window.toggleWalkMode === 'function') window.toggleWalkMode();
      else toggleWalkMode();
    };
  }

  function tickClock() {
    var now = new Date();
    document.getElementById('hud-clock').textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
  }

  engine.runRenderLoop(function () {
    updateOrbitKeyboardPan();
    if (state.selectedLight != null && !document.getElementById('device-pop').hidden) {
      renderDevicePop(state.selectedLight);
    }
    scene.render();
  });

  setInterval(function () {
    document.getElementById('hud-fps').textContent = Math.round(engine.getFps()) + ' FPS';
  }, 500);

  window.addEventListener('resize', resizeScene);

  window.BabylonApp = {
    engine: engine,
    scene: scene,
    rebuildScene: rebuildScene,
    updateLightVisual: updateLightVisual,
    focusLight: focusLight,
    fitCamera: fitCamera,
    toggleWalkMode: toggleWalkMode,
    setStyle: setStyle
  };

  bindUI();
  tickClock();
  setInterval(tickClock, 1000);
  tickWeather();
  buildMaterials();
  rebuildScene();
  resizeScene();
  if (window.requestAnimationFrame) window.requestAnimationFrame(resizeScene);
  setTimeout(resizeScene, 80);
  updateHud();
})();
