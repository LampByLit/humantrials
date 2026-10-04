import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Beaker } from "../lab";
import { CHANNEL_FLOOR } from "../sim/compound";
import { mixIn, portion, STOCK_CONCENTRATION, water, type Solution } from "./solution";
import { lowestRim, pourFlow, solveSurface, type Vec3 } from "./volume";

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DRIP_RATE = 0.00002;
const DROP_VOLUME = 0.000005;
const MAX_DROPS = 80;
const MAX_RINGS = 64;
const RING_SEGMENTS = 7;
const MOUTH_SCALE = 0.9;
const RAY_GROUPS = ((0x0002 | 0x0008) << 16) | 0xffff;
// Light through a dye falls off with concentration (Beer-Lambert): a stock shows its hex,
// diluting fades it toward clear water, and cloud makes it opaque.
const WATER_TINT = new THREE.Color().setRGB(0.82, 0.9, 0.95, THREE.SRGBColorSpace);
const WHITE = new THREE.Color(1, 1, 1);
const WATER_ALPHA = 0.16;
const DYE_ALPHA = 0.9;
const CLOUD_DENSITY = 5;
const MAX_ALPHA = 0.97;
// Thin or clear liquid still needs to read as liquid.
const STREAM_MIN_ALPHA = 0.35;
const PUDDLE_MIN_ALPHA = 0.35;
const PUDDLE_COUNT = 48;
const PUDDLE_MERGE_GAP = 0.015;
const PUDDLE_DEPTH = 0.0025;
const PUDDLE_LIFT = 0.004;
const AIM_RADIUS = 0.006;

type Droplet = Solution & {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  bounces: number;
  ignore: Beaker | null;
};

type Pending = Droplet;

type Puddle = Solution & {
  mesh: THREE.Mesh;
  // Set when the volume or centre changes, so merging and spilling run only then.
  dirty: boolean;
};

type Vessel = {
  beaker: Beaker;
  surfaceUp: THREE.Vector3;
  plane: THREE.Plane;
  bodyMat: THREE.MeshStandardMaterial;
  cap: THREE.Mesh;
  capMat: THREE.ShaderMaterial;
  stream: THREE.Mesh;
  streamGeo: THREE.BufferGeometry;
  streamPos: Float32Array;
  points: THREE.Vector3[];
  pointCount: number;
  streamRadius: number;
  dripDebt: number;
  mass: number;
  incoming: Solution;
  outV: number;
  outM: number;
  outC: number;
};

export type Capsule = { x: number; y: number; z: number; half: number; radius: number };

export type FluidSim = {
  vessels: Vessel[];
  droplets: Droplet[];
  drops: THREE.InstancedMesh;
  puddles: Puddle[];
  pending: Pending[];
  ray: RAPIER.Ray;
  aim: THREE.Mesh;
  aimTime: number;
  poured: number;
  pourBeaker: Beaker | null;
  drunk: Solution;
  drinker: Capsule | null;
};

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmp3 = new THREE.Vector3();
const axisV = new THREE.Vector3();
const mouthV = new THREE.Vector3();
const outV = new THREE.Vector3();
const exitV = new THREE.Vector3();
const lipV = new THREE.Vector3();
const clipV = new THREE.Vector3();
const quat = new THREE.Quaternion();
const inv = new THREE.Quaternion();
const color = new THREE.Color();
const hexColor = new THREE.Color();
const dummy = new THREE.Object3D();
const matrix = new THREE.Matrix4();

export function createFluid(
  scene: THREE.Scene,
  beakers: Beaker[],
  envMap: THREE.Texture | null,
  lightDir: THREE.Vector3,
): FluidSim {
  const light = lightDir.clone().normalize();
  const dropGeo = new THREE.SphereGeometry(1, 14, 10);
  const dropMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.06,
    metalness: 0.02,
    transparent: true,
    opacity: 0.92,
    envMap,
    envMapIntensity: 0.85,
  });
  const drops = new THREE.InstancedMesh(dropGeo, dropMat, MAX_DROPS);
  drops.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS * 3), 3);
  drops.count = 0;
  drops.frustumCulled = false;
  drops.castShadow = false;
  drops.receiveShadow = true;
  scene.add(drops);

  const circle = new THREE.CircleGeometry(1, 36);
  circle.rotateX(-Math.PI / 2);

  const vessels = beakers.map((beaker) => createVessel(scene, beaker, circle, envMap, light));
  const puddles = Array.from({ length: PUDDLE_COUNT }, () => createPuddle(scene, envMap));
  const aim = new THREE.Mesh(
    new THREE.SphereGeometry(AIM_RADIUS, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xff2424,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    }),
  );
  aim.visible = false;
  aim.frustumCulled = false;
  aim.renderOrder = 6;
  aim.castShadow = false;
  aim.receiveShadow = false;
  scene.add(aim);

  return {
    vessels,
    droplets: [],
    drops,
    puddles,
    pending: [],
    ray: new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }),
    aim,
    aimTime: 0,
    poured: 0,
    pourBeaker: null,
    drunk: water(0),
    drinker: null,
  };
}

export function updateFluid(
  sim: FluidSim,
  world: RAPIER.World,
  dt: number,
  aim: Beaker | null = null,
  drinker: Capsule | null = null,
) {
  const step = Math.min(dt, 0.05);
  sim.drinker = drinker;
  sim.drunk.mass = 0;
  sim.drunk.cloud = 0;
  sim.drunk.volume = 0;
  for (const vessel of sim.vessels) {
    vessel.incoming.mass = 0;
    vessel.incoming.cloud = 0;
    vessel.incoming.volume = 0;
    vessel.outV = 0;
    vessel.outM = 0;
    vessel.outC = 0;
    vessel.pointCount = 0;
    slosh(vessel, step);
  }

  for (const vessel of sim.vessels) pourVessel(sim, world, vessel, step);
  for (const vessel of sim.vessels) commit(vessel);

  flushPending(sim, step);
  stepDroplets(sim, world, step);
  spreadPuddles(sim, world);
  scoopPuddles(sim);

  for (const vessel of sim.vessels) {
    updateMass(vessel);
    updateVesselVisual(vessel);
    writeStream(vessel);
  }
  writeDroplets(sim);
  writePuddles(sim);
  if (aim !== sim.pourBeaker) sim.poured = 0;
  sim.pourBeaker = aim;
  if (aim) {
    const held = sim.vessels.find((entry) => entry.beaker === aim);
    if (held) sim.poured += held.outV;
  }
  updateAim(sim, world, aim, step);
}

