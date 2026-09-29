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

const rim = lowestRim(tilt, radius, half);
check("rim is on the lip", Math.abs(rim.y - half) < 1e-6 && Math.abs(Math.hypot(rim.x, rim.z) - radius) < 1e-4);

const mixed = solution.solutionFromHex(0xff0000, 0.001);
solution.mixIn(mixed, 0, 0, 1, 0.001);
check(
  "mix conserves volume and averages channels",
  Math.abs(mixed.volume - 0.002) < 1e-9 && Math.abs(mixed.r - 0.5) < 1e-9 && Math.abs(mixed.b - 0.5) < 1e-9,
  JSON.stringify(mixed),
);

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const scene = new THREE.Scene();
const beakers = lab.createLab(scene, world);
const sim = fluid.createFluid(scene, beakers, null, new THREE.Vector3(3.5, 7, 2));

const source = beakers[0];
const target = beakers[1];
const start = source.solution.volume;
const others = beakers.slice(1).reduce((sum, beaker) => sum + beaker.solution.volume, 0);

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
  for (const entry of sim.puddles) {
    entry.volume = 0;
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

await vite.close();
if (failed > 0) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all checks passed");
