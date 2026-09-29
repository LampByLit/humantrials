import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Beaker } from "../lab";
import { massIn, mixIn, type Solution } from "./solution";
import { lowestRim, pourFlow, solveSurface, type Vec3 } from "./volume";

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DRIP_RATE = 0.00002;
const DROP_VOLUME = 0.000005;
const MAX_DROPS = 80;
const MAX_RINGS = 64;
const RING_SEGMENTS = 7;
const MOUTH_SCALE = 0.9;
const RAY_GROUPS = ((0x0002 | 0x0008) << 16) | 0xffff;
// Water shows as a pale tint; a solution shows its hex more fully the more concentrated it is.
const WATER_TINT = new THREE.Color().setRGB(0.82, 0.9, 0.95, THREE.SRGBColorSpace);
const FULL_COLOR_CONCENTRATION = 4000;
const PUDDLE_COUNT = 48;
const PUDDLE_MERGE_GAP = 0.015;

type Droplet = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  volume: number;
  mass: number;
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
  mass: number;
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
  incoming: Solution;
  outV: number;
  outM: number;
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
    vessel.incoming.mass = 0;
    vessel.incoming.volume = 0;
    vessel.outV = 0;
    vessel.outM = 0;
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
  writePuddles(sim, world);
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
    color: tint(beaker.solution, new THREE.Color()),
    emissive: tint(beaker.solution, new THREE.Color()),
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
    incoming: { r: 1, g: 1, b: 1, mass: 0, volume: 0 },
    outV: 0,
    outM: 0,
  };
}

function tint(solution: Solution, out: THREE.Color) {
  const concentration = solution.volume > 1e-9 ? solution.mass / solution.volume : 0;
  const strength = 1 - Math.exp(-concentration / FULL_COLOR_CONCENTRATION);
  hexColor.setRGB(solution.r, solution.g, solution.b, THREE.SRGBColorSpace);
  return out.copy(WATER_TINT).lerp(hexColor, strength);
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
  return { mesh, volume: 0, mass: 0, r: 1, g: 1, b: 1, normal: new THREE.Vector3(0, 1, 0) };
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
    const mass = massIn(beaker.solution, amount);
    vessel.outV += amount;
    vessel.outM += mass;
    emitDroplet(sim, vessel, amount, mass, r, g, b, surface.overflow);
    return;
  }

  const amount = Math.min(beaker.solution.volume, flow * dt + vessel.dripDebt);
  vessel.dripDebt = 0;
  if (amount <= 0) return;
  const mass = massIn(beaker.solution, amount);
  vessel.outV += amount;
  vessel.outM += mass;
  vessel.streamRadius = Math.min(0.013, Math.max(0.0045, Math.sqrt((amount / dt) / (Math.PI * 0.9))));
  traceStream(sim, world, vessel, amount, mass, r, g, b, surface.overflow);
}

