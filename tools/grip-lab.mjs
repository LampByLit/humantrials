// Offline harness for tuning the hand pose in src/hands.ts against the beakers it has
// to pick up. Applies the same math poseArm() uses to the rig's rest transforms and
// reports real-world distances in metres, so a grip can be checked before running the game.
//
// Run: node tools/grip-lab.mjs
import { readFileSync } from "node:fs";
import * as THREE from "three";

// These must match src/hands.ts and src/lab.ts.
const MODEL_SCALE = 0.0046;
const BEAKER_RADIUS = 0.034;
const GRIP_RADIUS = BEAKER_RADIUS * 1.15;
const MAX_JOINT_CURL = 1.6;
const CLAW_ANGLE = 0.18;
const FINGER_FAN_ANGLE = 0.3;
const FINGER_FAN = { Index: -1, Middle: -0.25, Ring: 0.5, Little: 1.25 };
const BEAKER_DIAMETER = BEAKER_RADIUS * 2;

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
const childOf = (i, digit) => (nodes[i].children ?? []).find((c) => sanitize(nodes[c].name ?? "").startsWith(digit));

const rest = (i) => {
  const n = nodes[i];
  return new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(n.translation ?? [0, 0, 0]),
    new THREE.Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]),
    new THREE.Vector3().fromArray(n.scale ?? [1, 1, 1])
  );
};
const restCache = new Map();
const restWorld = (i) => {
  if (restCache.has(i)) return restCache.get(i);
  const p = parentOf.get(i);
  const m = p === undefined ? rest(i) : new THREE.Matrix4().multiplyMatrices(restWorld(p), rest(i));
  restCache.set(i, m);
  return m;
};
const restPos = (i) => new THREE.Vector3().setFromMatrixPosition(restWorld(i));

// --- Bone lengths, in metres, as they appear in the running game -------------------
console.log(`\n=== bone lengths (metres, after MODEL_SCALE=${MODEL_SCALE}) ===`);
const boneLength = {};
for (const digit of ["Thumb", "Index", "Middle", "Ring", "Little"]) {
  const parts = [];
  for (const j of [3, 2, 1]) {
    const idx = find(`${digit}_${j}L`);
    const kid = childOf(idx, digit);
    // Matches segmentLength() in hands.ts: a tip bone inherits 0.75 of the phalanx behind it.
    const len =
      kid === undefined
        ? 0.75 * restPos(idx).distanceTo(restPos(parentOf.get(idx))) * MODEL_SCALE
        : restPos(idx).distanceTo(restPos(kid)) * MODEL_SCALE;
    boneLength[`${digit}_${j}`] = len;
    parts.push(`${digit}_${j}=${(len * 100).toFixed(1)}cm${kid === undefined ? "*" : ""}`);
  }
  console.log(`  ${parts.join("  ")}`);
}
const palmLength = restPos(find("HandL")).distanceTo(restPos(find("Middle_3L"))) * MODEL_SCALE;
const handSpan = restPos(find("Index_3L")).distanceTo(restPos(find("Little_3L"))) * MODEL_SCALE;
console.log(`  palm (wrist->knuckles) = ${(palmLength * 100).toFixed(1)}cm`);
console.log(`  knuckle span (index->little) = ${(handSpan * 100).toFixed(1)}cm`);
console.log(`  beaker = ${(BEAKER_RADIUS * 100).toFixed(1)}cm radius, ${(BEAKER_DIAMETER * 100).toFixed(1)}cm across`);

// A chain of segments following a circle of radius R turns by segment/R at each joint.
console.log(`\n=== curl needed to wrap the beaker (segment/radius) ===`);
for (const digit of ["Index", "Middle", "Ring", "Little"]) {
  const parts = [3, 2].map((j) => {
    const len = boneLength[`${digit}_${j}`];
    return `${digit}_${j}=${(len / BEAKER_RADIUS).toFixed(2)}rad`;
  });
  console.log(`  ${parts.join("  ")}`);
}

// --- Pose evaluation ---------------------------------------------------------------
const xAxis = new THREE.Vector3(1, 0, 0);
const yAxis = new THREE.Vector3(0, 1, 0);
const zAxis = new THREE.Vector3(0, 0, 1);
const AXES = { X: xAxis, Y: yAxis, Z: zAxis };

