import * as THREE from "three";
import { GLTFLoader } from "three/addons/GLTFLoader.js";

/* ============ 設定 ============ */
const LANE_X = [-1.3, 1.3];        // 左・右のレーン
const RUN_SPEED = 9;               // プレイ中の進む速さ
const SPAWN_Z = -45;               // ゲートが現れる距離
const REWARD_EVERY = 10;           // ランダムモードで何問正解でご褒美か
const HIT_TIME = 1.0;              // 不正解で止まる秒数
const DASH_CYCLE = 180;
const HIT_Z = -1.1;               // 扉に当たる位置（キャラの少し手前）

/* キャラクター
   boy : KayKit Adventurers（CC0）。アニメ入り。服の色はテクスチャで塗り替え済み
   girl: 茜（Akane / CC0）。VRChat式の人型骨格。アニメは男の子のものを読み込み時にリターゲットして使う
   fit : ご褒美の小物の取り付け位置（slot ごとに 付ける骨・ずらす量・大きさ）。小物は男の子の頭に合わせて作ってあり、それを各キャラに合わせて縮小・移動する */
const CHARS = {
  boy: {
    type: "kaykit", file: "assets/models/boy.glb", tex: "assets/models/boy_texture.png",
    fit: {
      head: { bone: "head",  offset: [0, 0, 0], scale: 1 },
      neck: { bone: "chest", offset: [0, 0, 0], scale: 1 },
      back: { bone: "chest", offset: [0, 0, 0], scale: 1 },
    },
  },
  girl: {
    type: "humanoid", file: "assets/models/akane-girl.glb", height: 2.2,
    view: { y: 1.75, z: 3.9, look: 1.3 },   // 細身なのでメニューでは少し寄って映す
    armDown: 22,          // 男の子のアニメは腕が開き気味なので、細い体に合わせて腕を下げる（度）
    thighFill: null,  // 太もも入りGLBに差し替えたため筒は無効（もちゃおさんが修正）
    fit: {
      head: { bone: "Head",  offset: [0, -0.17, 0.02], scale: 0.45 },
      neck: { bone: "Chest", offset: [0, 0.2, 0.02], scale: 0.3 },
      back: { bone: "Chest", offset: [0, 0.03, 0.04], scale: 0.5 },
    },
  },
};
const ANIMS = ["Idle", "Running_A", "Hit_A", "Cheer"];
const DEFAULT_VIEW = { y: 1.9, z: 5.2, look: 1.15 };   // メニュー・ご褒美画面でキャラを映すカメラ
// KayKit: 体のパーツだけ表示（武器・帽子・マントは隠す）
const KEEP_PART = /_(ArmLeft|ArmRight|Body|Head|LegLeft|LegRight)$/;
// KayKit の骨 → 人型（VRChat / SiroinoSotai 式）の骨
const RIG_MAP = {
  hips: "Hips", spine: "Spine", chest: "Chest", head: "Head",
  upperarml: "UpperArm_L", lowerarml: "LowerArm_L", handl: "Hand_L",
  upperarmr: "UpperArm_R", lowerarmr: "LowerArm_R", handr: "Hand_R",
  upperlegl: "UpperLeg_L", lowerlegl: "LowerLeg_L", footl: "Foot_L", toesl: "Toe_L",
  upperlegr: "UpperLeg_R", lowerlegr: "LowerLeg_R", footr: "Foot_R", toesr: "Toe_R",
};

/* ご褒美の小物。slot: head=頭の骨 / neck・back=胸の骨 に付く
   増やす時は ITEMS に1行足して、buildItem() に形を足す（またはGLBを読み込む） */
const ITEMS = [
  { id: "ribbon",   name: "リボン",     icon: "🎀", slot: "head" },
  { id: "hat",      name: "麦わら帽子", icon: "👒", slot: "head" },
  { id: "bunny",    name: "うさぎ耳",   icon: "🐰", slot: "head" },
  { id: "cap",      name: "キャップ",   icon: "🧢", slot: "head" },
  { id: "scarf",    name: "マフラー",   icon: "🧣", slot: "neck" },
  { id: "backpack", name: "ランドセル", icon: "🎒", slot: "back" },
];

/* ============ 保存 ============ */
const load = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const owned = new Set(load("sr-owned", []));
const equipped = load("sr-equipped", {});   // slot -> item id
let charKey = load("sr-char", "boy");
if (!CHARS[charKey]) charKey = "boy";

/* ============ 共通 ============ */
const $ = (id) => document.getElementById(id);
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

function disposeObj(o) {
  o.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (c.material.map) c.material.map.dispose();
      c.material.dispose();
    }
  });
}

