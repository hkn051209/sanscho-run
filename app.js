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

/* キャラクター（KayKit Adventurers / CC0）。服の色はテクスチャで子ども向けに塗り替え済み */
const CHARS = {
  boy:  { file: "assets/models/boy.glb",  tex: "assets/models/boy_texture.png" },
  girl: { file: "assets/models/girl.glb", tex: "assets/models/girl_texture.png" },
};
// 体のパーツだけ表示（武器・帽子・マントは隠す）
const KEEP_PART = /_(ArmLeft|ArmRight|Body|Head|LegLeft|LegRight)$/;

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

const chars = {};       // key -> { scene, mixer, actions, head, chest, current }
let cur = null;

async function loadChar(key) {
  const def = CHARS[key];
  const [gltf, tex] = await Promise.all([
    new GLTFLoader().loadAsync(def.file),
    new THREE.TextureLoader().loadAsync(def.tex),
  ]);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  const root = gltf.scene;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    o.visible = KEEP_PART.test(o.name);
    if (o.visible) {
      o.material = o.material.clone();
      o.material.map = tex;
    }
  });
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const name of ["Idle", "Running_A", "Hit_A", "Cheer"]) {
    const clip = gltf.animations.find((a) => a.name === name);
    if (clip) actions[name] = mixer.clipAction(clip);
  }
  return {
    scene: root, mixer, actions, current: null, currentName: null,
    head: root.getObjectByName("head"),
    chest: root.getObjectByName("chest"),
  };
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
  if (cur) facing.remove(cur.scene);
  cur = chars[key];
  facing.add(cur.scene);
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
  const bone = slot === "head" ? cur.head : cur.chest;
  if (!bone) return;
  const obj = buildItem(id);
  bone.add(obj);
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
  shake = Math.max(0, shake - dt);
  const sh = shake * 0.3;
  const px = lerp(runnerX * 0.6, runnerX, showcase);
  camera.position.set(
    px + (Math.random() - 0.5) * sh,
    lerp(3.0, 1.9, showcase) + (Math.random() - 0.5) * sh,
    lerp(6.2, 5.2, showcase)
  );
  camera.lookAt(lerp(runnerX * 0.4, runnerX, showcase), lerp(1.4, 1.15, showcase), lerp(-10, 0, showcase));
  // メニュー中はキャラがパネルに隠れないよう画面をずらす（横長→左に、縦長→上に）
  const W = innerWidth, H = innerHeight, portrait = H > W;
  const ox = portrait ? 0 : 0.24 * showcase;
  const oy = portrait ? 0.24 * showcase : 0;
  camera.setViewOffset(W, H, ox * W, oy * H, W, H);

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
  const [boy, girl] = await Promise.all([loadChar("boy"), loadChar("girl")]);
  chars.boy = boy;
  chars.girl = girl;
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
    get correctLane() { return activeRow ? activeRow.correctLane : null; },
    equipAll(list) { for (const id of list) { const it = ITEMS.find((i) => i.id === id); owned.add(it.id); equipped[it.slot] = it.id; } applyEquip(); },
    wardrobe() { showOnly("wardrobe"); renderWardrobe(); },
    forceHit() { if (activeRow) { laneIdx = 1 - activeRow.correctLane; runnerX = LANE_X[laneIdx]; activeRow.z = HIT_Z; } },
  };
  document.title = "ready";
}
