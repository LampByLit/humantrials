// Offline harness for tuning the thumb pose in src/hands.ts.
// Applies the same math poseArm() uses to the rig's rest transforms and reports, in
// units of palm length, where the thumb tip actually ends up.
//
//   spread  how far the thumb is out to the side, away from the index finger.
//           Higher = more sideways/open. This is the "extended sideways" look.
//   depth   how far the tip sits off the palm plane. Positive = palm side (correct),
//           negative = back of the hand (hyperextended, looks broken).
//   reach   distance from the thumb pad to the index/middle mid-phalanx, i.e. the
//           point a cylinder grip closes onto. Lower = a tighter grip.
//   clip    distance from the thumb tip to the index fingertip. Below ~0.3 the
//           thumb starts passing through the index finger.
//
// Run: node tools/thumb-lab.mjs
import { readFileSync } from "node:fs";
import * as THREE from "three";

const buf = readFileSync(new URL("../public/models/fps-arm-rig.glb", import.meta.url));
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let offset = 12;
let json = null;
while (offset < view.byteLength) {
  const length = view.getUint32(offset, true);
  const type = view.getUint32(offset + 4, true);
  if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(buf.subarray(offset + 8, offset + 8 + length)));
  offset += 8 + length + ((4 - (length % 4)) % 4);
}
const nodes = json.nodes;
// three.js GLTFLoader sanitizes node names: whitespace -> "_", and [ ] . : / stripped.
const sanitize = (n) => n.replace(/\s/g, "_").replace(/[\[\]\.:\/]/g, "");
const parentOf = new Map();
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
const find = (prefix) => nodes.findIndex((n) => n.name && sanitize(n.name).startsWith(prefix));

const xAxis = new THREE.Vector3(1, 0, 0);
const yAxis = new THREE.Vector3(0, 1, 0);
const zAxis = new THREE.Vector3(0, 0, 1);
const CURL_ANGLE = 0.95;

// Mirrors the thumb block of poseArm(). `openAxis` picks which base-joint axis carries
// the idle offset, so we can see which one actually reads as "sideways".
function makePose({ cmc, mcp, ip, open, twist = 0, openAxis = xAxis }) {
  return (name, squeeze, side) => {
    const q = new THREE.Quaternion();
    if (name.startsWith("Thumb_3")) {
      if (openAxis === xAxis) {
        q.setFromAxisAngle(xAxis, open + squeeze * (cmc - open));
      } else {
        q.setFromAxisAngle(openAxis, open * (1 - squeeze));
        q.multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, squeeze * cmc));
      }
      if (twist) q.multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, -side * squeeze * twist));
      return q;
    }
    if (name.startsWith("Thumb_2")) return q.setFromAxisAngle(zAxis, -side * squeeze * mcp);
    if (name.startsWith("Thumb_1")) return q.setFromAxisAngle(zAxis, -side * squeeze * ip);
    return null;
  };
}

function poseWorld(tag, squeeze, thumbPose) {
  const side = tag === "R" ? 1 : -1;
  const local = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const t = new THREE.Vector3().fromArray(n.translation ?? [0, 0, 0]);
    const q = new THREE.Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]);
    const s = new THREE.Vector3().fromArray(n.scale ?? [1, 1, 1]);
    const name = sanitize(n.name ?? "");
    if (new RegExp(`^(Thumb|Index|Middle|Ring|Little)_[123]${tag}`).test(name)) {
      const extra = thumbPose(name, squeeze, side);
      if (extra) q.multiply(extra);
      else if (!name.startsWith("Thumb"))
        q.multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, -side * squeeze * CURL_ANGLE));
    }
    local.set(i, new THREE.Matrix4().compose(t, q, s));
  }
  const cache = new Map();
  const world = (i) => {
    if (cache.has(i)) return cache.get(i);
    const p = parentOf.get(i);
    const m = p === undefined ? local.get(i) : new THREE.Matrix4().multiplyMatrices(world(p), local.get(i));
    cache.set(i, m);
    return m;
  };
  return (name) => new THREE.Vector3().setFromMatrixPosition(world(find(name)));
}