/* ============ レンダラー・シーン ============ */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fe0ff);
scene.fog = new THREE.Fog(0x9fe0ff, 22, 80);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 3.2, 6.5);

scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.position.set(4, 10, 6);
scene.add(sun);

function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 75 : 60;
  camera.updateProjectionMatrix();
}
addEventListener("resize", onResize);
onResize();

/* ============ 背景（道・草・木・雲） ============ */
const grass = new THREE.Mesh(new THREE.PlaneGeometry(200, 400), mat(0x8fd16b));
grass.rotation.x = -Math.PI / 2;
grass.position.set(0, -0.02, -120);
scene.add(grass);

const road = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 400), mat(0x7b8190));
road.rotation.x = -Math.PI / 2;
road.position.set(0, -0.01, -120);
scene.add(road);

for (const x of [-3.1, 3.1]) {
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 400), mat(0xffffff));
  edge.position.set(x, 0, -120);
  scene.add(edge);
}

const dashes = [];
const dashGeo = new THREE.BoxGeometry(0.12, 0.02, 1.6);
const dashMat = mat(0xffffff);
for (let i = 0; i < 30; i++) {
  const d = new THREE.Mesh(dashGeo, dashMat);
  d.position.set(0, 0.01, -150 + i * 6);
  scene.add(d);
  dashes.push(d);
}

function makeTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6), mat(0x8d5a2b));
  trunk.position.y = 0.6;
  const top = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.4, 8), mat(0x4caf50));
  top.position.y = 2.4;
  g.add(trunk, top);
  return g;
}
function makeCloud() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1 + Math.random() * 0.4, 12, 10), mat(0xffffff));
    s.position.set(i * 1.1 - 1.1, Math.random() * 0.3, 0);
    g.add(s);
  }
  return g;
}
function placeDecor(o) {
  const side = Math.random() < 0.5 ? -1 : 1;
  o.position.x = side * (4.8 + Math.random() * 6);
  o.position.z = -150 + Math.random() * 160;
  o.position.y = 0;
  o.scale.setScalar(0.8 + Math.random() * 0.6);
}
function placeCloud(c, init) {
  c.position.x = (Math.random() - 0.5) * 30;
  c.position.y = 6 + Math.random() * 3;
  c.position.z = init ? -150 + Math.random() * 160 : -150 - Math.random() * 20;
}
const decor = [];
for (let i = 0; i < 18; i++) { const t = makeTree(); placeDecor(t); scene.add(t); decor.push(t); }
const clouds = [];
for (let i = 0; i < 8; i++) { const c = makeCloud(); placeCloud(c, true); scene.add(c); clouds.push(c); }

/* ============ キャラクター ============ */
// runner: 左右移動と傾き / facing: 向き（プレイ中は後ろ姿、メニューでは正面） / その下にモデル
const runner = new THREE.Group();
const facing = new THREE.Group();
runner.add(facing);
scene.add(runner);

const chars = {};       // key -> { wrapper, scene, mixer, actions, anchors, parts, current }
let cur = null;

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v1 = new THREE.Vector3();

/* アニメのリターゲット：元の骨の「休みの姿勢からの回転（ワールド）」を、相手の骨の休みの姿勢に掛けて移す。
   両方とも前向き・Tポーズなので、この単純な方法で合う */
