// MineMods Studio bridge for the vendored Blockbench web build.
// The bridge exposes a fixed command vocabulary; it never evaluates message content.
(function () {
  'use strict';
  const channel = 'minemods:blockbench:v1';
  const query = new URLSearchParams(window.location.search);
  const configuredSession = query.get('sessionId');
  const configuredNonce = query.get('nonce');
  const configuredParentOrigin = query.get('parentOrigin') || 'null';
  let sessionId = null;
  let nonce = null;
  let revision = 0;

  const tokenIsSafe = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
  const vector = (value) => Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === 'number' && Number.isFinite(part));
  const activeProject = () => window.Blockbench && window.Blockbench.Project;
  const ready = () => Boolean(window.Blockbench && window.Blockbench.setup_successful && window.Blockbench.Codec && window.BlockbenchCodecs && window.BlockbenchCodecs.project);
  const findGroup = (id) => window.Blockbench.Group.all.find((group) => group.uuid === id || group.name === id);
  const findCube = (id) => window.Blockbench.Cube.all.find((cube) => cube.uuid === id || cube.name === id);
  const findAnimation = (id) => window.Blockbench.Animation.all.find((animation) => animation.uuid === id || animation.name === id);
  const hydrateOutliner = (nodes, groups) => (Array.isArray(nodes) ? nodes : []).map((node) => {
    if (typeof node === 'string') return node;
    const detail = Array.isArray(groups) ? groups.find((group) => group && group.uuid === node.uuid) : null;
    return { ...(detail || {}), ...node, children: hydrateOutliner(node.children, groups) };
  });
  const normalizeAnimators = (animations, groups) => {
    const uuidByName = new Map((Array.isArray(groups) ? groups : []).filter((group) => group && typeof group.name === 'string' && typeof group.uuid === 'string').map((group) => [group.name, group.uuid]));
    return (Array.isArray(animations) ? animations : []).map((animation) => {
      if (!animation || typeof animation !== 'object' || !animation.animators || typeof animation.animators !== 'object') return animation;
      const animators = Object.fromEntries(Object.entries(animation.animators).map(([uuid, animator]) => {
        const name = animator && typeof animator === 'object' && typeof animator.name === 'string' ? animator.name : '';
        return [uuidByName.get(name) || uuid, animator];
      }));
      return { ...animation, animators };
    });
  };
  const snapshot = () => {
    const bbmodel = window.BlockbenchCodecs.project.compile({ raw: true, uuids: true, bitmaps: true });
    if (Array.isArray(bbmodel.groups)) {
      if (Array.isArray(bbmodel.outliner)) bbmodel.outliner = hydrateOutliner(bbmodel.outliner, bbmodel.groups);
      if (Array.isArray(bbmodel.animations)) bbmodel.animations = normalizeAnimators(bbmodel.animations, bbmodel.groups);
    }
    // Electron's structured clone preserves undefined properties, while the
    // archive schema deliberately accepts JSON values only. Blockbench's raw
    // compiler uses undefined for optional fields, so normalize at this
    // persistence boundary without changing any JSON model value.
    const serializable = JSON.parse(JSON.stringify(bbmodel));
    return {
      revision,
      project: {
        uuid: activeProject().uuid,
        name: activeProject().name,
        format: window.Blockbench.Format && window.Blockbench.Format.id,
        mode: activeProject().mode,
        selected: window.Blockbench.Outliner.selected.map((node) => node.uuid),
      },
      bbmodel: serializable,
    };
  };
  const edit = (label, aspects, action) => {
    activeProject().undo.initEdit(aspects || {});
    const result = action();
    activeProject().undo.finishEdit(label);
    revision += 1;
    return result;
  };
  const required = (value, message) => { if (!value) throw new Error(message); return value; };
  const execute = (command) => {
    if (command.op === 'readSnapshot') return snapshot();
    if (command.op === 'open') {
      required(command.model && typeof command.model === 'object', 'Model must be an object');
      window.BlockbenchCodecs.project.load(command.model, { path: '', no_file: true });
      revision += 1;
      return snapshot();
    }
    if (command.op === 'createBone') { edit('Create bone', { outliner: true }, () => {
      const parent = command.parent ? required(findGroup(command.parent), 'Parent bone not found') : 'root';
      return required(new window.Blockbench.Group({ name: command.name, origin: command.pivot, rotation: command.rotation }).addTo(parent).init(), 'Unable to create bone');
    }); return snapshot(); }
    if (command.op === 'createCuboid') { edit('Create cuboid', { outliner: true, elements: [] }, () => {
      const parent = command.bone ? required(findGroup(command.bone), 'Bone not found') : (window.Blockbench.Group.first_selected || 'root');
      return required(new window.Blockbench.Cube({ name: command.name, from: command.from, to: command.to, autouv: 0 }).addTo(parent).init(), 'Unable to create cuboid');
    }); return snapshot(); }
    if (command.op === 'createTexture') { edit('Create texture', { textures: [] }, () => {
      const texture = new window.Blockbench.Texture({ name: command.name, mode: 'bitmap', source: command.dataUrl, width: command.width, height: command.height });
      texture.fromDataURL(command.dataUrl).load().add(false);
      return texture;
    }); return snapshot(); }
    if (command.op === 'editUV') { edit('Edit UV', { elements: [required(findCube(command.cube), 'Cube not found')] }, () => {
      const cube = required(findCube(command.cube), 'Cube not found');
      cube.faces[command.face].uv = command.uv;
      window.Canvas?.updateAllFaces(cube);
    }); return snapshot(); }
    if (command.op === 'transform') { edit('Transform selection', { elements: window.Blockbench.Outliner.selected }, () => {
      const node = required((command.target.kind === 'cube' ? findCube(command.target.id) : findGroup(command.target.id)), 'Transform target not found');
      if (command.target.kind === 'cube' && command.translation) { node.from = node.from.map((value, index) => value + command.translation[index]); node.to = node.to.map((value, index) => value + command.translation[index]); }
      if (command.rotation && node.rotation) node.rotation = command.rotation;
      if (command.scale && command.target.kind === 'cube') node.to = node.from.map((value, index) => value + (node.to[index] - node.from[index]) * command.scale[index]);
      node.update?.();
    }); return snapshot(); }
    if (command.op === 'select') { edit('Select element', { selection: true }, () => {
      window.Blockbench.Outliner.selected.forEach((node) => node.unselect?.());
      if (command.target) required((command.target.kind === 'cube' ? findCube(command.target.id) : findGroup(command.target.id)), 'Selection target not found').select();
    }); return snapshot(); }
    if (command.op === 'setMode') {
      const mode = required(window.Modes && window.Modes.options[command.mode], 'Mode not found');
      mode.select();
      revision += 1;
      return snapshot();
    }
    if (command.op === 'resetCamera') {
      window.Blockbench.Preview.all.forEach((preview) => {
        preview.loadAnglePreset(preview.default_angle);
        preview.resize();
        const bounds = new THREE.Box3();
        [...window.Blockbench.Group.all, ...window.Blockbench.Cube.all].forEach((node) => {
          if (node.mesh) bounds.expandByObject(node.mesh);
        });
        if (!bounds.isEmpty()) {
          const center = bounds.getCenter(new THREE.Vector3());
          const sphere = bounds.getBoundingSphere(new THREE.Sphere());
          const target = preview.controls.target.clone();
          const offset = preview.camera.position.clone().sub(target);
          const direction = offset.lengthSq() > 0 ? offset.normalize() : new THREE.Vector3(0, 0, 1);
          const camera = preview.camera;
          preview.controls.target.copy(center);
          if (camera.isPerspectiveCamera) {
            const verticalFov = THREE.MathUtils.degToRad(camera.fov);
            const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
            const fittingFov = Math.min(verticalFov, horizontalFov);
            const distance = sphere.radius * 1.15 / Math.sin(fittingFov / 2);
            camera.position.copy(center).addScaledVector(direction, distance);
          } else if (camera.isOrthographicCamera) {
            const width = Math.max(sphere.radius * 2, 0.001) * 1.15;
            const height = width;
            const viewWidth = camera.right - camera.left;
            const viewHeight = camera.top - camera.bottom;
            camera.zoom = Math.min(viewWidth / width, viewHeight / height);
            camera.position.copy(center).addScaledVector(direction, camera.position.distanceTo(target));
            camera.updateProjectionMatrix();
          } else {
            camera.position.copy(center).addScaledVector(direction, camera.position.distanceTo(target));
          }
          preview.controls.update();
        }
        preview.render();
      });
      revision += 1;
      return snapshot();
    }
    if (command.op === 'addKeyframe') { edit('Add keyframe', { keyframes: [] }, () => {
      const animation = required(findAnimation(command.animation), 'Animation not found');
      const group = required(findGroup(command.bone), 'Bone not found');
      let animator = animation.animators[group.uuid];
      if (!animator) animator = animation.animators[group.uuid] = new window.Blockbench.BoneAnimator(group.uuid, animation, group.name);
      animator.createKeyframe({ data_points: [{ x: command.rotation[0], y: command.rotation[1], z: command.rotation[2] }] }, command.time, 'rotation', false, false);
    }); return snapshot(); }
    if (command.op === 'undo') { activeProject().undo.undo(); revision += 1; return snapshot(); }
    if (command.op === 'redo') { activeProject().undo.redo(); revision += 1; return snapshot(); }
    if (command.op === 'save') return snapshot();
    if (command.op === 'close') { required(activeProject(), 'No active project').close(true); revision += 1; return snapshot(); }
    if (command.op === 'batch') {
      const before = window.BlockbenchCodecs.project.compile({ raw: true, uuids: true, bitmaps: true });
      const beforeRevision = revision;
      try {
        command.commands.forEach(execute);
        return snapshot();
      } catch (error) {
        window.BlockbenchCodecs.project.load(before, { path: '', no_file: true });
        revision = beforeRevision;
        throw error;
      }
    }
    throw new Error('Unsupported Blockbench command');
  };
  const texturesReady = () => Promise.all(window.Blockbench.Texture.all.map(texture => new Promise((resolve, reject) => {
    if (texture.img.complete && texture.img.naturalWidth > 0) return resolve();
    const finish = (error) => {
      clearTimeout(timer);
      texture.img.removeEventListener('load', loaded);
      texture.img.removeEventListener('error', failed);
      error ? reject(error) : resolve();
    };
    const loaded = () => finish();
    const failed = () => finish(new Error('Model texture failed to load'));
    const timer = setTimeout(() => finish(new Error('Model texture loading timed out')), 8000);
    texture.img.addEventListener('load', loaded, { once: true });
    texture.img.addEventListener('error', failed, { once: true });
  })));
  const executeReady = async (command) => {
    if (command.op === 'batch') {
      const before = snapshot().bbmodel;
      const beforeRevision = revision;
      try {
        for (const operation of command.commands) await executeReady(operation);
        return snapshot();
      } catch (error) {
        execute({ op: 'open', model: before });
        await texturesReady();
        revision = beforeRevision;
        throw error;
      }
    }
    const result = execute(command);
    if (command.op !== 'open' && command.op !== 'createTexture') return result;
    await texturesReady();
    return snapshot();
  };
  let queue = Promise.resolve();
  const respond = (event, request, ok, value, error) => event.source.postMessage({ channel, nonce, sessionId, requestId: request.requestId, kind: 'response', ok, revision, ...(ok ? { snapshot: value } : { error: String(error && error.message || error) }) }, event.origin === 'null' ? '*' : event.origin);
  const announceReady = () => {
    if (!ready() || !configuredSession || !configuredNonce || !tokenIsSafe(configuredSession) || !tokenIsSafe(configuredNonce)) return window.setTimeout(announceReady, 25);
    sessionId = configuredSession;
    nonce = configuredNonce;
    // The host owns persistence and its unsaved-change confirmation. The web
    // app's independent beforeunload prompt would block a committed refresh.
    window.onbeforeunload = null;
    // The embedding app frequently holds focus outside this frame. Native
    // preview ticks must still apply queued geometry and render its camera.
    if (window.settings?.background_rendering) window.settings.background_rendering.value = true;
    if (window.settings?.fps_limit) window.settings.fps_limit.value = 60;
    const dirty = () => window.parent.postMessage({ channel, nonce, sessionId, requestId: 'dirty_' + String(Date.now()), kind: 'event', error: 'document-changed' }, configuredParentOrigin === 'null' ? '*' : configuredParentOrigin);
    window.Blockbench.on('finished_edit', dirty);
    window.Blockbench.on('undo', dirty);
    window.Blockbench.on('redo', dirty);
    window.parent.postMessage({ channel, nonce, sessionId, requestId: 'ready_' + configuredSession, kind: 'ready', revision }, configuredParentOrigin === 'null' ? '*' : configuredParentOrigin);
  };
  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.parent.postMessage({ channel, nonce, sessionId, requestId: 'event_' + String(Date.now()), kind: 'event', error: 'save-request' }, configuredParentOrigin === 'null' ? '*' : configuredParentOrigin);
  }, true);
  window.addEventListener('message', (event) => {
    const request = event.data;
    if (!request || request.channel !== channel || request.kind !== 'request' || event.source !== window.parent) return;
    if (event.origin !== configuredParentOrigin || request.sessionId !== configuredSession || request.nonce !== configuredNonce) return;
    if (!tokenIsSafe(request.sessionId) || !tokenIsSafe(request.nonce)) return;
    sessionId = request.sessionId;
    nonce = request.nonce;
    const wait = () => {
      if (!ready()) return window.setTimeout(wait, 25);
      queue = queue.then(() => executeReady(request.command)).then(value => respond(event, request, true, value), error => respond(event, request, false, null, error));
    };
    wait();
  });
  announceReady();
})();