function poseWorld(tag, squeeze, cfg) {
  const side = tag === "R" ? 1 : -1;
  const local = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const name = sanitize(n.name ?? "");
    const t = new THREE.Vector3().fromArray(n.translation ?? [0, 0, 0]);
    const q = new THREE.Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]);
    const s = new THREE.Vector3().fromArray(n.scale ?? [1, 1, 1]);
    const digit = ["Thumb", "Index", "Middle", "Ring", "Little"].find((d) => name.startsWith(`${d}_`));
    if (digit && new RegExp(`^${digit}_[123]${tag}`).test(name)) {
      const joint = Number(name[digit.length + 1]);
      q.multiply(jointDelta(digit, joint, squeeze, side, cfg));
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
  const at = (name) => new THREE.Vector3().setFromMatrixPosition(world(find(name)));
  // Bones run along their own local +Y, so this is the direction a bone points.
  at.dir = (name) =>
    new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(world(find(name)))).normalize();
  return at;
}

function jointDelta(digit, joint, squeeze, side, cfg) {
  const q = new THREE.Quaternion();
  if (digit === "Thumb") {
    // cfg.thumb lets us search which local axis each thumb joint should hinge about,
    // and whether that axis mirrors between hands.
    if (cfg.thumb) {
      const spec = cfg.thumb[joint];
      for (const part of spec) {
        const open = part.open ?? 0;
        const angle = open + squeeze * (part.angle - open);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(AXES[part.axis], (part.mirrored ? -side : 1) * angle));
      }
      return q;
    }
    if (joint === 3) {
      const sweep = cfg.thumbOpen + squeeze * (cfg.thumbCmc - cfg.thumbOpen);
      q.setFromAxisAngle(xAxis, sweep);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, -side * squeeze * cfg.thumbTwist));
      return q;
    }
    if (joint === 2) return q.setFromAxisAngle(zAxis, -side * squeeze * cfg.thumbMcp);
    return q.setFromAxisAngle(zAxis, -side * squeeze * cfg.thumbIp);
  }
  // Fingers: hold an open claw at rest and close onto the grip radius.
  const wrap = cfg.curl(digit, joint);
  const open = cfg.claw(digit, joint);
  q.setFromAxisAngle(zAxis, -side * (open + squeeze * (wrap - open)));
  // Splay fans the knuckles apart so the open hand is a claw rather than a paddle.
  if (joint === 3 && cfg.splay) {
    const fan = (FINGER_FAN[digit] ?? 0) * cfg.splay * (1 - squeeze);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, cfg.splaySide ? side * fan : fan));
  }
  return q;
}

function report(label, cfg) {
  const out = [];
  for (const tag of ["L", "R"]) {
    const at = (s) => poseWorld(tag, s, cfg);
    const m = (p, a, b) => p(a).distanceTo(p(b)) * MODEL_SCALE;
    const open = at(0);
    const shut = at(1);
    out.push({
      // The opening the claw presents: thumb pad to middle fingertip.
      idleOpen: m(open, `Thumb_1${tag}`, `Middle_1${tag}`),
      shutOpen: m(shut, `Thumb_1${tag}`, `Middle_1${tag}`),
      // How far the fingertip sits from the palm: must clear the beaker when closed.
      idlePalm: m(open, `Hand${tag}`, `Middle_1${tag}`),
      shutPalm: m(shut, `Hand${tag}`, `Middle_1${tag}`),
      // Fingertip spread, i.e. how much of a claw the open hand makes.
      idleSpan: m(open, `Index_1${tag}`, `Little_1${tag}`),
    });
  }
  const [l, r] = out;
  const asym = Math.max(...Object.keys(l).map((k) => Math.abs(l[k] - r[k])));
  const cm = (v) => (v * 100).toFixed(1).padStart(5);
  const holds = l.idleOpen > BEAKER_DIAMETER && l.shutOpen < BEAKER_DIAMETER;
  console.log(
    `  ${label.padEnd(24)} open:${cm(l.idleOpen)} shut:${cm(l.shutOpen)}  ` +
      `palm ${cm(l.idlePalm)}->${cm(l.shutPalm)}  span:${cm(l.idleSpan)}  ` +
      `${holds ? "HOLDS" : "no   "}  ${asym < 1e-6 ? "sym" : "ASYM"}`
  );
  return l;
}

const THUMB_AIM = 1.25;
const THUMB_KNUCKLE_STRAIGHT = -0.4;
const THUMB_TIP_STRAIGHT = -0.35;
const uniform = (v) => () => v;