const ARM_SIDE = { UpperArm_L: -1, LowerArm_L: -1, Hand_L: -1, UpperArm_R: 1, LowerArm_R: 1, Hand_R: 1 };
function retargetClips(srcRoot, srcClips, tgtRoot, names, { fps = 30, armDown = 0 } = {}) {
  srcRoot.updateMatrixWorld(true);
  tgtRoot.updateMatrixWorld(true);
  const inv = Object.fromEntries(Object.entries(RIG_MAP).map(([s, d]) => [d, s]));
  const pairs = [];
  tgtRoot.traverse((o) => {
    const s = inv[o.name] && srcRoot.getObjectByName(inv[o.name]);
    if (s) pairs.push({
      s, t: o,
      sRest: s.getWorldQuaternion(new THREE.Quaternion()),
      tRest: o.getWorldQuaternion(new THREE.Quaternion()),
      tLocal: o.quaternion.clone(),
    });
  });
  const sHips = srcRoot.getObjectByName("hips"), tHips = tgtRoot.getObjectByName("Hips");
  const tChest = tgtRoot.getObjectByName("Chest");
  const armQ = { "-1": new THREE.Quaternion(), "1": new THREE.Quaternion() };
  const _z = new THREE.Vector3(0, 0, 1);
  const _q4 = new THREE.Quaternion();
  const sHipRest = sHips.getWorldPosition(new THREE.Vector3());
  const tHipRest = tHips.getWorldPosition(new THREE.Vector3());
  const tHipLocal = tHips.position.clone();
  const ratio = tHipRest.y / sHipRest.y;
  const srcRest = new Map();
  srcRoot.traverse((o) => srcRest.set(o, [o.position.clone(), o.quaternion.clone(), o.scale.clone()]));

  const mixer = new THREE.AnimationMixer(srcRoot);
  const out = {};
  for (const name of names) {
    const clip = srcClips.find((c) => c.name === name);
    if (!clip) continue;
    const act = mixer.clipAction(clip);
    act.play();
    const n = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(n);
    const qv = pairs.map(() => new Float32Array(n * 4));
    const pv = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const time = (clip.duration * i) / (n - 1);
      times[i] = time;
      mixer.setTime(time);
      srcRoot.updateMatrixWorld(true);
      // 腰の上下・左右の揺れ（脚の長さの比で拡大）
      const hp = sHips.getWorldPosition(_v1).sub(sHipRest).multiplyScalar(ratio).add(tHipRest);
      tHips.parent.worldToLocal(hp);
      tHips.position.copy(hp);
      hp.toArray(pv, i * 3);
      tHips.updateMatrixWorld(true);
      pairs.forEach((p, k) => {
        const want = _q2.copy(p.s.getWorldQuaternion(_q1)).multiply(_q3.copy(p.sRest).invert()).multiply(p.tRest);
        const side = ARM_SIDE[p.t.name];
        if (side && armDown) {
          // 胸の向きを基準に、腕全体を下へ回す
          const c = tChest.getWorldQuaternion(_q4);
          const r = _q3.setFromAxisAngle(_z, side * THREE.MathUtils.degToRad(armDown));
          want.premultiply(c.clone().multiply(r).multiply(c.clone().invert()));
        }
        const local = p.t.parent.getWorldQuaternion(_q3).invert().multiply(want);
        if (i > 0) {   // 符号の反転で補間が飛ばないように
          const o = (i - 1) * 4, a = qv[k];
          if (a[o] * local.x + a[o + 1] * local.y + a[o + 2] * local.z + a[o + 3] * local.w < 0) {
            local.set(-local.x, -local.y, -local.z, -local.w);
          }
        }
        p.t.quaternion.copy(local);
        p.t.updateMatrixWorld(true);
        local.toArray(qv[k], i * 4);
      });
    }
    act.stop();
    mixer.uncacheAction(clip);
    const tracks = pairs.map((p, k) => new THREE.QuaternionKeyframeTrack(`${p.t.name}.quaternion`, times, qv[k]));
    tracks.push(new THREE.VectorKeyframeTrack(`${tHips.name}.position`, times, pv));
    out[name] = new THREE.AnimationClip(name, clip.duration, tracks);
  }
  mixer.uncacheRoot(srcRoot);
  // 両方の骨を休みの姿勢に戻す
  srcRest.forEach(([pp, q, s], o) => { o.position.copy(pp); o.quaternion.copy(q); o.scale.copy(s); });
  pairs.forEach((p) => p.t.quaternion.copy(p.tLocal));
  tHips.position.copy(tHipLocal);
  srcRoot.updateMatrixWorld(true);
  tgtRoot.updateMatrixWorld(true);
  return out;
}

/* 小物の取り付け台：骨の子にして、休みの姿勢のときにキャラ全体と同じ向き・ゲーム内の大きさになるよう補正する */
function makeAnchors(root, S, fit) {
  root.updateMatrixWorld(true);
  const anchors = {};
  for (const [slot, f] of Object.entries(fit)) {
    const bone = root.getObjectByName(f.bone);
    if (!bone) continue;
    const bq = bone.getWorldQuaternion(new THREE.Quaternion());
    const iq = bq.clone().invert();
    const a = new THREE.Group();
    a.name = `anchor_${slot}`;
    a.quaternion.copy(iq);
    a.position.set(...f.offset).divideScalar(S).applyQuaternion(iq);
    a.scale.setScalar(f.scale / S);
    bone.add(a);
    anchors[slot] = a;
  }
  return anchors;
}

/* 部品（髪・服など）を名前で表示・非表示できるようにまとめる */
function collectParts(root) {
  const parts = {};
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const p = o.parent;
    const name = p && p !== root && !p.isBone && p.children.every((c) => c.isMesh) ? p.name : o.name;
    (parts[name] ||= []).push(o);
  });
  return parts;
}