function createVessel(
  scene: THREE.Scene,
  beaker: Beaker,
  circle: THREE.CircleGeometry,
  envMap: THREE.Texture | null,
  light: THREE.Vector3,
): Vessel {
  const innerTop = beaker.radius * 0.8;
  const innerBottom = innerTop * 0.92;
  const liquidHalf = beaker.height / 2 - 0.004;
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const bodyColor = new THREE.Color();
  const bodyAlpha = shade(beaker.solution, bodyColor);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    emissive: bodyColor,
    emissiveIntensity: 0.14,
    roughness: 0.07,
    metalness: 0.02,
    transparent: true,
    opacity: bodyAlpha,
    envMap,
    envMapIntensity: 0.9,
    clippingPlanes: [plane],
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(innerTop, innerBottom, liquidHalf * 2, 40),
    bodyMat,
  );
  body.name = "liquid";
  body.castShadow = false;
  body.receiveShadow = true;
  body.renderOrder = 1;
  beaker.mesh.add(body);

  const capMat = new THREE.ShaderMaterial({
    uniforms: {
      color: { value: bodyMat.color.clone() },
      opacity: { value: bodyAlpha },
      lightDir: { value: light },
      beakerInv: { value: new THREE.Matrix4() },
      radiusTop: { value: innerTop },
      radiusBottom: { value: innerBottom },
      halfH: { value: liquidHalf },
    },
    vertexShader: `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      uniform vec3 lightDir;
      uniform mat4 beakerInv;
      uniform float radiusTop;
      uniform float radiusBottom;
      uniform float halfH;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec3 local = (beakerInv * vec4(vWorld, 1.0)).xyz;
        float span = halfH * 2.0;
        float yNorm = span > 0.0 ? clamp((local.y + halfH) / span, 0.0, 1.0) : 1.0;
        float limit = mix(radiusBottom, radiusTop, yNorm);
        if (local.x * local.x + local.z * local.z > limit * limit) discard;
        if (local.y < -halfH - 0.004 || local.y > halfH + 0.004) discard;
        float ndotl = dot(normalize(vNormal), normalize(lightDir));
        float light = 0.4 + 0.72 * clamp(ndotl, 0.0, 1.0);
        float fres = pow(1.0 - abs(ndotl), 2.0);
        float rim = smoothstep(0.55, 1.0, length(local.xz) / max(limit, 0.0001));
        vec3 col = color * light + color * fres * 0.22 + vec3(0.85) * rim * 0.16;
        float alpha = clamp(opacity + rim * 0.25 + fres * 0.1, 0.0, 0.97);
        gl_FragColor = linearToOutputTexel(vec4(col, alpha));
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  const cap = new THREE.Mesh(circle, capMat);
  cap.name = "liquid-surface";
  cap.frustumCulled = false;
  cap.renderOrder = 2;
  cap.scale.setScalar(0.3);
  scene.add(cap);

  const streamPos = new Float32Array(MAX_RINGS * RING_SEGMENTS * 3);
  const streamGeo = new THREE.BufferGeometry();
  streamGeo.setAttribute("position", new THREE.BufferAttribute(streamPos, 3));
  const indices: number[] = [];
  for (let ring = 0; ring < MAX_RINGS - 1; ring++) {
    for (let s = 0; s < RING_SEGMENTS; s++) {
      const a = ring * RING_SEGMENTS + s;
      const b = ring * RING_SEGMENTS + ((s + 1) % RING_SEGMENTS);
      const c = a + RING_SEGMENTS;
      const d = b + RING_SEGMENTS;
      indices.push(a, c, b, b, c, d);
    }
  }
  streamGeo.setIndex(indices);
  streamGeo.setDrawRange(0, 0);
  const streamMat = new THREE.MeshStandardMaterial({
    color: bodyMat.color.clone(),
    roughness: 0.1,
    metalness: 0.02,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    envMap,
    envMapIntensity: 0.8,
  });
  const stream = new THREE.Mesh(streamGeo, streamMat);
  stream.name = "pour";
  stream.frustumCulled = false;
  stream.visible = false;
  stream.renderOrder = 2;
  scene.add(stream);

  return {
    beaker,
    surfaceUp: new THREE.Vector3(0, 1, 0),
    plane,
    bodyMat,
    cap,
    capMat,
    stream,
    streamGeo,
    streamPos,
    points: [],
    pointCount: 0,
    streamRadius: 0.005,
    dripDebt: 0,
    mass: -1,
    incoming: water(0),
    outV: 0,
    outM: 0,
    outC: 0,
  };
}

/** Writes the liquid's colour into `out` and returns its opacity. */
function shade(liquid: Solution, out: THREE.Color): number {
  const volume = liquid.volume;
  const depth = volume > 1e-9 ? liquid.mass / volume / STOCK_CONCENTRATION : 0;
  const through = (channel: number) => Math.pow(Math.max(CHANNEL_FLOOR, channel), depth);
  const r = through(liquid.r);
  const g = through(liquid.g);
  const b = through(liquid.b);
  const absorb = 1 - Math.min(r, g, b);
  const cloud = volume > 1e-9 ? 1 - Math.exp((-CLOUD_DENSITY * liquid.cloud) / volume) : 0;
  hexColor.setRGB(r, g, b, THREE.SRGBColorSpace);
  out.copy(WATER_TINT).lerp(WHITE, Math.max(absorb, cloud)).multiply(hexColor);
  const clear = (1 - WATER_ALPHA) * (1 - DYE_ALPHA * Math.pow(absorb, 0.7)) * (1 - cloud);
  return Math.min(MAX_ALPHA, 1 - clear);
}

function createPuddle(scene: THREE.Scene, envMap: THREE.Texture | null): Puddle {
  const geo = new THREE.CircleGeometry(1, 24);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      roughness: 0.18,
      metalness: 0.02,
      transparent: true,
      opacity: 0.9,
      envMap,
      envMapIntensity: 0.6,
    }),
  );
  mesh.name = "puddle";
  mesh.visible = false;
  mesh.receiveShadow = true;
  // Drawn after the glass, and tested against it, so a puddle behind a beaker or tray
  // does not show through the container.
  mesh.renderOrder = 4;
  mesh.material.depthWrite = false;
  scene.add(mesh);
  return { ...water(0), mesh, dirty: false };
}

function slosh(vessel: Vessel, dt: number) {
  const ang = vessel.beaker.body.angvel();
  vessel.surfaceUp.x += ang.z * 0.012;
  vessel.surfaceUp.z -= ang.x * 0.012;
  const blend = 1 - Math.exp(-6.5 * dt);
  vessel.surfaceUp.lerp(WORLD_UP, blend);
  if (vessel.surfaceUp.lengthSq() < 1e-6) vessel.surfaceUp.copy(WORLD_UP);
  vessel.surfaceUp.normalize();
}

function poseOf(beaker: Beaker) {
  const p = beaker.body.translation();
  const r = beaker.body.rotation();
  tmp.set(p.x, p.y, p.z);
  quat.set(r.x, r.y, r.z, r.w);
  return { position: tmp, rotation: quat };
}

function localUpOf(vessel: Vessel, rotation: THREE.Quaternion, out: Vec3): Vec3 {
  inv.copy(rotation).invert();
  tmp2.copy(vessel.surfaceUp).applyQuaternion(inv);
  out.x = tmp2.x;
  out.y = tmp2.y;
  out.z = tmp2.z;
  return out;
}

const localUp: Vec3 = { x: 0, y: 1, z: 0 };

function pourVessel(sim: FluidSim, world: RAPIER.World, vessel: Vessel, dt: number) {
  const beaker = vessel.beaker;
  const { rotation } = poseOf(beaker);
  const up = localUpOf(vessel, rotation, localUp);
  const half = beaker.height / 2;
  const surface = solveSurface(up, beaker.solution.volume, beaker.radius, half);
  const flow = pourFlow(surface.overflow, beaker.radius);
  if (flow <= 0) {
    vessel.dripDebt = 0;
    return;
  }

  if (flow < DRIP_RATE) {
    vessel.dripDebt += flow * dt;
    if (vessel.dripDebt < DROP_VOLUME) return;
    const amount = Math.min(beaker.solution.volume, vessel.dripDebt);
    vessel.dripDebt = 0;
    if (amount <= 0) return;
    emitDroplet(sim, vessel, drawOut(vessel, amount), surface.overflow);
    return;
  }

  const amount = Math.min(beaker.solution.volume, flow * dt + vessel.dripDebt);
  vessel.dripDebt = 0;
  if (amount <= 0) return;
  vessel.streamRadius = Math.min(0.013, Math.max(0.0045, Math.sqrt((amount / dt) / (Math.PI * 0.9))));
  traceStream(sim, world, vessel, drawOut(vessel, amount), surface.overflow);
}

function drawOut(vessel: Vessel, amount: number): Solution {
  const liquid = portion(vessel.beaker.solution, amount);
  vessel.outV += liquid.volume;
  vessel.outM += liquid.mass;
  vessel.outC += liquid.cloud;
  return liquid;
}

function emitDroplet(sim: FluidSim, vessel: Vessel, liquid: Solution, overflow: number) {
  const launch = lipLaunch(vessel, overflow);
  spawnDroplet(sim, {
    ...liquid,
    x: launch.x,
    y: launch.y,
    z: launch.z,
    vx: launch.vx,
    vy: launch.vy,
    vz: launch.vz,
    age: 0,
    bounces: 0,
    ignore: vessel.beaker,
  });
}

function lipLaunch(vessel: Vessel, overflow: number) {
  const beaker = vessel.beaker;
  const position = beaker.body.translation();
  const rotation = beaker.body.rotation();
  quat.set(rotation.x, rotation.y, rotation.z, rotation.w);
  const up = localUpOf(vessel, quat, localUp);
  const half = beaker.height / 2;
  const rim = lowestRim(up, beaker.radius, half);
  lipV.set(rim.x, rim.y, rim.z).applyQuaternion(quat);
  lipV.x += position.x;
  lipV.y += position.y;
  lipV.z += position.z;
  axisV.set(0, 1, 0).applyQuaternion(quat);
  mouthV.set(position.x, position.y, position.z).addScaledVector(axisV, half);
  outV.subVectors(lipV, mouthV);
  if (outV.lengthSq() < 1e-8) outV.set(1, 0, 0);
  else outV.normalize();
  exitV.copy(vessel.surfaceUp).negate().multiplyScalar(0.72).addScaledVector(outV, 0.5);
  if (exitV.lengthSq() < 1e-8) exitV.copy(vessel.surfaceUp).negate();
  else exitV.normalize();
  const head = Math.max(overflow / (Math.PI * beaker.radius * beaker.radius), 0.002);
  const speed = Math.min(1.5, Math.sqrt(19.62 * head));
  const vel = beaker.body.velocityAtPoint({ x: lipV.x, y: lipV.y, z: lipV.z });
  return {
    x: lipV.x + outV.x * 0.02 - vessel.surfaceUp.x * 0.02,
    y: lipV.y + outV.y * 0.02 - vessel.surfaceUp.y * 0.02,
    z: lipV.z + outV.z * 0.02 - vessel.surfaceUp.z * 0.02,
    vx: exitV.x * speed + vel.x,
    vy: exitV.y * speed + vel.y,
    vz: exitV.z * speed + vel.z,
  };
}

function traceStream(
  sim: FluidSim,
  world: RAPIER.World,
  vessel: Vessel,
  liquid: Solution,
  overflow: number,
) {
  const end = walkStream(sim, world, vessel, overflow, (x, y, z) => pushPoint(vessel, x, y, z));
  if (end.swallowed) {
    mixIn(sim.drunk, liquid);
    return;
  }
  if (end.hit) {
    if (end.hit.beaker) receive(sim, end.hit.beaker, liquid);
    else if (end.hit.prop) runOff(sim, world, end.hit.prop, end.hit, liquid, true);
    else settle(sim, world, end.hit, liquid, true);
    return;
  }
  settleDown(sim, world, end.x, end.y, end.z, liquid, true);
}

// The same arc the stream follows, without moving liquid. The pour marker uses it so the
// dot sits where the liquid will land.
function walkStream(
  sim: FluidSim,
  world: RAPIER.World,
  vessel: Vessel,
  overflow: number,
  onPoint: ((x: number, y: number, z: number) => void) | null,
): { hit: Hit | null; swallowed: boolean; x: number; y: number; z: number } {
  const launch = lipLaunch(vessel, overflow);
  let x = launch.x;
  let y = launch.y;
  let z = launch.z;
  let vx = launch.vx;
  let vy = launch.vy;
  let vz = launch.vz;
  onPoint?.(x, y, z);
  if (insideDrinker(sim, x, y, z)) return { hit: null, swallowed: true, x, y, z };
  const gravity = world.gravity;

  for (let i = 0; i < MAX_RINGS - 1; i++) {
    const h = 0.016;
    const nvx = vx + gravity.x * h;
    const nvy = vy + gravity.y * h;
    const nvz = vz + gravity.z * h;
    const nx = x + ((vx + nvx) * 0.5) * h;
    const ny = y + ((vy + nvy) * 0.5) * h;
    const nz = z + ((vz + nvz) * 0.5) * h;
    // The stream leaves its own vessel, so the vessel's body must not catch it. A wide
    // tray's wall stays in range far past the lip, and catching it there sends the pour
    // back onto the tray.
    if (insideDrinker(sim, nx, ny, nz)) {
      onPoint?.(nx, ny, nz);
      return { hit: null, swallowed: true, x: nx, y: ny, z: nz };
    }
    const hit = segmentHit(sim, world, vessel.beaker, x, y, z, nx, ny, nz, vessel.beaker.body);
    if (hit) {
      onPoint?.(hit.x, hit.y, hit.z);
      return { hit, swallowed: false, x: hit.x, y: hit.y, z: hit.z };
    }
    onPoint?.(nx, ny, nz);
    x = nx;
    y = ny;
    z = nz;
    vx = nvx;
    vy = nvy;
    vz = nvz;
  }

  return { hit: null, swallowed: false, x, y, z };
}

function insideDrinker(sim: FluidSim, x: number, y: number, z: number) {
  const drinker = sim.drinker;
  if (!drinker) return false;
  const dy = y - drinker.y;
  const along = Math.max(-drinker.half, Math.min(drinker.half, dy));
  const ox = x - drinker.x;
  const oy = dy - along;
  const oz = z - drinker.z;
  return ox * ox + oy * oy + oz * oz <= drinker.radius * drinker.radius;
}

function updateAim(sim: FluidSim, world: RAPIER.World, beaker: Beaker | null, dt: number) {
  sim.aimTime += dt;
  const mesh = sim.aim;
  const vessel = beaker ? sim.vessels.find((entry) => entry.beaker === beaker) : undefined;
  if (!vessel) {
    mesh.visible = false;
    return;
  }
  const held = vessel.beaker;
  const { rotation } = poseOf(held);
  const up = localUpOf(vessel, rotation, localUp);
  const surface = solveSurface(up, held.solution.volume, held.radius, held.height / 2);
  const end = walkStream(sim, world, vessel, surface.overflow, null);
  const spot = restingSpot(sim, world, end.hit, end.x, end.y, end.z);
  if (!spot) {
    mesh.visible = false;
    return;
  }
  const lift = AIM_RADIUS + 0.003;
  mesh.position.set(spot.x + spot.nx * lift, spot.y + spot.ny * lift, spot.z + spot.nz * lift);
  mesh.visible = true;
  const wave = 0.5 + 0.5 * Math.sin(sim.aimTime * 3.2);
  (mesh.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.75 * wave;
}

type Spot = { x: number; y: number; z: number; nx: number; ny: number; nz: number };

// Where the pour comes to rest: the inside floor of a vessel it falls into, or the bench
// or floor under anything else. Walls and rims are not resting places.
function restingSpot(sim: FluidSim, world: RAPIER.World, hit: Hit | null, x: number, y: number, z: number): Spot | null {
  if (!hit) return dropToSurface(sim, world, x, y, z, 0);
  if (hit.beaker) return interiorFloor(hit.beaker, hit.x, hit.y, hit.z);
  if (hit.prop && overOpening(hit.prop, hit.x, hit.y, hit.z)) return interiorFloor(hit.prop, hit.x, hit.y, hit.z);
  if (hit.ny > 0.62) return { x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz };
  return dropToSurface(sim, world, hit.x + hit.nx * 0.02, hit.y + hit.ny * 0.02, hit.z + hit.nz * 0.02, 0);
}

function dropToSurface(sim: FluidSim, world: RAPIER.World, x: number, y: number, z: number, depth: number): Spot {
  const hit = segmentHit(sim, world, null, x, y, z, x, y - 4, z, undefined);
  if (hit?.beaker) return interiorFloor(hit.beaker, hit.x, hit.y, hit.z);
  if (hit?.prop && overOpening(hit.prop, hit.x, hit.y, hit.z)) return interiorFloor(hit.prop, hit.x, hit.y, hit.z);
  if (hit?.prop && depth < 6) return dropToSurface(sim, world, x, hit.y - 0.03, z, depth + 1);
  if (hit && hit.ny > 0.62) return { x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz };
  const floor = visibleFloor(sim, world, hit ? hit.x : x, hit ? hit.z : z);
  return { x: floor.x, y: 0, z: floor.z, nx: 0, ny: 1, nz: 0 };
}

function interiorFloor(beaker: Beaker, x: number, y: number, z: number): Spot {
  const p = beaker.body.translation();
  const rotation = beaker.body.rotation();
  quat.set(rotation.x, rotation.y, rotation.z, rotation.w);
  axisV.set(0, 1, 0).applyQuaternion(quat);
  const inset = beaker.height / 2 - 0.004;
  const bx = p.x - axisV.x * inset;
  const by = p.y - axisV.y * inset;
  const bz = p.z - axisV.z * inset;
  const along = (x - bx) * axisV.x + (y - by) * axisV.y + (z - bz) * axisV.z;
  let rx = x - axisV.x * along - bx;
  let ry = y - axisV.y * along - by;
  let rz = z - axisV.z * along - bz;
  const rad = Math.hypot(rx, ry, rz);
  const limit = beaker.radius * 0.72;
  if (rad > limit && rad > 1e-8) {
    const scale = limit / rad;
    rx *= scale;
    ry *= scale;
    rz *= scale;
  }
  return { x: bx + rx, y: by + ry, z: bz + rz, nx: axisV.x, ny: axisV.y, nz: axisV.z };
}

function overOpening(beaker: Beaker, x: number, y: number, z: number) {
  const p = beaker.body.translation();
  const rotation = beaker.body.rotation();
  inv.set(rotation.x, rotation.y, rotation.z, rotation.w).invert();
  tmp3.set(x - p.x, y - p.y, z - p.z).applyQuaternion(inv);
  const limit = beaker.radius * MOUTH_SCALE;
  return tmp3.x * tmp3.x + tmp3.z * tmp3.z <= limit * limit;
}

type Hit = {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  // The vessel whose mouth caught the liquid.
  beaker: Beaker | null;
  // The vessel whose outside (wall, base or rim) the liquid struck.
  prop: Beaker | null;
};

function segmentHit(
  sim: FluidSim,
  world: RAPIER.World,
  skipMouth: Beaker | null,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  excludeBody: RAPIER.RigidBody | undefined,
): Hit | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return null;

  let best = len + 1;
  let hit: Hit | null = null;

  for (const vessel of sim.vessels) {
    if (vessel.beaker === skipMouth) continue;
    const t = mouthT(vessel.beaker, x0, y0, z0, dx, dy, dz);
    if (t === null) continue;
    const dist = t * len;
    if (dist < best) {
      best = dist;
      hit = {
        x: x0 + dx * t,
        y: y0 + dy * t,
        z: z0 + dz * t,
        nx: 0,
        ny: 1,
        nz: 0,
        beaker: vessel.beaker,
        prop: null,
      };
    }
  }

  const ray = sim.ray;
  ray.origin.x = x0;
  ray.origin.y = y0;
  ray.origin.z = z0;
  ray.dir.x = dx / len;
  ray.dir.y = dy / len;
  ray.dir.z = dz / len;
  const cast = world.castRayAndGetNormal(
    ray,
    len,
    true,
    0 as RAPIER.QueryFilterFlags,
    RAY_GROUPS,
    undefined,
    excludeBody,
  );
  if (cast && cast.timeOfImpact < best && cast.timeOfImpact >= 0) {
    const toi = cast.timeOfImpact;
    hit = {
      x: x0 + ray.dir.x * toi,
      y: y0 + ray.dir.y * toi,
      z: z0 + ray.dir.z * toi,
      nx: cast.normal.x,
      ny: cast.normal.y,
      nz: cast.normal.z,
      beaker: null,
      prop: sim.vessels.find((vessel) => vessel.beaker.body.handle === cast.collider.parent()?.handle)?.beaker ?? null,
    };
  }
  return hit;
}

function mouthT(beaker: Beaker, x0: number, y0: number, z0: number, dx: number, dy: number, dz: number) {
  const p = beaker.body.translation();
  const r = beaker.body.rotation();
  quat.set(r.x, r.y, r.z, r.w);
  tmp2.set(0, 1, 0).applyQuaternion(quat);
  const ax = tmp2.x;
  const ay = tmp2.y;
  const az = tmp2.z;
  const half = beaker.height / 2 + 0.006;
  const cx = p.x + ax * half;
  const cy = p.y + ay * half;
  const cz = p.z + az * half;
  const denom = dx * ax + dy * ay + dz * az;
  if (Math.abs(denom) < 1e-8) return null;
  const t = ((cx - x0) * ax + (cy - y0) * ay + (cz - z0) * az) / denom;
  if (t < 0 || t > 1) return null;
  const hx = x0 + dx * t - cx;
  const hy = y0 + dy * t - cy;
  const hz = z0 + dz * t - cz;
  const along = hx * ax + hy * ay + hz * az;
  const rx = hx - ax * along;
  const ry = hy - ay * along;
  const rz = hz - az * along;
  const radius = beaker.radius * MOUTH_SCALE;
  if (rx * rx + ry * ry + rz * rz > radius * radius) return null;
  return t;
}

function pointInMouth(beaker: Beaker, x: number, y: number, z: number) {
  const p = beaker.body.translation();
  const r = beaker.body.rotation();
  inv.set(r.x, r.y, r.z, r.w).invert();
  tmp3.set(x - p.x, y - p.y, z - p.z).applyQuaternion(inv);
  const radial = tmp3.x * tmp3.x + tmp3.z * tmp3.z;
  const limit = beaker.radius * MOUTH_SCALE;
  if (radial > limit * limit) return false;
  const half = beaker.height / 2;
  return tmp3.y > half - 0.012 && tmp3.y < half + 0.028;
}

function receive(sim: FluidSim, beaker: Beaker, liquid: Solution) {
  const vessel = sim.vessels.find((entry) => entry.beaker === beaker);
  if (!vessel || liquid.volume <= 0) return;
  mixIn(vessel.incoming, liquid);
}

// Every spill ends on an upward surface: in a container whose mouth it falls into, or a
// puddle. Nothing is left on a wall or dropped through the bench.
function settle(sim: FluidSim, world: RAPIER.World, hit: Hit, liquid: Solution, incoming: boolean) {
  if (hit.ny > 0.62) {
    addPuddle(sim, hit.x, hit.y, hit.z, liquid);
    return;
  }
  settleDown(sim, world, hit.x + hit.nx * 0.02, hit.y + hit.ny * 0.02, hit.z + hit.nz * 0.02, liquid, incoming);
}

function settleDown(
  sim: FluidSim,
  world: RAPIER.World,
  x: number,
  y: number,
  z: number,
  liquid: Solution,
  incoming: boolean,
  depth = 0,
) {
  const hit = segmentHit(sim, world, null, x, y, z, x, y - 4, z, undefined);
  if (hit?.beaker) {
    if (incoming) receive(sim, hit.beaker, liquid);
    else mixIn(hit.beaker.solution, liquid);
    return;
  }
  // The outside of a container is not a resting place. Keep falling to the bench or floor.
  if (hit?.prop && depth < 6) {
    settleDown(sim, world, x, hit.y - 0.03, z, liquid, incoming, depth + 1);
    return;
  }
  if (hit && hit.ny > 0.62 && hit.y > 0.05) {
    addPuddle(sim, hit.x, hit.y, hit.z, liquid);
    return;
  }
  const spot = visibleFloor(sim, world, hit ? hit.x : x, hit ? hit.z : z);
  addPuddle(sim, spot.x, 0.012, spot.z, liquid);
}

// A floor puddle under a bench cannot be seen from above. Slide it out until the floor
// there is open to a downward ray.
function visibleFloor(sim: FluidSim, world: RAPIER.World, x: number, z: number) {
  if (floorIsOpen(sim, world, x, z)) return { x, z };
  for (let ring = 1; ring <= 14; ring++) {
    for (let step = 0; step < 12; step++) {
      const angle = (step / 12) * Math.PI * 2;
      const sx = x + Math.cos(angle) * ring * 0.08;
      const sz = z + Math.sin(angle) * ring * 0.08;
      if (floorIsOpen(sim, world, sx, sz)) return { x: sx, z: sz };
    }
  }
  return { x, z };
}

function floorIsOpen(sim: FluidSim, world: RAPIER.World, x: number, z: number) {
  const ray = sim.ray;
  ray.origin.x = x;
  ray.origin.y = 1.3;
  ray.origin.z = z;
  ray.dir.x = 0;
  ray.dir.y = -1;
  ray.dir.z = 0;
  const hit = world.castRayAndGetNormal(ray, 1.35, true, 0 as RAPIER.QueryFilterFlags, RAY_GROUPS);
  if (!hit || hit.normal.y < 0.7) return false;
  return ray.origin.y + ray.dir.y * hit.timeOfImpact < 0.04;
}

function flushPending(sim: FluidSim, dt: number) {
  for (let i = sim.pending.length - 1; i >= 0; i--) {
    const item = sim.pending[i];
    item.age += dt;
    if (item.volume < 0.000004 && item.age < 0.05) continue;
    sim.pending.splice(i, 1);
    item.age = 0;
    spawnDroplet(sim, item);
  }
}

function spawnDroplet(sim: FluidSim, drop: Droplet) {
  if (drop.volume <= 1e-9) return;
  if (sim.droplets.length >= MAX_DROPS) {
    let nearest = sim.droplets[0];
    let best = Infinity;
    for (const other of sim.droplets) {
      const d = (other.x - drop.x) ** 2 + (other.y - drop.y) ** 2 + (other.z - drop.z) ** 2;
      if (d < best) {
        best = d;
        nearest = other;
      }
    }
    mixIn(nearest, drop);
    return;
  }
  sim.droplets.push(drop);
}

function stepDroplets(sim: FluidSim, world: RAPIER.World, dt: number) {
  const gravity = world.gravity;
  for (let i = sim.droplets.length - 1; i >= 0; i--) {
    const drop = sim.droplets[i];
    drop.age += dt;
    if (insideDrinker(sim, drop.x, drop.y, drop.z)) {
      mixIn(sim.drunk, drop);
      sim.droplets.splice(i, 1);
      continue;
    }
    const x1 = drop.x + drop.vx * dt;
    const y1 = drop.y + drop.vy * dt + 0.5 * gravity.y * dt * dt;
    const z1 = drop.z + drop.vz * dt;
    const vy1 = drop.vy + gravity.y * dt;
    const skipMouth = drop.ignore !== null && drop.age < 0.22 ? drop.ignore : null;
    const hit = segmentHit(
      sim,
      world,
      skipMouth,
      drop.x,
      drop.y,
      drop.z,
      x1,
      y1,
      z1,
      drop.ignore?.body,
    );
    const mouth = hit?.beaker ?? null;
    if (mouth) {
      mixIn(mouth.solution, drop);
      sim.droplets.splice(i, 1);
      continue;
    }
    if (!hit) {
      const ground = segmentHit(sim, world, skipMouth, x1, y1 + 0.02, z1, x1, y1 - 0.3, z1, drop.ignore?.body);
      if (ground?.beaker) {
        mixIn(ground.beaker.solution, drop);
        sim.droplets.splice(i, 1);
        continue;
      }
      if (ground?.prop && y1 - ground.y < 0.3) {
        sim.droplets.splice(i, 1);
        runOff(sim, world, ground.prop, ground, drop, false);
        continue;
      }
      if (ground && ground.ny > 0.62 && y1 - ground.y < 0.3) {
        addPuddle(sim, ground.x, ground.y, ground.z, drop);
        sim.droplets.splice(i, 1);
        continue;
      }
      drop.x = x1;
      drop.y = y1;
      drop.z = z1;
      drop.vy = vy1;
      if (drop.y < 0) {
        sim.droplets.splice(i, 1);
        settleDown(sim, world, drop.x, 0.2, drop.z, drop, false);
      }
      continue;
    }
    if (hit.prop) {
      sim.droplets.splice(i, 1);
      runOff(sim, world, hit.prop, hit, drop, false);
      continue;
    }
    sim.droplets.splice(i, 1);
    settle(sim, world, hit, drop, false);
  }
}

function addPuddle(sim: FluidSim, x: number, y: number, z: number, liquid: Solution) {
  if (liquid.volume <= 0) return;
  y += PUDDLE_LIFT;
  let puddle = sim.puddles.find((entry) => entry.volume > 0 && touches(entry, x, y, z, 0)) ?? freeSlot(sim);
  if (!puddle) puddle = nearestPuddle(sim, x, y, z);
  if (puddle.volume <= 0) puddle.mesh.position.set(x, y, z);
  pool(puddle, x, z, liquid.volume);
  mixIn(puddle, liquid);
}

function drain(liquid: Solution) {
  liquid.volume = 0;
  liquid.mass = 0;
  liquid.cloud = 0;
}

// A puddle's centre is the centre of its liquid, so what joins it pulls it that way.
function pool(puddle: Puddle, x: number, z: number, volume: number) {
  const p = puddle.mesh.position;
  const w = volume / (puddle.volume + volume);
  p.x += (x - p.x) * w;
  p.z += (z - p.z) * w;
  puddle.dirty = true;
}

function touches(puddle: Puddle, x: number, y: number, z: number, radius: number) {
  const p = puddle.mesh.position;
  if (Math.abs(p.y - y) > 0.02) return false;
  return Math.hypot(p.x - x, p.z - z) < puddleRadius(puddle.volume) + radius + PUDDLE_MERGE_GAP;
}

function merge(into: Puddle, from: Puddle) {
  pool(into, from.mesh.position.x, from.mesh.position.z, from.volume);
  mixIn(into, from);
  drain(from);
  from.dirty = false;
}

// When every slot is taken, the two closest puddles on one surface become one.
function freeSlot(sim: FluidSim): Puddle | null {
  const empty = sim.puddles.find((entry) => entry.volume <= 0);
  if (empty) return empty;
  let best = Infinity;
  let a: Puddle | null = null;
  let b: Puddle | null = null;
  for (let i = 0; i < sim.puddles.length; i++) {
    const p = sim.puddles[i].mesh.position;
    for (let j = i + 1; j < sim.puddles.length; j++) {
      const q = sim.puddles[j].mesh.position;
      if (Math.abs(p.y - q.y) > 0.02) continue;
      const d = (p.x - q.x) ** 2 + (p.z - q.z) ** 2;
      if (d < best) {
        best = d;
        a = sim.puddles[i];
        b = sim.puddles[j];
      }
    }
  }
  if (!a || !b) return null;
  merge(a, b);
  return b;
}

function nearestPuddle(sim: FluidSim, x: number, y: number, z: number) {
  let nearest = sim.puddles[0];
  let best = Infinity;
  for (const puddle of sim.puddles) {
    const d = puddle.mesh.position.distanceToSquared(tmp2.set(x, y, z));
    if (d < best) {
      best = d;
      nearest = puddle;
    }
  }
  return nearest;
}

// Liquid that strikes the outside of a vessel runs down past its wall rather than sitting
// on it, and puddles wherever it lands below.
function runOff(
  sim: FluidSim,
  world: RAPIER.World,
  beaker: Beaker,
  hit: Hit,
  liquid: Solution,
  incoming: boolean,
) {
  const p = beaker.body.translation();
  const rotation = beaker.body.rotation();
  quat.set(rotation.x, rotation.y, rotation.z, rotation.w);
  axisV.set(0, 1, 0).applyQuaternion(quat);
  tmp.set(hit.x - p.x, 0, hit.z - p.z);
  if (tmp.lengthSq() < 1e-8) tmp.set(hit.nx, 0, hit.nz);
  if (tmp.lengthSq() < 1e-8) tmp.set(1, 0, 0);
  tmp.normalize();
  const reach = beaker.radius + (beaker.height / 2) * Math.hypot(axisV.x, axisV.z) + 0.012;
  settleDown(sim, world, p.x + tmp.x * reach, hit.y, p.z + tmp.z * reach, liquid, incoming);
}

// Puddles that grow into each other become one, and a puddle wider than its surface
// pours what it cannot hold over the edge. Each spill lands as a new change, so a few
// passes let it settle.
function spreadPuddles(sim: FluidSim, world: RAPIER.World) {
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const puddle of sim.puddles) {
      if (!puddle.dirty || puddle.volume <= 0) continue;
      puddle.dirty = false;
      changed = true;
      const p = puddle.mesh.position;
      for (const other of sim.puddles) {
        if (other === puddle || other.volume <= 0) continue;
        if (touches(other, p.x, p.y, p.z, puddleRadius(puddle.volume))) merge(puddle, other);
      }
      spill(sim, world, puddle);
    }
    if (!changed) return;
  }
}

function spill(sim: FluidSim, world: RAPIER.World, puddle: Puddle) {
  const p = puddle.mesh.position;
  const wanted = puddleRadius(puddle.volume);
  let reach = wanted;
  let edgeX = 0;
  let edgeZ = 0;
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    if (!isDrop(sim, world, p.x + dx * wanted, p.y, p.z + dz * wanted)) continue;
    let lo = 0;
    let hi = wanted;
    for (let step = 0; step < 6; step++) {
      const mid = (lo + hi) * 0.5;
      if (isDrop(sim, world, p.x + dx * mid, p.y, p.z + dz * mid)) hi = mid;
      else lo = mid;
    }
    if (lo < reach) {
      reach = lo;
      edgeX = dx;
      edgeZ = dz;
    }
  }
  const capacity = Math.PI * reach * reach * PUDDLE_DEPTH;
  const excess = puddle.volume - capacity;
  if (excess <= 1e-9) return;
  const overflow = portion(puddle, excess);
  puddle.volume = capacity;
  puddle.mass -= overflow.mass;
  puddle.cloud -= overflow.cloud;
  const out = reach + 0.02;
  settleDown(sim, world, p.x + edgeX * out, p.y + 0.02, p.z + edgeZ * out, overflow, false);
}

// Only the fixed benches and floor shape a puddle. A beaker standing in one does not.
function isDrop(sim: FluidSim, world: RAPIER.World, x: number, y: number, z: number) {
  const ray = sim.ray;
  ray.origin.x = x;
  ray.origin.y = y + 0.02;
  ray.origin.z = z;
  ray.dir.x = 0;
  ray.dir.y = -1;
  ray.dir.z = 0;
  const hit = world.castRay(ray, 0.1, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, RAY_GROUPS);
  return !hit || ray.origin.y - hit.timeOfImpact < y - 0.03;
}

function puddleRadius(volume: number) {
  return Math.sqrt(volume / (Math.PI * PUDDLE_DEPTH));
}

function scoopPuddles(sim: FluidSim) {
  for (const puddle of sim.puddles) {
    if (puddle.volume <= 0) continue;
    const p = puddle.mesh.position;
    for (const vessel of sim.vessels) {
      if (!pointInMouth(vessel.beaker, p.x, p.y, p.z)) continue;
      mixIn(vessel.beaker.solution, puddle);
      drain(puddle);
      puddle.mesh.visible = false;
      break;
    }
  }
}

function commit(vessel: Vessel) {
  const solution = vessel.beaker.solution;
  solution.volume = Math.max(0, solution.volume - vessel.outV);
  solution.mass = solution.volume > 0 ? Math.max(0, solution.mass - vessel.outM) : 0;
  solution.cloud = solution.volume > 0 ? Math.max(0, solution.cloud - vessel.outC) : 0;
  mixIn(solution, vessel.incoming);
}

function updateMass(vessel: Vessel) {
  const mass = vessel.beaker.solution.volume * 1000;
  if (Math.abs(mass - vessel.mass) < 0.008) return;
  vessel.beaker.body.setAdditionalMass(mass, true);
  vessel.mass = mass;
}

function updateVesselVisual(vessel: Vessel) {
  const beaker = vessel.beaker;
  const { position, rotation } = poseOf(beaker);
  const up = localUpOf(vessel, rotation, localUp);
  const surface = solveSurface(up, beaker.solution.volume, beaker.radius, beaker.height / 2);
  const visible = beaker.solution.volume > 1e-6;
  const liquid = beaker.mesh.getObjectByName("liquid");
  if (liquid) liquid.visible = visible;
  vessel.cap.visible = visible;
  const alpha = shade(beaker.solution, color);
  // Clear liquid must not hide the glass behind it.
  const solid = alpha > 0.5;
  vessel.bodyMat.color.copy(color);
  vessel.bodyMat.emissive.copy(color);
  vessel.bodyMat.opacity = alpha;
  vessel.bodyMat.depthWrite = solid;
  (vessel.capMat.uniforms.color.value as THREE.Color).copy(color);
  vessel.capMat.uniforms.opacity.value = alpha;
  vessel.capMat.depthWrite = solid;
  const streamMat = vessel.stream.material as THREE.MeshStandardMaterial;
  streamMat.color.copy(color);
  streamMat.opacity = Math.max(STREAM_MIN_ALPHA, alpha);

  tmp2.copy(position).addScaledVector(vessel.surfaceUp, surface.plane);
  vessel.cap.position.copy(tmp2);
  vessel.cap.quaternion.setFromUnitVectors(WORLD_UP, vessel.surfaceUp);
  clipV.copy(tmp2).addScaledVector(vessel.surfaceUp, -0.0015);
  tmp3.copy(vessel.surfaceUp).negate();
  vessel.plane.setFromNormalAndCoplanarPoint(tmp3, clipV);

  beaker.mesh.updateMatrixWorld(true);
  matrix.copy(beaker.mesh.matrixWorld).invert();
  (vessel.capMat.uniforms.beakerInv.value as THREE.Matrix4).copy(matrix);
}

function pushPoint(vessel: Vessel, x: number, y: number, z: number) {
  if (vessel.pointCount >= MAX_RINGS) return;
  let point = vessel.points[vessel.pointCount];
  if (!point) {
    point = new THREE.Vector3();
    vessel.points.push(point);
  }
  point.set(x, y, z);
  vessel.pointCount += 1;
}

function writeStream(vessel: Vessel) {
  const count = vessel.pointCount;
  if (count < 2) {
    vessel.stream.visible = false;
    return;
  }
  vessel.stream.visible = true;
  const radius = vessel.streamRadius;
  const pos = vessel.streamPos;
  for (let i = 0; i < count; i++) {
    const point = vessel.points[i];
    const prev = vessel.points[Math.max(0, i - 1)];
    const next = vessel.points[Math.min(count - 1, i + 1)];
    tmp.subVectors(next, prev);
    if (tmp.lengthSq() < 1e-8) tmp.set(0, -1, 0);
    else tmp.normalize();
    tmp2.crossVectors(tmp, WORLD_UP);
    if (tmp2.lengthSq() < 1e-6) tmp2.crossVectors(tmp, tmp3.set(1, 0, 0));
    tmp2.normalize();
    tmp3.crossVectors(tmp2, tmp).normalize();
    const ring = radius * (1 - (0.35 * i) / (count - 1));
    for (let s = 0; s < RING_SEGMENTS; s++) {
      const angle = (s / RING_SEGMENTS) * Math.PI * 2;
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      const idx = (i * RING_SEGMENTS + s) * 3;
      pos[idx] = point.x + (tmp2.x * c + tmp3.x * sn) * ring;
      pos[idx + 1] = point.y + (tmp2.y * c + tmp3.y * sn) * ring;
      pos[idx + 2] = point.z + (tmp2.z * c + tmp3.z * sn) * ring;
    }
  }
  const attr = vessel.streamGeo.getAttribute("position") as THREE.BufferAttribute;
  attr.needsUpdate = true;
  vessel.streamGeo.setDrawRange(0, (count - 1) * RING_SEGMENTS * 6);
  vessel.streamGeo.computeVertexNormals();
}

function writeDroplets(sim: FluidSim) {
  const mesh = sim.drops;
  mesh.count = sim.droplets.length;
  for (let i = 0; i < sim.droplets.length; i++) {
    const drop = sim.droplets[i];
    const radius = Math.max(0.0045, Math.cbrt((3 * drop.volume) / (4 * Math.PI)));
    const speed = Math.hypot(drop.vx, drop.vy, drop.vz);
    const stretch = Math.min(2.4, 1 + speed * 0.15);
    if (speed > 0.2) {
      tmp.set(drop.vx / speed, drop.vy / speed, drop.vz / speed);
      quat.setFromUnitVectors(WORLD_UP, tmp);
    } else quat.identity();
    dummy.position.set(drop.x, drop.y, drop.z);
    dummy.quaternion.copy(quat);
    dummy.scale.set(radius, radius * stretch, radius);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    shade(drop, color);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function writePuddles(sim: FluidSim) {
  for (const puddle of sim.puddles) {
    if (puddle.volume <= 0) {
      puddle.mesh.visible = false;
      continue;
    }
    puddle.mesh.visible = true;
    puddle.mesh.scale.setScalar(Math.max(0.006, puddleRadius(puddle.volume)));
    const mat = puddle.mesh.material as THREE.MeshStandardMaterial;
    const alpha = shade(puddle, mat.color);
    mat.color.multiplyScalar(0.82);
    mat.opacity = Math.max(PUDDLE_MIN_ALPHA, alpha);
  }
}