function emitDroplet(
  sim: FluidSim,
  vessel: Vessel,
  amount: number,
  mass: number,
  r: number,
  g: number,
  b: number,
  overflow: number,
) {
  const launch = lipLaunch(vessel, overflow);
  spawnDroplet(sim, {
    x: launch.x,
    y: launch.y,
    z: launch.z,
    vx: launch.vx,
    vy: launch.vy,
    vz: launch.vz,
    volume: amount,
    mass,
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
  mass: number,
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
    // The stream leaves its own vessel, so the vessel's body must not catch it. A wide
    // tray's wall stays in range far past the lip, and catching it there sends the pour
    // back onto the tray.
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
      vessel.beaker.body,
    );
    if (hit) {
      pushPoint(vessel, hit.x, hit.y, hit.z);
      if (hit.beaker) receive(sim, hit.beaker, r, g, b, mass, amount);
      else if (hit.prop) runOff(sim, world, hit.prop, hit, { volume: amount, mass, r, g, b }, true);
      else settle(sim, world, hit, amount, mass, r, g, b, true);
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

  settleDown(sim, world, x, y, z, amount, mass, r, g, b, true);
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
      prop: sim.vessels.find((vessel) => vessel.beaker.collider.handle === cast.collider.handle)?.beaker ?? null,
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

function receive(sim: FluidSim, beaker: Beaker, r: number, g: number, b: number, mass: number, volume: number) {
  const vessel = sim.vessels.find((entry) => entry.beaker === beaker);
  if (!vessel || volume <= 0) return;
  mixIn(vessel.incoming, r, g, b, mass, volume);
}

// Every spill ends on an upward surface: in a container whose mouth it falls into, or a
// puddle. Nothing is left on a wall or dropped through the bench.
function settle(sim: FluidSim, world: RAPIER.World, hit: Hit, volume: number, mass: number, r: number, g: number, b: number, incoming: boolean) {
  if (hit.ny > 0.62) {
    addPuddle(sim, hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, volume, mass, r, g, b);
    return;
  }
  settleDown(sim, world, hit.x + hit.nx * 0.02, hit.y + hit.ny * 0.02, hit.z + hit.nz * 0.02, volume, mass, r, g, b, incoming);
}

function settleDown(
  sim: FluidSim,
  world: RAPIER.World,
  x: number,
  y: number,
  z: number,
  volume: number,
  mass: number,
  r: number,
  g: number,
  b: number,
  incoming: boolean,
  depth = 0,
) {
  const hit = segmentHit(sim, world, null, x, y, z, x, y - 4, z, undefined);
  if (hit?.beaker) {
    if (incoming) receive(sim, hit.beaker, r, g, b, mass, volume);
    else mixIn(hit.beaker.solution, r, g, b, mass, volume);
    return;
  }
  // The outside of a container is not a resting place. Keep falling to the bench or floor.
  if (hit?.prop && depth < 6) {
    settleDown(sim, world, x, hit.y - 0.03, z, volume, mass, r, g, b, incoming, depth + 1);
    return;
  }
  if (hit && hit.ny > 0.62 && hit.y > 0.05) {
    addPuddle(sim, hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, volume, mass, r, g, b);
    return;
  }
  const spot = visibleFloor(sim, world, hit ? hit.x : x, hit ? hit.z : z);
  addPuddle(sim, spot.x, 0.012, spot.z, 0, 1, 0, volume, mass, r, g, b);
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
    mixIn(nearest, drop.r, drop.g, drop.b, drop.mass, drop.volume);
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
      mixIn(mouth.solution, drop.r, drop.g, drop.b, drop.mass, drop.volume);
      sim.droplets.splice(i, 1);
      continue;
    }
    if (!hit) {
      const ground = segmentHit(sim, world, skipMouth, x1, y1 + 0.02, z1, x1, y1 - 0.3, z1, drop.ignore?.body);
      if (ground?.beaker) {
        mixIn(ground.beaker.solution, drop.r, drop.g, drop.b, drop.mass, drop.volume);
        sim.droplets.splice(i, 1);
        continue;
      }
      if (ground?.prop && y1 - ground.y < 0.3) {
        sim.droplets.splice(i, 1);
        runOff(sim, world, ground.prop, ground, drop, false);
        continue;
      }
      if (ground && ground.ny > 0.62 && y1 - ground.y < 0.3) {
        addPuddle(sim, ground.x, ground.y, ground.z, ground.nx, ground.ny, ground.nz, drop.volume, drop.mass, drop.r, drop.g, drop.b);
        sim.droplets.splice(i, 1);
        continue;
      }
      drop.x = x1;
      drop.y = y1;
      drop.z = z1;
      drop.vy = vy1;
      if (drop.y < 0) {
        sim.droplets.splice(i, 1);
        settleDown(sim, world, drop.x, 0.2, drop.z, drop.volume, drop.mass, drop.r, drop.g, drop.b, false);
      }
      continue;
    }
    if (hit.prop) {
      sim.droplets.splice(i, 1);
      runOff(sim, world, hit.prop, hit, drop, false);
      continue;
    }
    sim.droplets.splice(i, 1);
    settle(sim, world, hit, drop.volume, drop.mass, drop.r, drop.g, drop.b, false);
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
  mass: number,
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
    const limit = PUDDLE_MERGE_GAP + puddleRadius(puddle.volume);
    if (d < limit && d < closestD) {
      closest = puddle;
      closestD = d;
    }
  }
  // A puddle stays where it formed and grows in place. Only when every slot is taken does
  // a spill join a puddle it did not land on, and then the nearest one.
  if (!closest) {
    closest = sim.puddles.find((puddle) => puddle.volume <= 0) ?? null;
    if (closest) {
      closest.volume = 0;
      closest.mass = 0;
      closest.normal.copy(tmp);
      closest.mesh.position.set(x, y, z).addScaledVector(tmp, 0.004);
    } else {
      closest = sim.puddles[0];
      for (const puddle of sim.puddles) {
        const d = puddle.mesh.position.distanceToSquared(tmp2.set(x, y, z));
        if (d < closestD) {
          closest = puddle;
          closestD = d;
        }
      }
    }
  }
  mixIn(closest, r, g, b, mass, volume);
  closest.mesh.visible = true;
}

// Liquid that strikes the outside of a vessel runs down past its wall rather than sitting
// on it, and puddles wherever it lands below.
function runOff(
  sim: FluidSim,
  world: RAPIER.World,
  beaker: Beaker,
  hit: Hit,
  liquid: { volume: number; mass: number; r: number; g: number; b: number },
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
  settleDown(
    sim,
    world,
    p.x + tmp.x * reach,
    hit.y,
    p.z + tmp.z * reach,
    liquid.volume,
    liquid.mass,
    liquid.r,
    liquid.g,
    liquid.b,
    incoming,
  );
}

// How far the surface under the puddle extends, so the disc stops at a table edge
// instead of hanging past it.
function supportRadius(sim: FluidSim, world: RAPIER.World, puddle: Puddle) {
  const wanted = Math.max(0.012, puddleRadius(puddle.volume));
  const n = puddle.normal;
  const p = puddle.mesh.position;
  tmp2.crossVectors(n, Math.abs(n.y) > 0.9 ? tmp3.set(1, 0, 0) : WORLD_UP).normalize();
  tmp3.crossVectors(n, tmp2).normalize();
  let reach = wanted;
  let edgeX = 0;
  let edgeY = 0;
  let edgeZ = 0;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const dx = tmp2.x * c + tmp3.x * s;
    const dy = tmp2.y * c + tmp3.y * s;
    const dz = tmp2.z * c + tmp3.z * s;
    let lo = 0;
    let hi = wanted;
    for (let step = 0; step < 5; step++) {
      const mid = (lo + hi) * 0.5;
      if (onSurface(sim, world, p, n, dx, dy, dz, mid)) lo = mid;
      else hi = mid;
    }
    if (lo < reach) {
      reach = lo;
      edgeX = dx;
      edgeY = dy;
      edgeZ = dz;
    }
  }
  return { reach: Math.max(0.006, reach - 0.004), edgeX, edgeY, edgeZ };
}