function metrics(tag, cfg) {
  const pose = makePose(cfg);
  const at = (squeeze) => poseWorld(tag, squeeze, pose);
  const open = at(0);
  const shut = at(1);
  const scale = open(`Hand${tag}`).distanceTo(open(`Middle_3${tag}`));

  const frame = (p) => {
    const hand = p(`Hand${tag}`);
    const along = p(`Middle_3${tag}`).clone().sub(hand).normalize(); // wrist -> knuckles
    const across = p(`Little_3${tag}`).clone().sub(p(`Index_3${tag}`)).normalize(); // index -> pinky
    const palm = new THREE.Vector3().crossVectors(across, along).normalize().multiplyScalar(tag === "L" ? 1 : -1);
    return { hand, along, across, palm };
  };
  // Sideways = away from the pinky, i.e. along -across, measured in the palm plane.
  const spread = (p) => {
    const f = frame(p);
    return -p(`Thumb_1${tag}`).clone().sub(f.hand).dot(f.across) / scale;
  };
  const depth = (p) => {
    const f = frame(p);
    return p(`Thumb_1${tag}`).clone().sub(f.hand).dot(f.palm) / scale;
  };
  const target = (p) => p(`Index_2${tag}`).clone().add(p(`Middle_2${tag}`)).multiplyScalar(0.5);
  const reach = (p) => p(`Thumb_1${tag}`).distanceTo(target(p)) / scale;
  const clip = (p) => p(`Thumb_1${tag}`).distanceTo(p(`Index_1${tag}`)) / scale;

  return {
    idleSpread: spread(open),
    idleDepth: depth(open),
    idleReach: reach(open),
    shutSpread: spread(shut),
    shutDepth: depth(shut),
    shutReach: reach(shut),
    shutClip: clip(shut),
  };
}

const f = (v) => (v >= 0 ? " " : "") + v.toFixed(2);
const row = (label, cfg) => {
  const m = metrics("L", cfg);
  const r = metrics("R", cfg);
  const asym = Math.max(...Object.keys(m).map((k) => Math.abs(m[k] - r[k])));
  console.log(
    `  ${label.padEnd(30)} ${f(m.idleSpread)}  ${f(m.idleDepth)}  ${f(m.idleReach)}   ` +
      `${f(m.shutSpread)}  ${f(m.shutDepth)}  ${f(m.shutReach)}  ${f(m.shutClip)}   ${asym < 1e-4 ? "sym" : "ASYM"}`
  );
};

// Keep these in sync with the THUMB_* constants in src/hands.ts.
const shipped = { cmc: 0.7, mcp: 0.3, ip: 0.2, twist: 0.15, open: -0.35 };

console.log(`\n  ${"".padEnd(30)} idle:spread depth reach   shut:spread depth reach clip`);
console.log(`\n-- shipped`);
row("hands.ts", shipped);

console.log(`\n-- THUMB_OPEN_ANGLE: how sideways the open hand is held (negative = more sideways)`);
for (const open of [0.22, 0, -0.15, -0.35, -0.45, -0.6]) row(`open=${f(open)}`, { ...shipped, open });

console.log(`\n-- THUMB_CMC_ANGLE: how far the base sweeps across the palm when gripping`);
for (const cmc of [0.5, 0.6, 0.7, 0.8, 0.9]) row(`cmc=${f(cmc)}`, { ...shipped, cmc });

console.log(`\n-- the open pose on other base axes, for comparison: less spread, and asymmetric`);
for (const open of [-0.35, -0.6]) row(`open=${f(open)} about Y`, { ...shipped, open, openAxis: yAxis });
for (const open of [-0.35, -0.6]) row(`open=${f(open)} about Z`, { ...shipped, open, openAxis: zAxis });
