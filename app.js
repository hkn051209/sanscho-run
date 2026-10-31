import * as THREE from "three";

/* ============ 設定 ============ */
const LANE_X = [-1.3, 1.3];        // 左・右のレーン
const RUN_SPEED = 9;               // プレイ中の進む速さ
const MENU_SPEED = 2.5;            // メニュー中の背景の流れ
const SPAWN_Z = -45;               // ゲートが現れる距離
const REWARD_EVERY = 10;           // ランダムモードで何問正解でご褒美か
const DASH_CYCLE = 180;

const ITEMS = [
  { id: "ribbon",   name: "リボン",     icon: "🎀", slot: "head" },
  { id: "hat",      name: "麦わら帽子", icon: "👒", slot: "head" },
  { id: "bunny",    name: "うさぎ耳",   icon: "🐰", slot: "head" },
  { id: "scarf",    name: "マフラー",   icon: "🧣", slot: "neck" },
  { id: "backpack", name: "リュック",   icon: "🎒", slot: "back" },
];

/* ============ 保存 ============ */
const load = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const owned = new Set(load("sr-owned", []));
const equipped = load("sr-equipped", {});   // slot -> item id

/* ============ 共通 ============ */
const $ = (id) => document.getElementById(id);
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
const lerp = (a, b, t) => a + (b - a) * t;

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

scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(4, 10, 6);
scene.add(sun);

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 80 : 60;
  camera.updateProjectionMatrix();
});

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

/* ============ 走る子ども（プレースホルダーの人型） ============
   Mixamoのモデルを使う時は、このrunner部分をGLTFLoaderで読み込んだモデルに
   差し替え、走りアニメーションをAnimationMixerで再生すればOK。 */
const skin = 0xffd2a8, shirt = 0xff7a59, pants = 0x4a6fd8, shoeC = 0x6b4a3a, hairC = 0x4a2c1d;
const runner = new THREE.Group();
scene.add(runner);

const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 6, 12), mat(shirt));
body.position.y = 1.35;
runner.add(body);

const headG = new THREE.Group();
headG.position.y = 2.05;
runner.add(headG);
headG.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 24, 18), mat(skin)));
const hairMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
  mat(hairC)
);
hairMesh.position.y = 0.02;
headG.add(hairMesh);

function limb(x, y, color, len, r, withShoe) {
  const p = new THREE.Group();
  p.position.set(x, y, 0);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat(color));
  m.position.y = -(len / 2 + r);
  p.add(m);
  if (withShoe) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.36), mat(shoeC));
    s.position.set(0, -(len + 2 * r) - 0.02, 0.08);
    p.add(s);
  }
  runner.add(p);
  return p;
}
const armL = limb(-0.36, 1.7, shirt, 0.4, 0.1, false);
const armR = limb(0.36, 1.7, shirt, 0.4, 0.1, false);
const legL = limb(-0.16, 0.95, pants, 0.45, 0.13, true);
const legR = limb(0.16, 0.95, pants, 0.45, 0.13, true);

/* ---------- 小物（着せ替え） ---------- */
function buildItem(id) {
  const g = new THREE.Group();
  if (id === "ribbon") {
    const bow = new THREE.Group();
    const wl = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), mat(0xff4f9a));
    wl.scale.set(1.3, 0.9, 0.4);
    wl.position.x = -0.16;
    const wr = wl.clone();
    wr.position.x = 0.16;
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat(0xffb3d9));
    bow.add(wl, wr, knot);
    bow.position.set(0.3, 0.36, -0.05);
    bow.rotation.z = -0.4;
    g.add(bow);
  }
  if (id === "hat") {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.05, 28), mat(0xf3d27a));
    brim.position.y = 0.3;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.3, 24), mat(0xf3d27a));
    crown.position.y = 0.46;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.07, 24), mat(0xff5a6e));
    band.position.y = 0.36;
    g.add(brim, crown, band);
  }
  if (id === "bunny") {
    for (const sx of [-0.16, 0.16]) {
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.5, 4, 8), mat(0xffffff));
      ear.position.set(sx, 0.78, 0);
      ear.rotation.z = -sx * 0.35;
      const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.42, 4, 8), mat(0xffb3c9));
      inner.position.set(sx, 0.78, 0.05);
      inner.rotation.z = -sx * 0.35;
      g.add(ear, inner);
    }
  }
  if (id === "scarf") {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.1, 10, 28), mat(0xe53935));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.7;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.08), mat(0xe53935));
    tail.position.set(0.12, 1.45, -0.32);
    tail.rotation.x = 0.2;
    g.add(ring, tail);
  }
  if (id === "backpack") {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.3), mat(0x3d7fe0));
    bag.position.set(0, 1.35, -0.42);
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.06), mat(0xffd166));
    pocket.position.set(0, 1.2, -0.6);
    g.add(bag, pocket);
  }
  return g;
}