// Mirrors the thumb block of poseArm(). The thumb does not move with squeeze.
const thumb = {
  thumb: {
    3: [{ axis: "Z", mirrored: true, angle: THUMB_AIM, open: THUMB_AIM }],
    2: [{ axis: "X", mirrored: false, angle: THUMB_KNUCKLE_STRAIGHT, open: THUMB_KNUCKLE_STRAIGHT }],
    1: [{ axis: "X", mirrored: false, angle: THUMB_TIP_STRAIGHT, open: THUMB_TIP_STRAIGHT }],
  },
};

// Wrap curl derived from each bone's own length, so the finger follows the object's wall.
const wrapCurl = (radius) => (digit, joint) =>
  Math.min(MAX_JOINT_CURL, boneLength[`${digit}_${joint}`] / radius);

const shipped = {
  ...thumb,
  curl: wrapCurl(GRIP_RADIUS),
  claw: uniform(CLAW_ANGLE),
  splay: FINGER_FAN_ANGLE,
  splaySide: false,
};

console.log(`\n=== shipped pose vs the old one (cm) ===`);
report("old (0.95 uniform, no fan)", { ...thumb, curl: uniform(0.95), claw: uniform(0) });
report("shipped", shipped);

console.log(`\n=== can it hold the beaker? ===`);
const m = report("shipped", shipped);
const clearance = m.idleOpen - BEAKER_DIAMETER;
const bite = BEAKER_DIAMETER - m.shutOpen;
console.log(`  beaker is ${(BEAKER_DIAMETER * 100).toFixed(1)}cm across`);
console.log(`  claw opens to ${(m.idleOpen * 100).toFixed(1)}cm -> ${(clearance * 100).toFixed(1)}cm clearance to get around it`);
console.log(`  claw closes to ${(m.shutOpen * 100).toFixed(1)}cm -> clamps ${(bite * 100).toFixed(1)}cm past the wall`);
console.log(`  verdict: ${clearance > 0.01 && bite > 0.005 ? "GRASPABLE" : "NOT GRASPABLE"}`);

console.log(`\n=== knobs ===`);
console.log(`-- GRIP_RADIUS (how tightly the fingers close; ${(GRIP_RADIUS * 100).toFixed(1)}cm shipped)`);
for (const r of [0.03, 0.035, 0.039, 0.045, 0.055]) {
  report(`grip radius ${(r * 100).toFixed(1)}cm`, { ...shipped, curl: wrapCurl(r) });
}
console.log(`-- CLAW_ANGLE (how hooked the open hand is; ${CLAW_ANGLE} shipped)`);
for (const c of [0, 0.18, 0.35, 0.5]) report(`claw ${c}`, { ...shipped, claw: uniform(c) });
console.log(`-- FINGER_FAN_ANGLE (how fanned the open hand is; ${FINGER_FAN_ANGLE} shipped)`);
for (const s of [0, 0.3, 0.5]) report(`fan ${s}`, { ...shipped, splay: s });
console.log(`-- the fan with a side factor, which is what makes it collapse and go asymmetric`);
report(`fan 0.3 mirrored`, { ...shipped, splaySide: true });

// --- Does the thumb actually oppose the fingers? -----------------------------------
// The palm direction is taken from the fingers' own motion rather than a cross product:
// a cross product is a pseudovector, so the same formula points to opposite physical
// sides of the two mirrored hands, which silently breaks any left/right comparison.
function opposition(tag, cfg) {
  const open = poseWorld(tag, 0, cfg);
  const shut = poseWorld(tag, 1, cfg);
  const cm = (v) => v * MODEL_SCALE * 100;
  // The pad, not the joint: every bone here runs along its own local +Y, and the distal
  // joint's rotation does not move its own origin, so measuring the joint would make the
  // last joint's curl invisible.
  const pad = (p, digit) => p.dir(`${digit}_1${tag}`).multiplyScalar(boneLength[`${digit}_1`] / MODEL_SCALE).add(p(`${digit}_1${tag}`));

  // Where the known-good finger curl travels = the palm side, by construction.
  const palmSide = pad(shut, "Middle").clone().sub(pad(open, "Middle")).normalize();

  // 1. Pincer: thumb pad and index pad must come together.
  const pinchOpen = cm(pad(open, "Thumb").distanceTo(pad(open, "Index")));
  const pinchShut = cm(pad(shut, "Thumb").distanceTo(pad(shut, "Index")));

  // 2. The thumb pad must travel toward the palm as it closes, not away from it.
  const travel = cm(pad(shut, "Thumb").clone().sub(pad(open, "Thumb")).dot(palmSide));

  // 3. The thumb's inner curve must face the palm, so its convex bulge points away.
  //    The bulge is how far the middle joint stands off the base-to-pad chord.
  const chord = shut(`Thumb_3${tag}`).clone().add(pad(shut, "Thumb")).multiplyScalar(0.5);
  const bulge = shut(`Thumb_2${tag}`).clone().sub(chord);
  const bulgeTowardPalm = cm(bulge.dot(palmSide));

  return { pinchOpen, pinchShut, travel, bulgeTowardPalm };
}

