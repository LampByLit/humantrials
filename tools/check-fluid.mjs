import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

const THREE = await vite.ssrLoadModule("three");
const RAPIER = (await vite.ssrLoadModule("@dimforge/rapier3d-compat")).default;
const volume = await vite.ssrLoadModule("/src/fluid/volume.ts");
const solution = await vite.ssrLoadModule("/src/fluid/solution.ts");
const lab = await vite.ssrLoadModule("/src/lab.ts");
const fluid = await vite.ssrLoadModule("/src/fluid/sim.ts");

let failed = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`ok  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name} ${detail}`);
  }
}

const { cylinderCapacity, liquidVolume, solveSurface, pourFlow, lowestRim } = volume;
const radius = 0.034;
const half = 0.045;
const cap = cylinderCapacity(radius, half * 2);

const upright = { x: 0, y: 1, z: 0 };
const full = liquidVolume(upright, half, radius, half);
check("upright full", Math.abs(full - cap) / cap < 0.01, `full=${full} cap=${cap}`);
const halfVol = liquidVolume(upright, 0, radius, half);
check("upright half", Math.abs(halfVol - cap / 2) / cap < 0.01, `half=${halfVol}`);
const empty = liquidVolume(upright, -half, radius, half);
check("upright empty", empty < cap * 0.01, `empty=${empty}`);

const tilt = { x: Math.sin(0.7), y: Math.cos(0.7), z: 0 };
const vMax = solveSurface(tilt, cap, radius, half);
check("tilt holds less", vMax.overflow > cap * 0.05, `overflow=${vMax.overflow}`);
const fitted = solveSurface(tilt, cap * 0.2, radius, half);
const fittedVol = liquidVolume(fitted.up, fitted.plane, radius, half);
check("fitted volume", fitted.overflow === 0 && Math.abs(fittedVol - cap * 0.2) / cap < 0.02, `got=${fittedVol}`);

const sideways = solveSurface({ x: 1, y: 0, z: 0 }, cap * 0.5, radius, half);
check("sideways spills", sideways.overflow > cap * 0.45, `overflow=${sideways.overflow}`);
const inverted = solveSurface({ x: 0, y: -1, z: 0 }, cap * 0.5, radius, half);
check("inverted spills", inverted.overflow > cap * 0.45, `overflow=${inverted.overflow}`);

check("no flow when settled", pourFlow(0, radius) === 0);
check("more head pours faster", pourFlow(0.0002, radius) > pourFlow(0.00002, radius));
check(
  "a wide tray pours about as fast as a beaker",
  pourFlow(0.0001, 0.085) > pourFlow(0.0001, radius) * 0.5,
  `tray=${pourFlow(0.0001, 0.085)} beaker=${pourFlow(0.0001, radius)}`,
);

const rim = lowestRim(tilt, radius, half);
check("rim is on the lip", Math.abs(rim.y - half) < 1e-6 && Math.abs(Math.hypot(rim.x, rim.z) - radius) < 1e-4);

const mixed = solution.solutionFromHex(0xff0000, 0.001, 1000);
solution.mixIn(mixed, 0, 0, 1, 1, 0.001);
check(
  "mix conserves volume and averages channels",
  Math.abs(mixed.volume - 0.002) < 1e-9 && Math.abs(mixed.r - 0.5) < 1e-9 && Math.abs(mixed.b - 0.5) < 1e-9,
  JSON.stringify(mixed),
);
const weighted = solution.solutionFromHex(0xff0000, 0.001, 3000);
solution.mixIn(weighted, 0, 0, 1, 1, 0.001);
check("mix weights channels by mass, not volume", Math.abs(weighted.r - 0.75) < 1e-9, JSON.stringify(weighted));
const diluted = solution.solutionFromHex(0x00ff00, 0.001, 1000);
const pure = solution.water(0.001);
solution.mixIn(diluted, pure.r, pure.g, pure.b, pure.mass, pure.volume);
check(
  "water dilutes without changing the hex",
  diluted.g === 1 && diluted.r === 0 && diluted.mass === 1 && Math.abs(diluted.volume - 0.002) < 1e-12,
  JSON.stringify(diluted),
);
check("fluid solution bridges to the chem sim", solution.toChem(diluted).hex === "#00FF00");

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const scene = new THREE.Scene();
const beakers = lab.createLab(scene, world);
const sim = fluid.createFluid(scene, beakers, null, new THREE.Vector3(3.5, 7, 2));

const source = beakers[0];
const target = beakers[1];
const start = source.solution.volume;
const startMass = source.solution.mass;
const others = beakers.slice(1).reduce((sum, beaker) => sum + beaker.solution.volume, 0);
const otherMass = beakers.slice(1).reduce((sum, beaker) => sum + beaker.solution.mass, 0);

source.body.setGravityScale(0, true);
source.body.setTranslation({ x: 0, y: 1.15, z: 0 }, true);
source.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.05), true);
source.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
source.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
world.step();

for (let i = 0; i < 20; i++) fluid.updateFluid(sim, world, 1 / 60);

const loose = () =>
  sim.droplets.reduce((sum, drop) => sum + drop.volume, 0) +
  sim.pending.reduce((sum, drop) => sum + drop.volume, 0) +
  sim.puddles.reduce((sum, puddle) => sum + puddle.volume, 0);