function finishChar(def, root, clips, S) {
  const wrapper = new THREE.Group();
  wrapper.scale.setScalar(S);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  wrapper.position.y = -box.min.y * S;     // 足を地面に
  const anchors = makeAnchors(root, S, def.fit);
  wrapper.add(root);
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const name of ANIMS) if (clips[name]) actions[name] = mixer.clipAction(clips[name]);
  const parts = collectParts(root);
  return {
    def, wrapper, scene: root, mixer, actions, anchors, parts, current: null, currentName: null,
    setPart(name, visible) { for (const m of parts[name] || []) m.visible = visible; },
  };
}

async function loadKayKit(def, gltf) {
  const tex = await new THREE.TextureLoader().loadAsync(def.tex);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  const root = gltf.scene;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.visible = KEEP_PART.test(o.name);
    if (o.visible) {
      o.material = o.material.clone();
      o.material.map = tex;
    }
  });
  const clips = {};
  for (const name of ANIMS) clips[name] = gltf.animations.find((a) => a.name === name);
  return finishChar(def, root, clips, 1);
}

function loadHumanoid(def, gltf, animSrc) {
  const root = gltf.scene;
  // アニメ調の塗り（トゥーン）に変える。頂点カラーはVRChat用シェーダー向けのマスクなので使わない
  const grad = new THREE.DataTexture(new Uint8Array([190, 190, 190, 255, 240, 240, 240, 255, 255, 255, 255, 255]), 3, 1);
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.needsUpdate = true;
  const toonCache = new Map();
  const toToon = (m) => {
    if (!toonCache.has(m)) {
      toonCache.set(m, new THREE.MeshToonMaterial({ name: m.name, map: m.map, color: m.color, gradientMap: grad, side: m.side }));
    }
    return toonCache.get(m);
  };
  root.traverse((o) => {
    if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(toToon) : toToon(o.material);
  });
  // 太ももの補い（骨に固定した筒）
  if (def.thighFill != null) {
    const m = new THREE.MeshToonMaterial({ color: def.thighFill, gradientMap: grad });
    for (const side of ["L", "R"]) {
      const up = root.getObjectByName(`UpperLeg_${side}`), low = root.getObjectByName(`LowerLeg_${side}`);
      if (!up || !low) continue;
      const len = low.position.length();
      const g = new THREE.Group();
      g.name = `Fix_thigh_${side}`;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.066, len, 16), m);   // 上(+Y)がひざ側
      tube.position.y = len / 2;
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.066, 16, 10), m);
      g.add(tube, top);
      up.add(g);
    }
  }
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const S = def.height / (box.max.y - box.min.y);
  const clips = retargetClips(animSrc.scene, animSrc.animations, root, ANIMS, { armDown: def.armDown || 0 });
  return finishChar(def, root, clips, S);
}

async function loadAllChars() {
  const loader = new GLTFLoader();
  const [boyG, girlG] = await Promise.all([loader.loadAsync(CHARS.boy.file), loader.loadAsync(CHARS.girl.file)]);
  // リターゲットは男の子のモデルが休みの姿勢のうちに行う
  chars.girl = loadHumanoid(CHARS.girl, girlG, boyG);
  chars.boy = await loadKayKit(CHARS.boy, boyG);
}

function playAnim(name, { once = false, fade = 0.2 } = {}) {
  if (!cur) return;
  const a = cur.actions[name];
  if (!a || (cur.currentName === name && !once)) return;
  a.reset();
  a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  a.clampWhenFinished = once;
  a.play();
  if (cur.current && cur.current !== a) cur.current.crossFadeTo(a, fade, false);
  cur.current = a;
  cur.currentName = name;
}

function setChar(key) {
  if (!chars[key]) return;
  // 小物を外してからモデルを入れ替え
  for (const s of Object.keys(worn)) wear(s, null);
  if (cur) facing.remove(cur.wrapper);
  cur = chars[key];
  facing.add(cur.wrapper);
  charKey = key;
  save("sr-char", key);
  cur.current = null;
  cur.currentName = null;
  playAnim(animForState(), { fade: 0 });
  applyEquip();
  document.querySelectorAll("[data-char]").forEach((b) => b.classList.toggle("on", b.dataset.char === key));
}

/* ---------- 小物（着せ替え） ----------
   座標は骨からの相対位置（前が +Z、上が +Y）。頭の骨は首の付け根あたりにあり、頭のてっぺんは +0.96 くらい */
