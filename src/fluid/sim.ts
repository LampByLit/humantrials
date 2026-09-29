import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Beaker } from "../lab";
import { mixIn } from "./solution";
import { lowestRim, pourFlow, solveSurface, type Vec3 } from "./volume";

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DRIP_RATE = 0.00002;
const DROP_VOLUME = 0.000005;
const MAX_DROPS = 80;
const MAX_RINGS = 64;
const RING_SEGMENTS = 7;
const MOUTH_SCALE = 0.9;
const RAY_GROUPS = ((0x0002 | 0x0008) << 16) | 0xffff;

type Droplet = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  volume: number;
  r: number;
  g: number;
  b: number;
  age: number;
  bounces: number;
  ignore: Beaker | null;
};

type Pending = Droplet;

type Puddle = {
  mesh: THREE.Mesh;
  volume: number;
  r: number;
  g: number;
  b: number;
  normal: THREE.Vector3;
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
  inR: number;
  inG: number;
  inB: number;
  inV: number;
  outV: number;
};

export type FluidSim = {
  vessels: Vessel[];
  droplets: Droplet[];
  drops: THREE.InstancedMesh;
  puddles: Puddle[];
  pending: Pending[];
  ray: RAPIER.Ray;
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
  const puddles = Array.from({ length: 24 }, () => createPuddle(scene, envMap));

  return {
    vessels,
    droplets: [],
    drops,
    puddles,
    pending: [],
    ray: new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }),
  };
}

export function updateFluid(sim: FluidSim, world: RAPIER.World, dt: number) {
  const step = Math.min(dt, 0.05);
  for (const vessel of sim.vessels) {
    vessel.inR = 0;
    vessel.inG = 0;
    vessel.inB = 0;
    vessel.inV = 0;
    vessel.outV = 0;
    vessel.pointCount = 0;
    slosh(vessel, step);
  }

  for (const vessel of sim.vessels) pourVessel(sim, world, vessel, step);
  for (const vessel of sim.vessels) commit(vessel);

  flushPending(sim, step);
  stepDroplets(sim, world, step);
  scoopPuddles(sim);

  for (const vessel of sim.vessels) {
    updateMass(vessel);
    updateVesselVisual(vessel);
    writeStream(vessel);
  }
  writeDroplets(sim);
  writePuddles(sim);
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
  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(beaker.solution.r, beaker.solution.g, beaker.solution.b, THREE.SRGBColorSpace),
    emissive: new THREE.Color().setRGB(beaker.solution.r, beaker.solution.g, beaker.solution.b, THREE.SRGBColorSpace),
    emissiveIntensity: 0.14,
    roughness: 0.07,
    metalness: 0.02,
    transparent: true,
    opacity: 0.9,
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
        gl_FragColor = linearToOutputTexel(vec4(col, 0.94));
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
    inR: 0,
    inG: 0,
    inB: 0,
    inV: 0,
    outV: 0,
  };
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
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  mesh.name = "puddle";
  mesh.visible = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  scene.add(mesh);
  return { mesh, volume: 0, r: 1, g: 1, b: 1, normal: new THREE.Vector3(0, 1, 0) };
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

  const { r, g, b } = beaker.solution;
  if (flow < DRIP_RATE) {
    vessel.dripDebt += flow * dt;
    if (vessel.dripDebt < DROP_VOLUME) return;
    const amount = Math.min(beaker.solution.volume, vessel.dripDebt);
    vessel.dripDebt = 0;
    if (amount <= 0) return;
    vessel.outV += amount;
    emitDroplet(sim, vessel, amount, r, g, b, surface.overflow);
    return;
  }

  const amount = Math.min(beaker.solution.volume, flow * dt + vessel.dripDebt);
  vessel.dripDebt = 0;
  if (amount <= 0) return;
  vessel.outV += amount;
  vessel.streamRadius = Math.min(0.013, Math.max(0.0045, Math.sqrt((amount / dt) / (Math.PI * 0.9))));
  traceStream(sim, world, vessel, amount, r, g, b, surface.overflow);
}

