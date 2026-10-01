/*
 * ヒーローの演出（three.js）
 * 現像液の中で、白い印画紙に像が浮かび上がる。暗い所から先に現れ、
 * 指やマウスで触れると液面に波紋が広がる。セーフライトの光の中に塵が漂う。
 * WebGL が使えないとき・動きを減らす設定のときは、CSS の背景画像のまま（またはすぐ完成した像）にする。
 */
(function () {
  var script = document.currentScript;
  var hero = document.querySelector('.hero');
  var holder = hero && hero.querySelector('.hero-bg');
  if (!hero || !holder || !window.THREE) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 確認用：URL に #prog=0.3 のように付けると、現像の途中で止めて表示する
  var forced = /prog=([0-9.]+)/.exec(location.hash);
  if (forced) reduceMotion = true;
  var imageURL = (script && script.getAttribute('data-image')) || 'assets/hero.jpg';

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
  } catch (e) {
    return; // WebGL なし：CSS の背景のまま
  }
  if (!renderer.getContext()) return;

  var canvas = renderer.domElement;
  canvas.className = 'hero-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  var scene = new THREE.Scene();
  var camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---- 印画紙（現像される像） ----
  var MAX_RIPPLES = 8;
  var ripples = [];
  for (var i = 0; i < MAX_RIPPLES; i++) ripples.push(new THREE.Vector3(0, 0, -100));

  var uniforms = {
    uTex: { value: null },
    uTime: { value: 0 },
    uProg: { value: forced ? parseFloat(forced[1]) : (reduceMotion ? 1 : 0) },
    uRes: { value: new THREE.Vector2(1, 1) },
    uImgAspect: { value: 1.5 },
    uRip: { value: ripples }
  };

  var paperMaterial = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: [
      'varying vec2 vUv;',
      'void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'uniform sampler2D uTex;',
      'uniform float uTime, uProg, uImgAspect;',
      'uniform vec2 uRes;',
      'uniform vec3 uRip[' + MAX_RIPPLES + '];',
      'varying vec2 vUv;',
      'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
      'float noise(vec2 p) {',
      '  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);',
      '}',
      'void main() {',
      '  vec2 uv = vUv;',
      '  float ca = uRes.x / uRes.y;',
      // background-size: cover と同じ切り取り
      '  vec2 s = ca > uImgAspect ? vec2(1.0, uImgAspect / ca) : vec2(ca / uImgAspect, 1.0);',
      '  vec2 p = (uv - 0.5) * s + 0.5;',
      // 液面のゆらぎ
      '  vec2 w = vec2(noise(uv * 3.0 + uTime * 0.15), noise(uv * 3.0 - uTime * 0.12)) - 0.5;',
      '  p += w * 0.005;',
      // 波紋（中心から広がり、だんだん弱まる）
      '  float shine = 0.0;',
      '  for (int i = 0; i < ' + MAX_RIPPLES + '; i++) {',
      '    vec3 r = uRip[i];',
      '    float age = uTime - r.z;',
      '    if (age < 0.0 || age > 3.5) continue;',
      '    vec2 d = (uv - r.xy) * vec2(ca, 1.0);',
      '    float dist = length(d);',
      '    float front = age * 0.32;',
      '    float ring = exp(-pow((dist - front) * 14.0, 2.0));',
      '    float wave = sin((dist - front) * 70.0) * ring * exp(-age * 1.1);',
      '    p += (d / max(dist, 1e-4)) * wave * 0.008 * vec2(1.0 / ca, 1.0);',
      '    shine += max(wave, 0.0) * 0.12;',
      '  }',
      '  vec3 img = texture2D(uTex, clamp(p, 0.0, 1.0)).rgb;',
      // 濃い（暗い）所ほど先に現れる
      '  float lum = dot(img, vec3(0.299, 0.587, 0.114));',
      '  float n = noise(uv * 9.0) * 0.18;',
      // 写真が全体に暗めなので、明るさを広げてから順に現す（6秒かけて少しずつ）
      '  float lumN = clamp(lum * 2.2, 0.0, 1.0);',
      '  float reveal = smoothstep(0.0, 0.2, uProg * 1.3 - lumN - n + 0.1);',
      // 現像前の印画紙：セーフライトの下で赤っぽく沈んだ白
      '  vec3 paper = vec3(0.62, 0.30, 0.22);',
      '  vec3 col = mix(paper, img, reveal);',
      '  col += shine * vec3(1.0, 0.7, 0.5);',
      // フィルムの粒子
      '  col += (hash(uv * uRes + fract(uTime * 7.0) * 91.0) - 0.5) * 0.045;',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n')
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), paperMaterial));

  // ---- セーフライトの光の中を漂う塵 ----
  var DUST = 140;
  var dustPos = new Float32Array(DUST * 3);
  var dustSeed = new Float32Array(DUST);
  for (var j = 0; j < DUST; j++) {
    dustPos[j * 3] = Math.random() * 2 - 1;
    dustPos[j * 3 + 1] = Math.random() * 2 - 1;
    dustPos[j * 3 + 2] = 0;
    dustSeed[j] = Math.random();
  }
  var dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('seed', new THREE.BufferAttribute(dustSeed, 1));
  var dustMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uScale: { value: renderer.getPixelRatio() } },
    transparent: true,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: [
      'attribute float seed;',
      'uniform float uTime, uScale;',
      'varying float vAlpha;',
      'void main() {',
      '  vec3 p = position;',
      // ゆっくり上へ流れ、左右にゆれる。画面の上に出たら下へ戻る
      '  p.y = mod(p.y + 1.0 + uTime * (0.015 + seed * 0.03), 2.0) - 1.0;',
      '  p.x += sin(uTime * (0.3 + seed) + seed * 40.0) * 0.03;',
      '  vAlpha = (0.25 + 0.75 * seed) * (0.6 + 0.4 * sin(uTime * 1.7 + seed * 20.0));',
      '  gl_Position = vec4(p.xy, 0.0, 1.0);',
      '  gl_PointSize = (1.5 + seed * 3.5) * uScale;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'precision mediump float;',
      'varying float vAlpha;',
      'void main() {',
      '  float d = length(gl_PointCoord - 0.5);',
      '  float a = smoothstep(0.5, 0.0, d) * vAlpha * 0.55;',
      '  gl_FragColor = vec4(vec3(1.0, 0.72, 0.48) * a, a);',
      '}'
    ].join('\n')
  });
  scene.add(new THREE.Points(dustGeo, dustMaterial));

  // ---- 大きさ ----
  function resize() {
    var w = holder.clientWidth || hero.clientWidth;
    var h = holder.clientHeight || hero.clientHeight;
    renderer.setSize(w, h, false);
    uniforms.uRes.value.set(w, h);
    if (!running) renderer.render(scene, camera);
  }

  // ---- 波紋 ----
  var nextRipple = 0;
  function addRipple(x, y) {
    ripples[nextRipple].set(x, y, uniforms.uTime.value);
    nextRipple = (nextRipple + 1) % MAX_RIPPLES;
  }
  var lastMoveRipple = 0;
  function pointerToUV(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height };
  }
  if (!reduceMotion) {
    hero.addEventListener('pointermove', function (e) {
      var t = uniforms.uTime.value;
      if (t - lastMoveRipple < 0.18) return;
      lastMoveRipple = t;
      var p = pointerToUV(e);
      addRipple(p.x, p.y);
    }, { passive: true });
    hero.addEventListener('pointerdown', function (e) {
      var p = pointerToUV(e);
      addRipple(p.x, p.y);
    }, { passive: true });
  }

  // ---- 描画ループ（見えている間だけ動かす） ----
  var running = false;
  var visible = true;
  var start = 0;
  var last = 0;
  var nextDrip = 2.0;
  function frame(now) {
    if (!running) return;
    var t = now / 1000;
    if (!start) start = t;
    var dt = Math.min(0.1, t - (last || t));
    last = t;
    uniforms.uTime.value += dt;
    var el = uniforms.uTime.value;
    // 約6秒かけて現像し、ゆっくり止まる
    var x = Math.min(1, el / 6);
    uniforms.uProg.value = 1 - Math.pow(1 - x, 3);
    // ときどき、しずくが落ちたような波紋
    if (el > nextDrip) {
      addRipple(0.15 + Math.random() * 0.7, 0.2 + Math.random() * 0.6);
      nextDrip = el + 2.5 + Math.random() * 3;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  function setRunning(on) {
    if (reduceMotion) on = false;
    if (on === running) return;
    running = on;
    last = 0;
    if (on) requestAnimationFrame(frame);
  }

  // ---- 画像を読み込んでから差し替える ----
  new THREE.TextureLoader().load(imageURL, function (tex) {
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    uniforms.uTex.value = tex;
    uniforms.uImgAspect.value = tex.image.width / tex.image.height;
    holder.appendChild(canvas);
    holder.classList.add('has-canvas');
    resize();
    renderer.render(scene, camera);
    setRunning(visible && !document.hidden);
  });

  if ('ResizeObserver' in window) {
    new ResizeObserver(resize).observe(holder);
  } else {
    window.addEventListener('resize', resize);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      setRunning(visible && !document.hidden && !!uniforms.uTex.value);
    }).observe(hero);
  }
  document.addEventListener('visibilitychange', function () {
    setRunning(visible && !document.hidden && !!uniforms.uTex.value);
  });
})();

/*
 * スクリーンショットの列：画面に入ると、奥から一枚ずつ起き上がるように並ぶ。
 * 指やマウスを乗せると少し傾く。
 */
(function () {
  var figs = document.querySelectorAll('.shots figure');
  if (!figs.length) return;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || !('IntersectionObserver' in window)) return;

  for (var i = 0; i < figs.length; i++) {
    figs[i].classList.add('tilt-in');
    figs[i].style.transitionDelay = (i * 0.08) + 's';
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.25 });
  for (var j = 0; j < figs.length; j++) io.observe(figs[j]);

  Array.prototype.forEach.call(figs, function (fig) {
    var img = fig.querySelector('img');
    if (!img) return;
    fig.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var r = fig.getBoundingClientRect();
      var dx = (e.clientX - r.left) / r.width - 0.5;
      var dy = (e.clientY - r.top) / r.height - 0.5;
      img.style.transform = 'perspective(900px) rotateY(' + (dx * 14) + 'deg) rotateX(' + (-dy * 10) + 'deg) translateZ(10px)';
    });
    fig.addEventListener('pointerleave', function () { img.style.transform = ''; });
  });
})();