function buildItem(id) {
  const g = new THREE.Group();
  if (id === "ribbon") {
    const bow = new THREE.Group();
    const wl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), mat(0xff4f9a));
    wl.scale.set(1.3, 0.9, 0.45);
    wl.position.x = -0.2;
    const wr = wl.clone();
    wr.position.x = 0.2;
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat(0xffb3d9));
    bow.add(wl, wr, knot);
    bow.position.set(0.36, 0.92, -0.05);
    bow.rotation.z = -0.45;
    g.add(bow);
  }
  if (id === "hat") {
    const straw = mat(0xf3d27a);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.05, 32), straw);
    brim.position.y = 0.8;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.54, 0.36, 28), straw);
    crown.position.y = 0.98;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.09, 28), mat(0xff5a6e));
    band.position.y = 0.86;
    g.add(brim, crown, band);
  }
  if (id === "bunny") {
    for (const sx of [-0.22, 0.22]) {
      const ear = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4, 10), mat(0xffffff));
      const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.42, 4, 8), mat(0xffb3c9));
      inner.position.z = 0.07;
      ear.add(outer, inner);
      ear.position.set(sx, 1.22, -0.05);
      ear.rotation.z = -sx * 0.6;
      g.add(ear);
    }
  }
  if (id === "cap") {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.64, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      mat(0x2f6fe0)
    );
    dome.scale.y = 0.75;
    dome.position.y = 0.7;
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 24, 1, false, -Math.PI / 2, Math.PI), mat(0xffc93c));
    visor.position.set(0, 0.72, 0.42);
    visor.scale.set(1, 1, 1.1);
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat(0xffc93c));
    button.position.y = 1.15;
    g.add(dome, visor, button);
  }
  if (id === "scarf") {
    const red = mat(0xe53935);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 10, 28), red);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.12;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.09), red);
    tail.position.set(0.16, -0.12, -0.46);
    tail.rotation.x = 0.25;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.07, 0.1), mat(0xffffff));
    stripe.position.set(0.16, -0.3, -0.5);
    stripe.rotation.x = 0.25;
    g.add(ring, tail, stripe);
  }
  if (id === "backpack") {
    // ランドセル（赤）
    const red = mat(0xd8263a);
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.68, 0.32), red);
    bag.position.set(0, -0.06, -0.56);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.56, 0.05), mat(0xb81d30));
    flap.position.set(0, 0.02, -0.74);
    const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.04), mat(0xffd166));
    clasp.position.set(0, -0.24, -0.77);
    g.add(bag, flap, clasp);
  }
  return g;
}

const worn = {};  // slot -> Object3D
function wear(slot, id) {
  if (worn[slot]) {
    worn[slot].parent?.remove(worn[slot]);
    disposeObj(worn[slot]);
    delete worn[slot];
  }
  if (!id || !cur) return;
  const anchor = cur.anchors[slot];
  if (!anchor) return;
  const obj = buildItem(id);
  anchor.add(obj);
  worn[slot] = obj;
}
function applyEquip() {
  for (const s of ["head", "neck", "back"]) wear(s, equipped[s] ?? null);
}

/* ============ 状態 ============ */
let state = "loading";     // loading | menu | play | hit | reward
let mode = "rand";         // dan | rand | add
let danNo = 1, danIndex = 1;
let rndCount = 0, correctCount = 0;
let pendingReward = false, rewardRow = null;
let curQ = null;
let rows = [], activeRow = null, wrongRow = null;
let laneIdx = 0, runnerX = LANE_X[0];
let hitT = 0, shake = 0;
const particles = [];

function animForState() {
  if (state === "play") return "Running_A";
  if (state === "hit") return "Hit_A";
  if (state === "reward") return "Cheer";
  return "Idle";
}

/* ============ 出題 ============ */
function makeQuestion() {
  if (mode === "dan") return { a: danNo, b: danIndex, op: "×", ans: danNo * danIndex };
  if (mode === "rand") {
    const a = randInt(1, 9), b = randInt(1, 9);
    return { a, b, op: "×", ans: a * b };
  }
  if (Math.random() < 0.5) {
    const a = randInt(0, 20), b = randInt(0, 20 - a);
    return { a, b, op: "+", ans: a + b };
  }
  const a = randInt(0, 20), b = randInt(0, a);
  return { a, b, op: "−", ans: a - b };
}
function advance() {
  if (mode === "dan") {
    danIndex++;
    if (danIndex > 9) { danIndex = 1; toast("だんクリア！ すごい！", 1400); }
  }
  curQ = makeQuestion();
}
function pickWrong(ans) {
  const offs = [1, -1, 10, -10, 2, -2, 9, -9].sort(() => Math.random() - 0.5);
  for (const o of offs) {
    const v = ans + o;
    if (v >= 0 && v !== ans) return v;
  }
  return ans + 3;
}