function emitDroplet(sim: FluidSim, vessel: Vessel, amount: number, r: number, g: number, b: number, overflow: number) {
  const launch = lipLaunch(vessel, overflow);
  spawnDroplet(sim, {
    x: launch.x,
    y: launch.y,
    z: launch.z,
    vx: launch.vx,
    vy: launch.vy,
    vz: launch.vz,
    volume: amount,
    r,
    g,
    b,
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
  amount: number,
  r: number,
  g: number,
  b: number,
  overflow: number,
) {
  const launch = lipLaunch(vessel, overflow);
  let x = launch.x;
  let y = launch.y;
  let z = launch.z;
  let vx = launch.vx;
  let vy = launch.vy;
  let vz = launch.vz;
  pushPoint(vessel, x, y, z);
  const gravity = world.gravity;
  let traveled = 0;

  for (let i = 0; i < MAX_RINGS - 1; i++) {
    const h = 0.016;
    const nvx = vx + gravity.x * h;
    const nvy = vy + gravity.y * h;
    const nvz = vz + gravity.z * h;
    const nx = x + ((vx + nvx) * 0.5) * h;
    const ny = y + ((vy + nvy) * 0.5) * h;
    const nz = z + ((vz + nvz) * 0.5) * h;
    const hit = segmentHit(
      sim,
      world,
      vessel.beaker,
      x,
      y,
      z,
      nx,
      ny,
      nz,
      traveled < 0.05 ? vessel.beaker.body : undefined,
    );
    if (hit) {
      pushPoint(vessel, hit.x, hit.y, hit.z);
      if (hit.beaker) receive(sim, hit.beaker, r, g, b, amount);
      else depositSolid(sim, hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, vx, vy, vz, amount, r, g, b);
      return;
    }
    pushPoint(vessel, nx, ny, nz);
    traveled += Math.hypot(nx - x, ny - y, nz - z);
    x = nx;
    y = ny;
    z = nz;
    vx = nvx;
    vy = nvy;
    vz = nvz;
  }

  spawnDroplet(sim, {
    x, y, z, vx, vy, vz, volume: amount, r, g, b, age: 0, bounces: 0, ignore: vessel.beaker,
  });
}

type Hit = {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  beaker: Beaker | null;
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

function receive(sim: FluidSim, beaker: Beaker, r: number, g: number, b: number, volume: number) {
  const vessel = sim.vessels.find((entry) => entry.beaker === beaker);
  if (!vessel || volume <= 0) return;
  const next = vessel.inV + volume;
  if (vessel.inV <= 1e-9) {
    vessel.inR = r;
    vessel.inG = g;
    vessel.inB = b;
  } else {
    vessel.inR = (vessel.inR * vessel.inV + r * volume) / next;
    vessel.inG = (vessel.inG * vessel.inV + g * volume) / next;
    vessel.inB = (vessel.inB * vessel.inV + b * volume) / next;
  }
  vessel.inV = next;
}

function depositSolid(
  sim: FluidSim,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  vx: number,
  vy: number,
  vz: number,
  volume: number,
  r: number,
  g: number,
  b: number,
) {
  if (ny > 0.62) {
    addPuddle(sim, x, y, z, nx, ny, nz, volume, r, g, b);
    return;
  }
  const vn = vx * nx + vy * ny + vz * nz;
  queueDrip(sim, {
    x: x + nx * 0.01,
    y: y + ny * 0.01,
    z: z + nz * 0.01,
    vx: (vx - nx * vn * 1.35) * 0.4,
    vy: (vy - ny * vn * 1.35) * 0.4 - 0.35,
    vz: (vz - nz * vn * 1.35) * 0.4,
    volume,
    r,
    g,
    b,
    age: 0,
    bounces: 0,
    ignore: null,
  });
}

function queueDrip(sim: FluidSim, drop: Pending) {
  for (const item of sim.pending) {
    const dx = item.x - drop.x;
    const dy = item.y - drop.y;
    const dz = item.z - drop.z;
    if (dx * dx + dy * dy + dz * dz > 0.0009) continue;
    const next = item.volume + drop.volume;
    item.vx = (item.vx * item.volume + drop.vx * drop.volume) / next;
    item.vy = (item.vy * item.volume + drop.vy * drop.volume) / next;
    item.vz = (item.vz * item.volume + drop.vz * drop.volume) / next;
    item.r = (item.r * item.volume + drop.r * drop.volume) / next;
    item.g = (item.g * item.volume + drop.g * drop.volume) / next;
    item.b = (item.b * item.volume + drop.b * drop.volume) / next;
    item.volume = next;
    item.x = drop.x;
    item.y = drop.y;
    item.z = drop.z;
    return;
  }
  sim.pending.push(drop);
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
    const next = nearest.volume + drop.volume;
    nearest.r = (nearest.r * nearest.volume + drop.r * drop.volume) / next;
    nearest.g = (nearest.g * nearest.volume + drop.g * drop.volume) / next;
    nearest.b = (nearest.b * nearest.volume + drop.b * drop.volume) / next;
    nearest.volume = next;
    return;
  }
  sim.droplets.push(drop);
}

function stepDroplets(sim: FluidSim, world: RAPIER.World, dt: number) {
  const gravity = world.gravity;
  for (let i = sim.droplets.length - 1; i >= 0; i--) {
    const drop = sim.droplets[i];
    drop.age += dt;
    const x1 = drop.x + drop.vx * dt;
    const y1 = drop.y + drop.vy * dt + 0.5 * gravity.y * dt * dt;
    const z1 = drop.z + drop.vz * dt;
    const vy1 = drop.vy + gravity.y * dt;
    const skipMouth = drop.ignore !== null && drop.age < 0.22 ? drop.ignore : null;
    const hit = segmentHit(sim, world, skipMouth, drop.x, drop.y, drop.z, x1, y1, z1, undefined);
    const mouth = hit?.beaker ?? null;
    if (mouth) {
      mixIn(mouth.solution, drop.r, drop.g, drop.b, drop.volume);
      sim.droplets.splice(i, 1);
      continue;
    }
    if (!hit) {
      drop.x = x1;
      drop.y = y1;
      drop.z = z1;
      drop.vy = vy1;
      if (drop.y < -1) {
        addPuddle(sim, drop.x, 0.01, drop.z, 0, 1, 0, drop.volume, drop.r, drop.g, drop.b);
        sim.droplets.splice(i, 1);
      }
      continue;
    }

    const vn = drop.vx * hit.nx + vy1 * hit.ny + drop.vz * hit.nz;
    let rx = drop.vx - hit.nx * vn * 1.2;
    let ry = vy1 - hit.ny * vn * 1.2;
    let rz = drop.vz - hit.nz * vn * 1.2;
    rx *= 0.42;
    ry *= 0.42;
    rz *= 0.42;
    const speed = Math.hypot(rx, ry, rz);
    drop.bounces += 1;
    if ((hit.ny > 0.62 && speed < 0.85) || drop.bounces >= 3) {
      addPuddle(sim, hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, drop.volume, drop.r, drop.g, drop.b);
      sim.droplets.splice(i, 1);
      continue;
    }
    drop.x = hit.x + hit.nx * 0.008;
    drop.y = hit.y + hit.ny * 0.008;
    drop.z = hit.z + hit.nz * 0.008;
    drop.vx = rx;
    drop.vy = ry;
    drop.vz = rz;
  }
}

function addPuddle(
  sim: FluidSim,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  volume: number,
  r: number,
  g: number,
  b: number,
) {
  if (volume <= 0) return;
  tmp.set(nx, ny, nz);
  if (tmp.lengthSq() < 1e-6) tmp.set(0, 1, 0);
  tmp.normalize();
  let closest: Puddle | null = null;
  let closestD = Infinity;
  for (const puddle of sim.puddles) {
    if (puddle.volume <= 0) continue;
    if (puddle.normal.dot(tmp) < 0.75) continue;
    const d = Math.hypot(puddle.mesh.position.x - x, puddle.mesh.position.y - y, puddle.mesh.position.z - z);
    const limit = 0.04 + puddleRadius(puddle.volume);
    if (d < limit && d < closestD) {
      closest = puddle;
      closestD = d;
    }
  }
  if (!closest) {
    closest = sim.puddles.find((puddle) => puddle.volume <= 0) ?? null;
    if (!closest) {
      let richest = sim.puddles[0];
      for (const puddle of sim.puddles) if (puddle.volume > richest.volume) richest = puddle;
      closest = richest;
    } else {
      closest.r = r;
      closest.g = g;
      closest.b = b;
      closest.volume = 0;
      closest.normal.copy(tmp);
    }
  }
  const next = closest.volume + volume;
  if (closest.volume > 0) {
    closest.r = (closest.r * closest.volume + r * volume) / next;
    closest.g = (closest.g * closest.volume + g * volume) / next;
    closest.b = (closest.b * closest.volume + b * volume) / next;
    closest.mesh.position.lerp(tmp2.set(x, y, z).addScaledVector(tmp, 0.004), volume / next);
  } else {
    closest.mesh.position.set(x, y, z).addScaledVector(tmp, 0.004);
  }
  closest.volume = next;
  closest.normal.copy(tmp);
  closest.mesh.visible = true;
}

function puddleRadius(volume: number) {
  return Math.min(0.2, Math.sqrt(volume / (Math.PI * 0.0025)));
}

function scoopPuddles(sim: FluidSim) {
  for (const puddle of sim.puddles) {
    if (puddle.volume <= 0) continue;
    const p = puddle.mesh.position;
    for (const vessel of sim.vessels) {
      if (!pointInMouth(vessel.beaker, p.x, p.y, p.z)) continue;
      mixIn(vessel.beaker.solution, puddle.r, puddle.g, puddle.b, puddle.volume);
      puddle.volume = 0;
      puddle.mesh.visible = false;
      break;
    }
  }
}

function commit(vessel: Vessel) {
  const solution = vessel.beaker.solution;
  solution.volume = Math.max(0, solution.volume - vessel.outV);
  mixIn(solution, vessel.inR, vessel.inG, vessel.inB, vessel.inV);
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
  color.setRGB(beaker.solution.r, beaker.solution.g, beaker.solution.b, THREE.SRGBColorSpace);
  vessel.bodyMat.color.copy(color);
  vessel.bodyMat.emissive.copy(color);
  (vessel.capMat.uniforms.color.value as THREE.Color).copy(color);
  (vessel.stream.material as THREE.MeshStandardMaterial).color.copy(color);

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
    color.setRGB(drop.r, drop.g, drop.b, THREE.SRGBColorSpace);
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
    const radius = Math.max(0.012, puddleRadius(puddle.volume));
    puddle.mesh.visible = true;
    puddle.mesh.scale.setScalar(radius);
    puddle.mesh.quaternion.setFromUnitVectors(WORLD_UP, puddle.normal);
    const mat = puddle.mesh.material as THREE.MeshStandardMaterial;
    mat.color.setRGB(puddle.r, puddle.g, puddle.b, THREE.SRGBColorSpace);
  }
}
