/* Apprentice 3D hand stage. Requires global THREE (r149). Exposes window.Hand3D.mount(canvas, options).
   options: { hands: 'right'|'left'|'both', prop: 'none'|'keyboard'|'racket',
              motion: { kind: 'finger_sequence'|'grip_and_swing'|'hold_pose'|'idle', sequence: [1..5], beat_ms, pose },
              focusFinger: 0..5, showJoints, showTrails, background, onTick(info) } */
(function () {
  'use strict';

  var INK = 0x1a1c26;
  var CHALK = 0xefe9de;
  var GOLD = 0xd9b45a;
  var NAMES = ['thumb', 'index', 'middle', 'ring', 'little'];

  // Right hand, palm down, fingers along -z.
  var FINGERS = [
    { base: [-0.40, -0.02, -0.30], yaw: 0.78, roll: -0.35, lens: [0.30, 0.25, 0.21], rad: [0.105, 0.095, 0.088] },
    { base: [-0.27, 0.00, -1.00], yaw: 0.06, roll: 0, lens: [0.42, 0.26, 0.20], rad: [0.085, 0.080, 0.074] },
    { base: [-0.09, 0.01, -1.04], yaw: 0.0, roll: 0, lens: [0.46, 0.30, 0.22], rad: [0.088, 0.083, 0.076] },
    { base: [0.09, 0.00, -1.00], yaw: -0.05, roll: 0, lens: [0.43, 0.28, 0.21], rad: [0.084, 0.078, 0.072] },
    { base: [0.26, -0.02, -0.91], yaw: -0.12, roll: 0, lens: [0.33, 0.21, 0.18], rad: [0.074, 0.069, 0.064] }
  ];
  // Joint angles (radians) at curl 0 and the extra angle at curl 1, per segment.
  var RELAXED = [[0.10, 0.18, 0.15], [0.28, 0.38, 0.24], [0.28, 0.38, 0.24], [0.28, 0.38, 0.24], [0.30, 0.40, 0.26]];
  var FULL = [[0.75, 0.75, 0.55], [1.15, 1.30, 0.85], [1.15, 1.30, 0.85], [1.15, 1.30, 0.85], [1.15, 1.30, 0.85]];

  function toonGradient() {
    var data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
    var tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  function inflate(geo, amount) {
    var g = geo.clone();
    g.computeVertexNormals();
    var p = g.attributes.position;
    var n = g.attributes.normal;
    for (var i = 0; i < p.count; i++) {
      p.setXYZ(i, p.getX(i) + n.getX(i) * amount, p.getY(i) + n.getY(i) * amount, p.getZ(i) + n.getZ(i) * amount);
    }
    p.needsUpdate = true;
    return g;
  }

  function circlePoints(r, seg) {
    var pts = [];
    for (var i = 0; i <= seg; i++) {
      var a = (i / seg) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
    }
    return pts;
  }

  function blobTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(20,24,40,0.5)');
    g.addColorStop(1, 'rgba(20,24,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  function outlined(parent, geo, mat, lineMat, amount) {
    var m = new THREE.Mesh(geo, mat);
    parent.add(m);
    parent.add(new THREE.Mesh(inflate(geo, amount), lineMat));
    return m;
  }

  function buildHand(gradient, lineMat) {
    var root = new THREE.Group();
    var fill = new THREE.MeshToonMaterial({ color: CHALK, gradientMap: gradient });

    var palmGeo = new THREE.CapsuleGeometry(0.40, 0.46, 6, 18);
    palmGeo.rotateX(Math.PI / 2);
    palmGeo.scale(1.0, 0.36, 1.0);
    palmGeo.translate(0, 0, -0.55);
    outlined(root, palmGeo, fill, lineMat, 0.014);

    var wristGeo = new THREE.CapsuleGeometry(0.27, 0.36, 6, 16);
    wristGeo.rotateX(Math.PI / 2);
    wristGeo.scale(1.15, 0.62, 1);
    wristGeo.translate(0, -0.02, 0.28);
    outlined(root, wristGeo, fill, lineMat, 0.014);

    var fingers = FINGERS.map(function (f) {
      var mat = fill.clone();
      var base = new THREE.Group();
      base.position.set(f.base[0], f.base[1], f.base[2]);
      base.rotation.y = f.yaw;
      base.rotation.z = f.roll;
      root.add(base);
      var joints = [];
      var parent = base;
      f.lens.forEach(function (len, si) {
        var j = new THREE.Group();
        parent.add(j);
        var geo = new THREE.CapsuleGeometry(f.rad[si], Math.max(0.01, len - f.rad[si] * 1.2), 6, 14);
        geo.rotateX(Math.PI / 2);
        geo.translate(0, 0, -len / 2);
        outlined(j, geo, mat, lineMat, 0.014);
        joints.push(j);
        var next = new THREE.Group();
        next.position.z = -len;
        j.add(next);
        parent = next;
      });
      return { joints: joints, tip: parent, mat: mat };
    });
    return { root: root, fingers: fingers };
  }

  function buildRacket(gradient, lineMat) {
    var g = new THREE.Group();
    var wood = new THREE.MeshToonMaterial({ color: 0xc89b62, gradientMap: gradient });
    var red = new THREE.MeshToonMaterial({ color: 0xb2321b, gradientMap: gradient });
    var black = new THREE.MeshToonMaterial({ color: 0x23252e, gradientMap: gradient });
    var handle = new THREE.CylinderGeometry(0.1, 0.11, 0.95, 16);
    handle.rotateZ(Math.PI / 2);
    outlined(g, handle, wood, lineMat, 0.012);
    var faceA = new THREE.CylinderGeometry(0.62, 0.62, 0.03, 40);
    faceA.rotateX(Math.PI / 2);
    faceA.translate(-1.05, 0, 0.02);
    outlined(g, faceA, red, lineMat, 0.012);
    var faceB = new THREE.CylinderGeometry(0.62, 0.62, 0.03, 40);
    faceB.rotateX(Math.PI / 2);
    faceB.translate(-1.05, 0, -0.02);
    g.add(new THREE.Mesh(faceB, black));
    g.position.set(0.02, -0.2, -0.78);
    return g;
  }

  function buildKeyboard(gradient, lineMat, y) {
    var g = new THREE.Group();
    var keys = [];
    var white = new THREE.MeshToonMaterial({ color: 0xf6f3ec, gradientMap: gradient });
    var black = new THREE.MeshToonMaterial({ color: 0x23252e, gradientMap: gradient });
    var n = 11;
    var w = 0.19;
    for (var i = 0; i < n; i++) {
      var mat = white.clone();
      var geo = new THREE.BoxGeometry(w * 0.94, 0.1, 1.15);
      var x = (i - (n - 1) / 2) * w;
      geo.translate(x, y, -1.75);
      outlined(g, geo, mat, lineMat, 0.008);
      keys.push({ x: x, mat: mat });
    }
    [0, 1, 3, 4, 5, 7, 8].forEach(function (i) {
      var geo = new THREE.BoxGeometry(w * 0.55, 0.12, 0.7);
      geo.translate((i - (n - 1) / 2) * w + w / 2, y + 0.07, -1.98);
      g.add(new THREE.Mesh(geo, black));
    });
    return { group: g, keys: keys };
  }

  function sequencePose(t, beat, seq) {
    var step = Math.floor(t / beat);
    var idx = ((step % seq.length) + seq.length) % seq.length;
    var active = seq[idx] - 1;
    var next = seq[(idx + 1) % seq.length] - 1;
    var phase = (t % beat) / beat;
    var press = phase < 0.42 ? Math.sin((phase / 0.42) * Math.PI) : 0;
    var lift = phase > 0.75 ? Math.sin(((phase - 0.75) / 0.25) * Math.PI) * 0.12 : 0;
    var curls = [0, 0, 0, 0, 0];
    for (var i = 0; i < 5; i++) {
      var v = 0;
      if (i === active) v = press * 0.36;
      else if (Math.abs(i - active) === 1) v = press * 0.05;
      if (i === next && i !== active) v -= lift;
      curls[i] = v;
    }
    return { active: active, step: idx, curls: curls, press: press, swing: 0 };
  }

  // Backswing, fast wrist snap through contact, follow-through. Returns yaw offset and grip squeeze.
  function swingPose(t, beat) {
    var phase = (t % beat) / beat;
    var yaw;
    var contact = 0;
    if (phase < 0.55) yaw = 0.55 * Math.sin((phase / 0.55) * Math.PI / 2);
    else if (phase < 0.68) { var k = (phase - 0.55) / 0.13; yaw = 0.55 - 1.25 * k; contact = Math.sin(k * Math.PI); }
    else yaw = -0.7 + 0.7 * ((phase - 0.68) / 0.32);
    var squeeze = 0.06 * contact;
    var c = [0.62 + squeeze, 0.80 + squeeze, 0.84 + squeeze, 0.86 + squeeze, 0.88 + squeeze];
    return { active: -1, step: phase < 0.55 ? 0 : phase < 0.68 ? 1 : 2, curls: c, press: contact, swing: yaw };
  }

  function holdPose(pose) {
    pose = pose || {};
    return { active: -1, step: 0, curls: NAMES.map(function (n) { return pose[n] || 0; }), press: 0, swing: 0 };
  }

  function applyPose(hand, curls, breathe) {
    hand.fingers.forEach(function (f, i) {
      var c = Math.max(-0.2, Math.min(1, curls[i]));
      for (var s = 0; s < 3; s++) {
        var ang = RELAXED[i][s] + FULL[i][s] * c + (i ? breathe : 0);
        if (i === 0) {
          f.joints[s].rotation.x = -ang * 0.8;
          f.joints[s].rotation.y = s === 0 ? -ang * 0.5 : 0;
        } else {
          f.joints[s].rotation.x = -ang;
        }
      }
    });
  }

  function mount(canvas, opts) {
    opts = opts || {};
    var motion = opts.motion || { kind: 'idle' };
    var beat = (motion.beat_ms || (motion.kind === 'grip_and_swing' ? 1500 : 620)) / 1000;
    var seq = motion.sequence && motion.sequence.length ? motion.sequence : [1, 2, 3, 4, 5];
    var two = opts.hands === 'both';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
    var zoom = two ? 1.75 : 1;
    if (opts.prop === 'racket') zoom *= 1.35;
    if (opts.prop === 'keyboard') zoom *= 1.4;
    var camBase = new THREE.Vector3(2.1 * zoom, 2.5 * zoom, 2.7 * zoom);
    var target = new THREE.Vector3(two ? 0 : (opts.prop === 'racket' ? -0.35 : 0), -0.12, opts.prop === 'keyboard' ? -1.25 : -0.62);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7f96, 0.9));
    var key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(-2, 4, 3);
    scene.add(key);

    var gradient = toonGradient();
    var lineMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
    var groundY = -0.55;

    var hands = [];
    var sides = two ? ['left', 'right'] : [opts.hands === 'left' ? 'left' : 'right'];
    sides.forEach(function (side, hi) {
      var rig = new THREE.Group();
      var h = buildHand(gradient, lineMat);
      rig.add(h.root);
      if (side === 'left') h.root.scale.x = -1;
      if (two) rig.position.x = side === 'left' ? -1.25 : 1.25;
      if (opts.prop === 'racket') {
        var r = buildRacket(gradient, lineMat);
        h.root.add(r);
      }
      scene.add(rig);
      hands.push({ rig: rig, hand: h, side: side, offset: two && motion.kind === 'grip_and_swing' ? hi * 0.5 : 0 });
    });

    var keyboard = null;
    if (opts.prop === 'keyboard') {
      keyboard = buildKeyboard(gradient, lineMat, groundY + 0.06);
      scene.add(keyboard.group);
      hands.forEach(function (h) { h.hand.root.position.y = 0.12; });
    }

    var grid = new THREE.GridHelper(9, 36, 0xffffff, 0xffffff);
    grid.material.transparent = true;
    grid.material.opacity = 0.14;
    grid.position.y = groundY;
    scene.add(grid);
    var guide = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
    var circle = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circlePoints(two ? 2.6 : 1.55, 120)), guide);
    circle.rotation.x = -Math.PI / 2;
    circle.position.set(0, groundY + 0.002, -0.5);
    scene.add(circle);
    var shadow = new THREE.Mesh(new THREE.PlaneGeometry(two ? 5 : 2.4, 2.6), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, groundY + 0.004, -0.45);
    scene.add(shadow);

    var ringMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.6 });
    var ringGeo = new THREE.BufferGeometry().setFromPoints(circlePoints(0.12, 40));
    var rings = [];
    var trails = [];
    var TRAIL = 46;
    hands.forEach(function (h) {
      h.hand.fingers.forEach(function (f, fi) {
        f.joints.forEach(function (j) {
          var r = new THREE.LineLoop(ringGeo, ringMat);
          scene.add(r);
          rings.push({ obj: r, joint: j });
        });
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
        var line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
        line.frustumCulled = false;
        scene.add(line);
        trails.push({ line: line, pts: [], finger: f, fi: fi });
      });
    });

    var bg = new THREE.Color(opts.background || '#8fa0b3');
    var gold = new THREE.Color(GOLD);
    var white = new THREE.Color(0xffffff);
    var state = { showJoints: opts.showJoints !== false, showTrails: opts.showTrails !== false, focus: (opts.focusFinger || 0) - 1, yaw: 0 };
    var tmp = new THREE.Vector3();

    function resize() {
      var w = canvas.clientWidth || 1;
      var h = canvas.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    var ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(canvas);
    resize();

    var drag = null;
    function down(e) { drag = { x: e.clientX, yaw: state.yaw }; if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId); }
    function move(e) { if (drag) state.yaw = Math.max(-1.2, Math.min(1.2, drag.yaw + (e.clientX - drag.x) * 0.008)); }
    function up() { drag = null; }
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    function poseAt(t) {
      if (motion.kind === 'finger_sequence') return sequencePose(t, beat, seq);
      if (motion.kind === 'grip_and_swing') return swingPose(t, beat);
      if (motion.kind === 'hold_pose') return holdPose(motion.pose);
      return holdPose({ thumb: 0.05, index: 0.05, middle: 0.05, ring: 0.05, little: 0.05 });
    }

    var start = performance.now();
    var lastTick = 0;
    var raf = 0;
    var speed = reduce ? 0.45 : 1;
    var lastPose = null;

    function frame(now) {
      raf = requestAnimationFrame(frame);
      var t = ((now - start) / 1000) * speed;
      var breathe = Math.sin(t * 1.3) * 0.02;
      hands.forEach(function (h) {
        var pose = poseAt(t + h.offset * beat);
        if (!lastPose) lastPose = pose;
        if (h === hands[hands.length - 1]) lastPose = pose;
        applyPose(h.hand, pose.curls, breathe);
        var mirror = h.side === 'left' ? -1 : 1;
        h.rig.rotation.y += (state.yaw + pose.swing * mirror - h.rig.rotation.y) * (motion.kind === 'grip_and_swing' ? 0.5 : 0.12);
        h.hand.root.rotation.z = motion.kind === 'grip_and_swing' ? pose.swing * 0.35 * mirror : 0;
        if (motion.kind === 'grip_and_swing') h.hand.root.rotation.x = -0.25;
        h.hand.fingers.forEach(function (f, i) { f.mat.color.setHex(i === state.focus || (state.focus < 0 && i === pose.active && motion.kind === 'finger_sequence' && false) ? GOLD : CHALK); });
        h.pose = pose;
      });

      if (keyboard) {
        var p0 = hands[0].pose;
        keyboard.keys.forEach(function (k) { k.mat.color.setHex(0xf6f3ec); });
        if (p0.active >= 0 && p0.press > 0.4) {
          hands[0].hand.fingers[p0.active].tip.getWorldPosition(tmp);
          var best = null;
          keyboard.keys.forEach(function (k) { if (!best || Math.abs(k.x - tmp.x) < Math.abs(best.x - tmp.x)) best = k; });
          if (best) best.mat.color.setHex(GOLD);
        }
      }

      if (!reduce) camera.position.set(camBase.x + Math.sin(t * 0.18) * 0.18 * zoom, camBase.y + Math.sin(t * 0.13) * 0.06, camBase.z);
      else camera.position.copy(camBase);
      camera.lookAt(target);

      rings.forEach(function (r) {
        r.obj.visible = state.showJoints;
        if (!state.showJoints) return;
        r.joint.getWorldPosition(r.obj.position);
        r.obj.quaternion.copy(camera.quaternion);
      });

      trails.forEach(function (tr) {
        tr.line.visible = state.showTrails;
        tr.finger.tip.getWorldPosition(tmp);
        tr.pts.unshift(tmp.clone());
        if (tr.pts.length > TRAIL) tr.pts.pop();
        if (!state.showTrails) return;
        var pos = tr.line.geometry.attributes.position;
        var col = tr.line.geometry.attributes.color;
        var tint = (lastPose && tr.fi === lastPose.active) || tr.fi === state.focus ? gold : white;
        for (var k = 0; k < TRAIL; k++) {
          var p = tr.pts[Math.min(k, tr.pts.length - 1)];
          pos.setXYZ(k, p.x, p.y, p.z);
          var a = 1 - k / TRAIL;
          var c = bg.clone().lerp(tint, a * a);
          col.setXYZ(k, c.r, c.g, c.b);
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
      });

      renderer.render(scene, camera);

      if (opts.onTick && now - lastTick > 100) {
        lastTick = now;
        var w = canvas.clientWidth;
        var hgt = canvas.clientHeight;
        var tips = hands[hands.length - 1].hand.fingers.map(function (f) {
          f.tip.getWorldPosition(tmp);
          tmp.project(camera);
          return { x: (tmp.x * 0.5 + 0.5) * w, y: (-tmp.y * 0.5 + 0.5) * hgt };
        });
        opts.onTick({ t: t, active: lastPose.active, step: lastPose.step, curls: lastPose.curls.slice(), press: lastPose.press, tips: tips });
      }
    }
    raf = requestAnimationFrame(frame);

    return {
      set: function (patch) { Object.keys(patch || {}).forEach(function (k) { state[k] = patch[k]; }); },
      dispose: function () {
        cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        renderer.dispose();
      }
    };
  }

  window.Hand3D = { mount: mount, fingerNames: NAMES.slice() };
})();