/* ============ ゲート（扉） ============ */
function doorTexture(text) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 400;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 400);
  g.addColorStop(0, "#fff4c2");
  g.addColorStop(1, "#ffd27a");
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 400);
  x.strokeStyle = "#a86b1e";
  x.lineWidth = 14;
  x.strokeRect(7, 7, 242, 386);
  x.fillStyle = "#3b2a1a";
  x.font = 'bold 150px "Hiragino Maru Gothic ProN","Rounded Mplus 1c",sans-serif';
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(String(text), 128, 205);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeDoor(answer) {
  const g = new THREE.Group();
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 2.6),
    new THREE.MeshBasicMaterial({ map: doorTexture(answer), side: THREE.DoubleSide })
  );
  panel.position.set(0, 1.4, 0.02);
  const frameMat = mat(0xd9a066);
  const postL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.9, 0.18), frameMat);
  postL.position.set(-0.92, 1.45, 0);
  const postR = postL.clone();
  postR.position.x = 0.92;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.2, 0.18), frameMat);
  beam.position.set(0, 2.9, 0);
  g.add(panel, postL, postR, beam);
  return g;
}
function makeRow(q) {
  const group = new THREE.Group();
  const correctLane = Math.random() < 0.5 ? 0 : 1;
  const answers = [];
  answers[correctLane] = q.ans;
  answers[1 - correctLane] = pickWrong(q.ans);
  for (let i = 0; i < 2; i++) {
    const door = makeDoor(answers[i]);
    door.position.x = LANE_X[i];
    group.add(door);
  }
  group.position.z = SPAWN_Z;
  scene.add(group);
  return { group, z: SPAWN_Z, correctLane, decided: false };
}
function removeRow(r) {
  scene.remove(r.group);
  disposeObj(r.group);
}
function clearRows() {
  for (const r of rows) removeRow(r);
  rows = [];
  activeRow = null;
  wrongRow = null;
}
function spawnRow() {
  const row = makeRow(curQ);
  rows.push(row);
  activeRow = row;
  updateHUD();
}

/* ============ 判定 ============ */
function decide(row) {
  row.decided = true;
  activeRow = null;
  const lane = runnerX < 0 ? 0 : 1;
  if (lane === row.correctLane) {
    correctCount++;
    sparkle();
    toast("せいかい！ ✨", 700);
    if (mode === "rand") {
      rndCount++;
      if (rndCount >= REWARD_EVERY) {
        rndCount = 0;
        pendingReward = true;
        rewardRow = row;
      }
    }
    advance();
    spawnRow();
  } else {
    wrongRow = row;
    row.z = HIT_Z - 0.6;            // ぶつかって少し押し戻される
    row.group.position.z = row.z;
    state = "hit";
    hitT = HIT_TIME;
    shake = 0.35;
    playAnim("Hit_A", { once: true, fade: 0.1 });
    toast("おしい！ もういちど", 900);
  }
}

/* ============ ご褒美 ============ */
function showReward() {
  state = "reward";
  playAnim("Cheer");
  const pool = ITEMS.filter((i) => !owned.has(i.id));
  let icon = "🌟", text;
  if (pool.length === 0) {
    text = "ぜんぶ そろったよ！ すごい！";
  } else {
    const it = pool[randInt(0, pool.length - 1)];
    owned.add(it.id);
    save("sr-owned", [...owned]);
    equipped[it.slot] = it.id;
    save("sr-equipped", equipped);
    applyEquip();
    icon = it.icon;
    text = `ごほうび！「${it.name}」をもらったよ！\nきがえで つけかえられるよ`;
  }
  $("rewardIcon").textContent = icon;
  $("rewardText").textContent = text;
  $("rewardOverlay").classList.remove("hidden");
  $("ui").classList.add("hidden");
}
$("btnRewardOk").onclick = () => {
  $("rewardOverlay").classList.add("hidden");
  $("ui").classList.remove("hidden");
  state = "play";
  playAnim("Running_A");
};

/* ============ エフェクト ============ */
const pGeo = new THREE.OctahedronGeometry(0.08);
function sparkle() {
  const colors = [0xffe066, 0xff7eb6, 0x7ee0ff];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color: colors[i % 3] }));
    m.position.set(runnerX, 2.0, 0);
    scene.add(m);
    particles.push({
      m,
      v: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5 + 2, (Math.random() - 0.5) * 4),
      life: 0.8,
    });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.v.y -= 12 * dt;
    p.m.position.addScaledVector(p.v, dt);
    if (p.life <= 0) {
      scene.remove(p.m);
      p.m.material.dispose();
      particles.splice(i, 1);
    }
  }
}