function oppositionRow(label, cfg) {
  const l = opposition("L", cfg);
  const r = opposition("R", cfg);
  const asym = Math.max(...Object.keys(l).map((k) => Math.abs(l[k] - r[k])));
  const n = (v) => v.toFixed(1).padStart(6);
  const pass = l.pinchShut < l.pinchOpen - 0.5 && l.pinchShut > 0.8 && l.travel > 0 && l.bulgeTowardPalm < 0 && asym < 1e-3;
  console.log(
    `  ${label.padEnd(34)} pinch ${n(l.pinchOpen)}->${n(l.pinchShut)}  towardPalm ${n(l.travel)}  ` +
      `bulge ${n(l.bulgeTowardPalm)}  ${asym < 1e-3 ? "sym " : "ASYM"}  ${pass ? "PASS" : ""}`
  );
  return { l, asym, pass };
}

const fingersOnly = { curl: wrapCurl(GRIP_RADIUS), claw: uniform(CLAW_ANGLE), splay: FINGER_FAN_ANGLE, splaySide: false };

console.log(`\n=== thumb opposition (cm) ===`);
console.log(`  the thumb and index pads must swing together (pinch closes, staying above 0.8cm),`);
console.log(`  the thumb must close toward the palm (towardPalm > 0), and its inner curve must`);
console.log(`  face the palm, meaning its convex bulge points away from it (bulge < 0).`);
oppositionRow("shipped", shipped);

// The CMC is a saddle joint with two degrees of freedom, so the base gets both: a sweep
// toward the index on local X, and a swing toward the palm on local Z.
const thumbCfg = ({ sweep, sweepOpen, swing, mcp, ip }) => ({
  ...fingersOnly,
  thumb: {
    3: [
      { axis: "X", mirrored: false, angle: sweep, open: sweepOpen },
      { axis: "Z", mirrored: true, angle: swing },
    ],
    2: [{ axis: "Z", mirrored: true, angle: mcp }],
    1: [{ axis: "Z", mirrored: true, angle: ip }],
  },
});

const range = (a, b, step) => {
  const out = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
};

const found = [];
for (const sweep of range(0.2, 0.9, 0.1))
  for (const sweepOpen of [-0.35, -0.2, 0])
    for (const swing of range(0, 0.9, 0.1))
      for (const mcp of range(0.2, 0.8, 0.1))
        for (const ip of range(0.1, 0.6, 0.1)) {
          const cfg = thumbCfg({ sweep, sweepOpen, swing, mcp, ip });
          const l = opposition("L", cfg);
          const r = opposition("R", cfg);
          const asym = Math.max(...Object.keys(l).map((k) => Math.abs(l[k] - r[k])));
          if (asym > 1e-3) continue;
          if (l.bulgeTowardPalm >= 0) continue; // inner curve must face the palm
          if (l.travel <= 0) continue; // must close toward the palm
          if (l.pinchOpen < 5) continue; // must open wide enough to admit a beaker wall
          if (l.pinchShut < 0.8 || l.pinchShut > 2.6) continue; // pads meet without merging
          found.push({ cfg, l, params: { sweep, sweepOpen, swing, mcp, ip }, score: -l.travel + l.pinchShut });
        }
console.log(`\n=== 2-DOF base search: ${found.length} combinations satisfy every requirement ===`);
// Rank by how strongly the thumb's inner curve turns to face the palm, holding the
// pincer tight and the travel toward the palm high.
const strong = found
  .filter((r) => r.l.pinchShut >= 1.4 && r.l.pinchShut <= 2.5 && r.l.travel >= 3)
  .sort((a, b) => a.l.bulgeTowardPalm - b.l.bulgeTowardPalm);
console.log(`  ${strong.length} of those hold a tight pincer; strongest opposition first:`);
for (const { params, cfg } of strong.slice(0, 8)) {
  oppositionRow(
    `sweep ${params.sweepOpen}->${params.sweep} swing ${params.swing} mcp ${params.mcp} ip ${params.ip}`,
    cfg
  );
}