console.log(
  `pour probe source=${source.solution.volume.toExponential(3)} loose=${loose().toExponential(3)} puddles=${sim.puddles.filter((p) => p.volume > 0).length} drops=${sim.droplets.length}`,
);
const arc = sim.vessels[0].points.slice(0, sim.vessels[0].pointCount);
const spot = arc.find((point) => point.y < 0.85 && point.y > 0.35) ?? arc[Math.floor(arc.length / 2)] ?? null;
if (arc.length > 0) {
  console.log(`arc ${arc.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" | ")}`);
}
check("tilted beaker loses liquid", source.solution.volume < start * 0.85, `left=${source.solution.volume} start=${start}`);
const landed = arc[arc.length - 1];
check("stream hits a surface", !!landed && landed.y > 0.5, landed ? `end=${landed.y}` : "no arc");

if (spot) {
  source.solution.volume = start;
  source.solution.mass = startMass;
  for (const entry of sim.puddles) {
    entry.volume = 0;
    entry.mass = 0;
    entry.mesh.visible = false;
  }
  sim.droplets.length = 0;
  sim.pending.length = 0;
  for (const vessel of sim.vessels) vessel.dripDebt = 0;
  const beforeTarget = target.solution.volume;
  target.body.setTranslation(
    { x: spot.x, y: spot.y - target.height / 2 - 0.006, z: spot.z },
    true,
  );
  for (let i = 0; i < 90; i++) fluid.updateFluid(sim, world, 1 / 60);
  const gained = target.solution.volume - beforeTarget;
  console.log(
    `catch probe gained=${gained.toExponential(3)} source=${source.solution.volume.toExponential(3)} loose=${loose().toExponential(3)} spot=${spot.x.toFixed(3)},${spot.y.toFixed(3)},${spot.z.toFixed(3)}`,
  );
  check("stream is caught by the lower beaker", gained > start * 0.25, `gained=${gained}`);
} else {
  check("stream lands somewhere", false, "no puddle or droplet");
}

const accounted = beakers.reduce((sum, beaker) => sum + beaker.solution.volume, 0) + loose();
check(
  "volume is conserved",
  Math.abs(accounted - (start + others)) / (start + others) < 0.02,
  `accounted=${accounted} initial=${start + others}`,
);
const looseMass =
  sim.droplets.reduce((sum, drop) => sum + drop.mass, 0) +
  sim.pending.reduce((sum, drop) => sum + drop.mass, 0) +
  sim.puddles.reduce((sum, puddle) => sum + puddle.mass, 0);
const massAccounted = beakers.reduce((sum, beaker) => sum + beaker.solution.mass, 0) + looseMass;
check(
  "solute mass is conserved",
  Math.abs(massAccounted - (startMass + otherMass)) / (startMass + otherMass) < 0.02,
  `accounted=${massAccounted} initial=${startMass + otherMass}`,
);

{
  // A drop striking a beaker's rim runs off and puddles on the bench, not on the beaker.
  const rimmed = beakers[2];
  for (const entry of sim.puddles) {
    entry.volume = 0;
    entry.mass = 0;
  }
  sim.droplets.length = 0;
  sim.pending.length = 0;
  const at = rimmed.body.translation();
  const top = at.y + rimmed.height / 2;
  sim.droplets.push({
    x: at.x + rimmed.radius * 0.97, y: top + 0.05, z: at.z, vx: 0, vy: -0.5, vz: 0,
    volume: 0.00001, mass: 0.1, r: 1, g: 0, b: 0, age: 0, bounces: 0, ignore: null,
  });
  for (let i = 0; i < 90; i++) fluid.updateFluid(sim, world, 1 / 60);
  const landed = sim.puddles.filter((p) => p.volume > 0);
  const onRim = landed.some((p) => p.mesh.position.y > top - 0.02);
  check(
    "liquid on a rim runs off instead of pooling there",
    landed.length > 0 && !onRim,
    landed.map((p) => `y=${p.mesh.position.y.toFixed(3)}`).join(" ") + ` rim=${top.toFixed(3)}`,
  );
}

{
  const tray = beakers.find((beaker) => beaker.height < 0.04);
  const before = 0.0004;
  tray.solution.volume = before;
  tray.solution.mass = 4;
  tray.body.setGravityScale(0, true);
  tray.body.setTranslation({ x: 0.4, y: 1.2, z: 0.4 }, true);
  tray.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.7), true);
  tray.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  tray.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  for (let i = 0; i < 40; i++) fluid.updateFluid(sim, world, 1 / 60);
  const returned = tray.solution.volume;
  check(
    "a tilted tray empties instead of catching its own pour",
    returned < before * 0.35,
    `left=${returned} start=${before}`,
  );
}

{
  const puddle = sim.puddles.find((entry) => entry.volume <= 0);
  puddle.volume = 0.002;
  puddle.mass = 0;
  puddle.normal.set(0, 1, 0);
  puddle.mesh.position.set(0.72, 0.939, 0.15);
  fluid.updateFluid(sim, world, 1 / 60);
  const radius = puddle.mesh.scale.x;
  const edge = Math.max(
    Math.abs(puddle.mesh.position.x) + radius - 0.775,
    Math.abs(puddle.mesh.position.z + 0.2) + radius - 0.39,
  );
  check(
    "a puddle stays on the bench",
    edge < 0.01 && radius > 0.02,
    `radius=${radius.toFixed(3)} overhang=${edge.toFixed(3)}`,
  );
}

await vite.close();
if (failed > 0) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all checks passed");
