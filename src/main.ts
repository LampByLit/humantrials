import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { bindInput, input } from "./input";
import { createPlayer, updatePlayer } from "./player";
import { createReach, updateReach } from "./reach";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createHands, updateHands } from "./hands";
import { createHold, updateHold } from "./hold";
import { createLab, syncBeakers } from "./lab";
import { createFluid, updateFluid } from "./fluid/sim";

await RAPIER.init();

const canvas = document.createElement("canvas");
document.body.prepend(canvas);
const prompt = document.getElementById("prompt")!;
bindInput(canvas, prompt);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9edf0);
scene.fog = new THREE.Fog(0xe9edf0, 9, 18);

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.05, 40);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.integrationParameters.numSolverIterations = 10;

scene.add(new THREE.HemisphereLight(0xf4f7fa, 0xb9bec4, 1.25));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(1.5, 7, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 18;
sun.shadow.camera.left = -6;
sun.shadow.camera.right = 6;
sun.shadow.camera.top = 6;
sun.shadow.camera.bottom = -6;
scene.add(sun);

const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const player = createPlayer(scene, world, camera);
const hands = await createHands(world);
const reach = createReach(hands, player);
const beakers = createLab(scene, world);
const hold = createHold();
const fluid = createFluid(scene, beakers, envMap, sun.position);

if (import.meta.env.DEV) {
  Object.assign(window, { game: { input, player, hands, reach, hold, beakers, fluid, world } });
}

const grounded = { value: true };
const verticalVelocity = { value: 0 };

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  world.integrationParameters.dt = dt;
  updatePlayer(player, world, dt, grounded, verticalVelocity);
  updateReach(reach, hands, player, dt);
  player.object.updateMatrixWorld(true);
  updateHands(hands, dt);
  updateHold(hold, hands, beakers, dt);
  world.step();
  syncBeakers(beakers);
  updateFluid(fluid, world, dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