/* ============ HUD・トースト ============ */
function updateHUD() {
  $("question").textContent = `${curQ.a} ${curQ.op} ${curQ.b} = ?`;
  let p;
  if (mode === "dan") p = `${danNo}のだん　${danIndex}/9 もんめ`;
  else if (mode === "rand") p = `ごほうびまで あと ${REWARD_EVERY - rndCount} もん`;
  else p = `せいかい ${correctCount} もん`;
  $("progress").textContent = p;
}
let toastTimer;
function toast(msg, ms = 1100) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

/* ============ BGM ============ */
const bgm = new Audio("assets/bgm.mp3");
bgm.loop = true;
bgm.volume = 0.45;
let bgmOn = load("sr-bgm", true);
function applyBgm() {
  $("btnBgm").textContent = bgmOn ? "♪ オン" : "♪ オフ";
  if (bgmOn) bgm.play().catch(() => {});
  else bgm.pause();
}
$("btnBgm").onclick = () => {
  bgmOn = !bgmOn;
  save("sr-bgm", bgmOn);
  applyBgm();
};

/* ============ メニュー・画面遷移 ============ */
function showOnly(id) {
  for (const p of ["mainMenu", "danMenu", "wardrobe"]) $(p).classList.toggle("hidden", p !== id);
}
function showMenu() {
  state = "menu";
  clearRows();
  pendingReward = false;
  rewardRow = null;
  $("rewardOverlay").classList.add("hidden");
  showOnly("mainMenu");
  $("menu").classList.remove("hidden");
  $("ui").classList.add("hidden");
  playAnim("Idle");
}
function startMode(m, n) {
  mode = m;
  danNo = n || 1;
  danIndex = 1;
  rndCount = 0;
  correctCount = 0;
  pendingReward = false;
  rewardRow = null;
  clearRows();
  curQ = makeQuestion();
  $("menu").classList.add("hidden");
  $("ui").classList.remove("hidden");
  state = "play";
  laneIdx = 0;
  playAnim("Running_A");
  spawnRow();
  applyBgm();
}
function renderWardrobe() {
  const list = $("wardrobeList");
  list.innerHTML = "";
  for (const it of ITEMS) {
    const has = owned.has(it.id);
    const on = equipped[it.slot] === it.id;
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<span class="icon">${has ? it.icon : "❔"}</span><span class="name">${has ? it.name : "？？？"}</span>`;
    const b = document.createElement("button");
    b.className = "small";
    b.textContent = !has ? "まだ" : on ? "はずす" : "つける";
    b.disabled = !has;
    b.onclick = () => {
      equipped[it.slot] = on ? null : it.id;
      save("sr-equipped", equipped);
      applyEquip();
      renderWardrobe();
    };
    row.append(b);
    list.append(row);
  }
}

// メニューのボタン
document.querySelectorAll("[data-start]").forEach((b) => {
  b.onclick = () => {
    const k = b.dataset.start;
    if (k === "dan") showOnly("danMenu");
    else startMode(k);
  };
});
document.querySelectorAll("[data-char]").forEach((b) => {
  b.onclick = () => setChar(b.dataset.char);
});
const danGrid = $("danGrid");
for (let n = 1; n <= 9; n++) {
  const b = document.createElement("button");
  b.className = "big";
  b.textContent = `${n}のだん`;
  b.onclick = () => startMode("dan", n);
  danGrid.append(b);
}
$("btnDanBack").onclick = () => showOnly("mainMenu");
$("btnWardrobe").onclick = () => { showOnly("wardrobe"); renderWardrobe(); };
$("btnWardrobeBack").onclick = () => showOnly("mainMenu");
$("btnMenu").onclick = showMenu;

/* ============ 入力（レーン移動） ============ */
function setLane(i) {
  if (state !== "play") return;
  laneIdx = i;
}
$("btnL").onclick = () => setLane(0);
$("btnR").onclick = () => setLane(1);
renderer.domElement.addEventListener("pointerdown", (e) => {
  setLane(e.clientX < innerWidth / 2 ? 0 : 1);
});
addEventListener("keydown", (e) => {
  if (e.code === "ArrowLeft" || e.code === "KeyA") setLane(0);
  if (e.code === "ArrowRight" || e.code === "KeyD") setLane(1);
});

/* ============ 更新 ============ */
let faceAngle = 0;      // 0=正面（カメラ向き） / PI=後ろ姿
let showcase = 1;       // 1=メニュー用カメラ / 0=プレイ用カメラ
function update(dt) {
  const running = state === "play";
  const speedNow = running ? RUN_SPEED : 0;
  const showFront = state === "menu" || state === "loading" || state === "reward";

  if (cur) cur.mixer.update(dt);

  // 向き：プレイ中は後ろ姿、メニューとご褒美では正面
  faceAngle = damp(faceAngle, showFront ? 0 : Math.PI, 8, dt);
  facing.rotation.y = faceAngle;

  // 横移動・傾き
  if (state === "menu") laneIdx = runnerX < 0 ? 0 : 1;
  const targetX = showFront && state !== "reward" ? 0 : LANE_X[laneIdx];
  runnerX = damp(runnerX, targetX, 12, dt);
  runner.position.x = runnerX;
  runner.rotation.z = running ? -(LANE_X[laneIdx] - runnerX) * 0.2 : 0;

  // 背景
  for (const d of dashes) {
    d.position.z += speedNow * dt;
    if (d.position.z > 8) d.position.z -= DASH_CYCLE;
  }
  for (const o of decor) {
    o.position.z += speedNow * dt;
    if (o.position.z > 9) placeDecor(o);
  }
  for (const c of clouds) {
    c.position.z += (speedNow * 0.4 + 0.4) * dt;
    if (c.position.z > 12) placeCloud(c, false);
  }

  // ゲート移動
  for (const r of rows) {
    r.z += speedNow * dt;
    r.group.position.z = r.z;
  }
  rows = rows.filter((r) => {
    if (r.z > 8) { removeRow(r); return false; }
    return true;
  });

  // ゲート到達 → 判定
  if (state === "play" && activeRow && activeRow.z >= HIT_Z) decide(activeRow);

  // 不正解で止まった後、同じ問題をもう一度
  if (state === "hit") {
    hitT -= dt;
    if (hitT <= 0) {
      removeRow(wrongRow);
      rows = rows.filter((r) => r !== wrongRow);
      wrongRow = null;
      state = "play";
      playAnim("Running_A");
      spawnRow();
    }
  }

  // ご褒美（正解の扉を通り抜けたら表示）
  if (pendingReward && rewardRow && rewardRow.z > 2) {
    pendingReward = false;
    rewardRow = null;
    showReward();
  }

  // カメラ：プレイ中は後ろから追いかける / メニューでは近くからキャラを見せる
  showcase = damp(showcase, showFront ? 1 : 0, 5, dt);
  const view = (cur && cur.def.view) || DEFAULT_VIEW;
  shake = Math.max(0, shake - dt);
  const sh = shake * 0.3;
  const px = lerp(runnerX * 0.6, runnerX, showcase);
  camera.position.set(
    px + (Math.random() - 0.5) * sh,
    lerp(3.0, view.y, showcase) + (Math.random() - 0.5) * sh,
    lerp(6.2, view.z, showcase)
  );
  camera.lookAt(lerp(runnerX * 0.4, runnerX, showcase), lerp(1.4, view.look, showcase), lerp(-10, 0, showcase));
  // メニュー中はキャラがパネルに隠れないよう画面をずらす（横長→左に、縦長→上に）
  const W = innerWidth, H = innerHeight, portrait = H > W;
  const ox = portrait ? 0 : 0.24 * showcase;
  const oy = portrait ? 0.24 * showcase : 0;
  camera.setViewOffset(W, H, ox * W, oy * H, W, H);
  if (window.G && window.G.cam) {   // 動作確認用のカメラ
    camera.clearViewOffset();
    camera.position.set(...window.G.cam.p);
    camera.lookAt(...window.G.cam.l);
  }

  updateParticles(dt);
}

const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

/* ============ 起動 ============ */
tick();
try {
  await loadAllChars();
  setChar(charKey);
  $("loading").classList.add("hidden");
  showMenu();
  applyBgm();
} catch (e) {
  console.error(e);
  $("loading").textContent = "よみこみに しっぱいしました\nページを ひらきなおしてね";
}

// 動作確認用（URLに ?debug を付けた時だけ）
if (location.search.includes("debug")) {
  window.G = {
    startMode, setChar, showMenu, showReward,
    get state() { return state; },
    get cur() { return cur; }, chars, THREE,
    get correctLane() { return activeRow ? activeRow.correctLane : null; },
    equipAll(list) { for (const id of list) { const it = ITEMS.find((i) => i.id === id); owned.add(it.id); equipped[it.slot] = it.id; } applyEquip(); },
    wardrobe() { showOnly("wardrobe"); renderWardrobe(); },
    forceHit() { if (activeRow) { laneIdx = 1 - activeRow.correctLane; runnerX = LANE_X[laneIdx]; activeRow.z = HIT_Z; } },
  };
  document.title = "ready";
}