function onSurface(
  sim: FluidSim,
  world: RAPIER.World,
  origin: THREE.Vector3,
  normal: THREE.Vector3,
  dx: number,
  dy: number,
  dz: number,
  distance: number,
) {
  const ray = sim.ray;
  ray.origin.x = origin.x + dx * distance + normal.x * 0.04;
  ray.origin.y = origin.y + dy * distance + normal.y * 0.04;
  ray.origin.z = origin.z + dz * distance + normal.z * 0.04;
  ray.dir.x = -normal.x;
  ray.dir.y = -normal.y;
  ray.dir.z = -normal.z;
  const hit = world.castRayAndGetNormal(ray, 0.08, true, 0 as RAPIER.QueryFilterFlags, RAY_GROUPS);
  if (!hit) return false;
  const nx = hit.normal.x;
  const ny = hit.normal.y;
  const nz = hit.normal.z;
  if (nx * normal.x + ny * normal.y + nz * normal.z < 0.85) return false;
  const px = ray.origin.x + ray.dir.x * hit.timeOfImpact - origin.x;
  const py = ray.origin.y + ray.dir.y * hit.timeOfImpact - origin.y;
  const pz = ray.origin.z + ray.dir.z * hit.timeOfImpact - origin.z;
  return Math.abs(px * normal.x + py * normal.y + pz * normal.z) < 0.012;
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
      mixIn(vessel.beaker.solution, puddle.r, puddle.g, puddle.b, puddle.mass, puddle.volume);
      puddle.volume = 0;
      puddle.mass = 0;
      puddle.mesh.visible = false;
      break;
    }
  }
}

function commit(vessel: Vessel) {
  const solution = vessel.beaker.solution;
  solution.volume = Math.max(0, solution.volume - vessel.outV);
  solution.mass = solution.volume > 0 ? Math.max(0, solution.mass - vessel.outM) : 0;
  const { r, g, b, mass, volume } = vessel.incoming;
  mixIn(solution, r, g, b, mass, volume);
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
  tint(beaker.solution, color);
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
    mesh.setColorAt(i, tint(drop, color));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function writePuddles(sim: FluidSim, world: RAPIER.World) {
  for (const puddle of sim.puddles) {
    if (puddle.volume <= 0) {
      puddle.mesh.visible = false;
      continue;
    }
    const wanted = Math.max(0.012, puddleRadius(puddle.volume));
    let support = supportRadius(sim, world, puddle);
    const overhang = wanted - support.reach;
    if (overhang > 0.004) {
      const step = Math.min(overhang, 0.04);
      puddle.mesh.position.x -= support.edgeX * step;
      puddle.mesh.position.y -= support.edgeY * step;
      puddle.mesh.position.z -= support.edgeZ * step;
      support = supportRadius(sim, world, puddle);
    }
    const radius = Math.min(wanted, support.reach);
    puddle.mesh.visible = true;
    puddle.mesh.scale.setScalar(radius);
    puddle.mesh.quaternion.setFromUnitVectors(WORLD_UP, puddle.normal);
    const mat = puddle.mesh.material as THREE.MeshStandardMaterial;
    tint(puddle, mat.color);
    mat.color.multiplyScalar(0.82);
    mat.opacity = 1;
  }
}