const worn = {};  // slot -> Object3D
function wear(slot, id) {
  if (worn[slot]) {
    worn[slot].parent.remove(worn[slot]);
    disposeObj(worn[slot]);
    delete worn[slot];
  }
  if (!id) return;
  const obj = buildItem(id);
  (slot === "head" ? headG : runner).add(obj);
  worn[slot] = obj;
}
function applyEquip() {
  for (const s of ["head", "neck", "back"]) wear(s, equipped[s] ?? null);
}

/* ============ 状態 ============ */
let state = "menu";        // menu | play | hit | reward
let mode = "rand";         // dan | rand | add
let danNo = 1, danIndex = 1;
let rndCount = 0, correctCount = 0;
let pendingReward = false, rewardRow = null;
let curQ = null;
let rows = [], activeRow = null, wrongRow = null;
let laneIdx = 0, runnerX = LANE_X[0];
let hitT = 0, shake = 0, phase = 0, ampCur = 0;
const particles = [];

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
    state = "hit";
    hitT = 1.0;
    shake = 0.35;
    toast("おしい！ もういちど", 900);
  }
}

/* ============ ご褒美 ============ */
function showReward() {
  state = "reward";
  const pool = ITEMS.filter((i) => !owned.has(i.id));
  let icon = "🌟", text;
  if (pool.length === 0) {
    text = "ぜんぶのこうもくを もってるよ！ すごい！";
  } else {
    const it = pool[randInt(0, pool.length - 1)];
    owned.add(it.id);
    save("sr-owned", [...owned]);
    equipped[it.slot] = it.id;
    save("sr-equipped", equipped);
    applyEquip();
    icon = it.icon;
    text = `ごほうび！「${it.name}」をもらったよ！\nきがえで つけてみよう`;
  }
  $("rewardIcon").textContent = icon;
  $("rewardText").textContent = text;
  $("rewardOverlay").classList.remove("hidden");
}
$("btnRewardOk").onclick = () => {
  $("rewardOverlay").classList.add("hidden");
  state = "play";
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
    b.textContent = !has ? "まだ" : on ? "はずす" : "きる";
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
let runnerRot = 0;
function update(dt) {
  const speedNow = state === "play" ? RUN_SPEED : state === "menu" ? MENU_SPEED : 0;

  // 走りアニメ（2つの足・腕の振り）
  const runSpd = state === "play" ? 12 : state === "menu" ? 4 : 0;
  phase += dt * runSpd;
  ampCur = lerp(ampCur, runSpd > 0 ? 1 : 0, Math.min(1, dt * 8));
  const s = Math.sin(phase);
  armL.rotation.x = s * 0.9 * ampCur;
  armR.rotation.x = -s * 0.9 * ampCur;
  legL.rotation.x = -s * 0.8 * ampCur;
  legR.rotation.x = s * 0.8 * ampCur;
  body.position.y = 1.35 + Math.abs(Math.cos(phase)) * 0.06 * ampCur;

  // 横移動・傾き
  runnerX = lerp(runnerX, LANE_X[laneIdx], Math.min(1, dt * 12));
  runner.position.x = runnerX;
  const targetRot = state === "hit" ? -0.35 : -0.08 * ampCur;
  runnerRot = lerp(runnerRot, targetRot, Math.min(1, dt * 8));
  runner.rotation.x = runnerRot;
  runner.rotation.z = -(LANE_X[laneIdx] - runnerX) * 0.25;

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
    c.position.z += speedNow * 0.4 * dt;
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
  if (state === "play" && activeRow && activeRow.z >= 0) decide(activeRow);

  // 不正解で止まった後、同じ問題をもう一度
  if (state === "hit") {
    hitT -= dt;
    if (hitT <= 0) {
      removeRow(wrongRow);
      rows = rows.filter((r) => r !== wrongRow);
      wrongRow = null;
      state = "play";
      spawnRow();
    }
  }

  // ご褒美（正解の扉を通り抜けたら表示）
  if (pendingReward && rewardRow && rewardRow.z > 2) {
    pendingReward = false;
    rewardRow = null;
    showReward();
  }

  // カメラ（後ろから追いかける＋ぶつかった時の揺れ）
  shake = Math.max(0, shake - dt);
  const sh = shake * 0.3;
  camera.position.x = lerp(camera.position.x, runnerX * 0.6, Math.min(1, dt * 5)) + (Math.random() - 0.5) * sh;
  camera.position.y = 3.2 + ampCur * 0.05 * Math.abs(Math.sin(phase)) + (Math.random() - 0.5) * sh;
  camera.lookAt(runnerX * 0.4, 1.4, -10);

  updateParticles(dt);
}

const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

applyEquip();
showMenu();
applyBgm();
tick();
