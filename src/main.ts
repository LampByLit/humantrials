import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { bindInput, input } from "./input";
import { createPlayer, DRINK_PITCH, playerCapsule, updatePlayer } from "./player";
import { createReach, updateReach } from "./reach";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createHands, updateHands } from "./hands";
import { createHold, updateHold } from "./hold";
import { createHandShadow, updateHandShadow } from "./handShadow";
import { createLab, syncBeakers } from "./lab";
import { dressLab } from "./dressing";
import { createFluid, updateFluid } from "./fluid/sim";
import { toChem } from "./fluid/solution";
import { createBlood, createBody, stepBody, swallow, type Blood, type Body, type Symptom } from "./sim/body";

await RAPIER.init();

const canvas = document.createElement("canvas");
document.body.prepend(canvas);
const prompt = document.getElementById("prompt")!;
const pourReadout = document.getElementById("pour")!;
const healthReadout = document.getElementById("health")!;
bindInput(canvas, prompt);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb7d4ea);
scene.fog = new THREE.Fog(0xe7eef2, 10, 20);

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.05, 40);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.integrationParameters.numSolverIterations = 16;

scene.add(new THREE.HemisphereLight(0xfff8f0, 0xd9c4a4, 1.45));
const sun = new THREE.DirectionalLight(0xfff6ea, 1.35);
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
const beakers = createLab(scene, world);
const [hands] = await Promise.all([createHands(world), dressLab(scene, world)]);
const reach = createReach(hands, player);
const hold = createHold();
const handShadow = createHandShadow(scene);
const fluid = createFluid(scene, beakers, envMap, sun.position);
const body = createBody(1);
const blood = createBlood();
const pourAnchor = new THREE.Vector3();
const pourUp = new THREE.Vector3();
const pourQuat = new THREE.Quaternion();

if (import.meta.env.DEV) {
  Object.assign(window, { game: { input, player, hands, reach, hold, beakers, fluid, world, body, blood } });
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
  updateHold(hold, hands, beakers, world, dt);
  world.step();
  syncBeakers(beakers);
  updateHandShadow(handShadow, world, hands, hold.grips[0]?.beaker.body);
  const pouring = input.space ? (hold.grips[0]?.beaker ?? null) : null;
  const drinker = player.pitch >= DRINK_PITCH ? playerCapsule(player) : null;
  updateFluid(fluid, world, dt, pouring, drinker);
  if (fluid.drunk.mass > 0) swallow(blood, toChem(fluid.drunk));
  renderHealth(healthReadout, body, blood, stepBody(body, blood, dt));
  if (pouring) {
    const at = pouring.body.translation();
    const rotation = pouring.body.rotation();
    pourQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
    pourUp.set(0, 1, 0).applyQuaternion(pourQuat);
    pourAnchor.set(at.x, at.y, at.z).addScaledVector(pourUp, pouring.height / 2 + 0.04);
    pourAnchor.project(camera);
    pourReadout.textContent = formatVolume(fluid.poured);
    pourReadout.style.left = `${(pourAnchor.x * 0.5 + 0.5) * window.innerWidth}px`;
    pourReadout.style.top = `${(-pourAnchor.y * 0.5 + 0.5) * window.innerHeight}px`;
    pourReadout.classList.toggle("show", pourAnchor.z < 1);
  } else {
    pourReadout.classList.remove("show");
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

function renderHealth(root: HTMLElement, body: Body, blood: Blood, symptoms: Symptom[]) {
  const organs = body.organs
    .map((organ) => {
      const symptom = symptoms.find((item) => item.organ === organ.name);
      const text = symptom ? symptom.text : "steady";
      const mark = ((organ.deflection + 1) * 50).toFixed(1);
      const integrity = Math.round(organ.integrity * 100);
      return `<div class="organ"><div class="name">${organ.name}</div><div class="track"><div class="mark" style="left:${mark}%"></div></div><div>${text}</div><div class="meta">integrity ${integrity}%</div></div>`;
    })
    .join("");
  const pending = blood.pending.length > 0 ? `<div class="pending">A dose is coming on</div>` : "";
  root.innerHTML = organs + pending;
}

function formatVolume(cubicMetres: number) {
  const millilitres = cubicMetres * 1e6;
  if (millilitres >= 1000) return `${(millilitres / 1000).toFixed(2)} L`;
  if (millilitres >= 100) return `${millilitres.toFixed(1)} mL`;
  return `${millilitres.toFixed(2)} mL`;
}
