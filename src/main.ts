import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { bindInput, input } from "./input";
import { applyFeel, createPlayer, DRINK_PITCH, playerCapsule, updatePlayer } from "./player";
import { createReach, updateReach } from "./reach";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createHands, driveLeftHand, followLeftHand, settleHand, tintSkin, updateHands } from "./hands";
import { createHold, updateHold } from "./hold";
import { createHandShadow, updateHandShadow } from "./handShadow";
import { createLab, syncBeakers } from "./lab";
import { dressLab } from "./dressing";
import { createFluid, updateFluid } from "./fluid/sim";
import { toChem } from "./fluid/solution";
import { conditionOf, createBlood, createBody, stepBody, swallow, type Blood, type Body, type Symptom } from "./sim/body";
import { chemLabel } from "./sim/colorName";
import { senseOf, type Sense } from "./sim/reactions";
import { createTitle } from "./title";

const loading = document.getElementById("loading")!;
loading.textContent = "Loading physics";
await RAPIER.init();
loading.textContent = "Loading the laboratory";

const canvas = document.createElement("canvas");
document.body.prepend(canvas);
const prompt = document.getElementById("prompt")!;
const pourReadout = document.getElementById("pour")!;
const healthReadout = document.getElementById("health")!;
const veil = document.getElementById("veil")!;
bindInput(canvas, prompt);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb7d4ea);
scene.fog = new THREE.Fog(0xe7eef2, 16, 32);

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.05, 40);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.integrationParameters.numSolverIterations = 16;

// The hand light in handShadow.ts supplies the rest of the light on upward surfaces,
// and is the only light the hand blocks, so its shadow stays readable.
scene.add(new THREE.HemisphereLight(0xfff8f0, 0xd9c4a4, 1));
const sun = new THREE.DirectionalLight(0xfff6ea, 0.85);
sun.position.set(1.5, 7, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 20;
sun.shadow.camera.left = -10;
sun.shadow.camera.right = 10;
sun.shadow.camera.top = 10;
sun.shadow.camera.bottom = -10;
scene.add(sun);

const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const player = createPlayer(scene, world, camera);
const beakers = createLab(scene, world);
const [hands, , title] = await Promise.all([
  createHands(world),
  dressLab(scene, world),
  createTitle(renderer),
]);
loading.classList.add("hidden");
input.ready = true;
const reach = createReach(hands, player);
const hold = createHold();
const handShadow = createHandShadow(scene, camera, hands);
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
  title.resize();
});

let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  document.body.classList.toggle("playing", input.playing);

  if (!input.playing) {
    title.update(now / 1000);
    renderer.render(title.scene, title.camera);
    requestAnimationFrame(frame);
    return;
  }

  world.integrationParameters.dt = dt;
  const sense = senseOf(body.organs, blood.doses, body.alive);
  if (!body.alive || sense.operate < 0.12) {
    input.space = false;
    input.squeeze = false;
    input.gripLocked = false;
    input.pourX = 0;
    input.pourY = 0;
    if (!body.alive) {
      input.keys.clear();
      input.lookX = 0;
      input.lookY = 0;
    }
  }
  updatePlayer(player, world, dt, grounded, verticalVelocity, sense);
  updateReach(reach, hands, player, dt);
  player.object.updateMatrixWorld(true);
  updateHands(hands, beakers, dt, sense);
  settleHand(hands, world);
  driveLeftHand(hands, beakers, dt);
  updateHold(hold, hands, beakers, world, dt);
  world.step();
  followLeftHand(hands, beakers, world);
  syncBeakers(beakers);
  updateHandShadow(handShadow, hands);
  const pouring = input.space ? (hold.grips[0]?.beaker ?? null) : null;
  const drinker = body.alive && player.pitch >= DRINK_PITCH ? playerCapsule(player) : null;
  updateFluid(fluid, world, dt, pouring, drinker);
  if (body.alive && fluid.drunk.mass > 0) swallow(blood, toChem(fluid.drunk));
  const symptoms = stepBody(body, blood, dt);
  const felt = senseOf(body.organs, blood.doses, body.alive);
  applyFeel(player, felt);
  tintSkin(hands, felt);
  renderHealth(healthReadout, body, blood, symptoms);
  renderVeil(veil, canvas, felt, player.clock);
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

function renderVeil(root: HTMLElement, canvas: HTMLCanvasElement, sense: Sense, time: number) {
  const beat = sense.pound > 0 ? 0.5 + 0.5 * Math.sin(time * sense.rate * Math.PI * 2) : 0;
  const pulse = sense.pulse > 0 ? 0.35 + 0.65 * Math.sin(time * (2.2 + sense.pulse * 1.4)) : 1;
  const wash = Math.min(1, sense.wash * (0.65 + 0.35 * Math.abs(pulse)));
  const [r, g, b] = sense.tint;
  root.style.opacity = String(Math.min(1, Math.max(wash * 0.85, sense.vignette * 0.5) + beat * sense.pound * 0.22));
  root.style.background = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  const spread = 50 + sense.vignette * 220;
  const rim = Math.round(40 + sense.pound * beat * 180);
  root.style.boxShadow = `inset 0 0 ${spread}px ${16 + sense.vignette * 120}px rgba(${rim}, 0, 0, ${0.25 + sense.vignette * 0.7})`;
  const filter = [
    sense.blur > 0.03 ? `blur(${(sense.blur * 3.6).toFixed(2)}px)` : "",
    sense.pulse > 0.15 ? `hue-rotate(${(Math.sin(time * 2.4) * sense.pulse * 70).toFixed(1)}deg) saturate(${(1 + sense.pulse).toFixed(2)})` : "",
    sense.pound > 0.2 ? `contrast(${(1 + beat * sense.pound * 0.35).toFixed(2)})` : "",
  ].filter(Boolean);
  canvas.style.filter = filter.join(" ");
}

function renderHealth(root: HTMLElement, body: Body, blood: Blood, symptoms: Symptom[]) {
  const condition = conditionOf(body, symptoms);
  root.className = condition;
  const headline = body.cause
    ? body.cause
    : symptoms.length > 0
      ? symptoms.map((symptom) => symptom.text).join(" · ")
      : "Nothing in the blood is moving you.";
  const failing =
    body.alive && body.critical > 0
      ? `<div class="failing">Heart or breathing failing for ${body.critical.toFixed(1)}s</div>`
      : "";
  const organs = body.organs
    .map((organ) => {
      const symptom = symptoms.find((item) => item.organ === organ.name);
      const text = symptom ? `${symptom.band} · ${symptom.text}` : "steady";
      const mark = ((organ.deflection + 1) * 50).toFixed(1);
      const signed = `${organ.deflection >= 0 ? "+" : ""}${organ.deflection.toFixed(2)}`;
      const integrity = Math.round(organ.integrity * 100);
      return `<div class="organ"><div class="name">${organ.name}<span>${signed}</span></div><div class="track"><div class="mark" style="left:${mark}%"></div></div><div>${text}</div><div class="integrity"><div style="width:${integrity}%"></div></div><div class="meta">integrity ${integrity}%</div></div>`;
    })
    .join("");
  const circulating = tally(blood.doses);
  const bloodLines =
    circulating.length === 0
      ? `<div class="meta">Blood is clear</div>`
      : circulating
          .map((dose) => `<div class="dose"><i style="background:${dose.hex}"></i><span>${chemLabel(dose.hex)}</span><b>${formatMass(dose.mass)}</b></div>`)
          .join("");
  const pending =
    blood.pending.length === 0
      ? ""
      : `<div class="section">Coming on</div>` +
        blood.pending
          .map(
            (dose) =>
              `<div class="dose"><i style="background:${dose.hex}"></i><span>${chemLabel(dose.hex)}</span><b>${formatMass(dose.mass)} · ${Math.max(0, dose.left).toFixed(1)}s</b></div>`,
          )
          .join("");
  root.innerHTML = `<div class="condition">${condition}</div><div class="headline">${headline}</div>${failing}${organs}<div class="section">In the blood</div>${bloodLines}${pending}`;
}

function tally(doses: { hex: string; mass: number }[]) {
  const order: string[] = [];
  const mass = new Map<string, number>();
  for (const dose of doses) {
    if (!mass.has(dose.hex)) order.push(dose.hex);
    mass.set(dose.hex, (mass.get(dose.hex) ?? 0) + dose.mass);
  }
  return order.map((hex) => ({ hex, mass: mass.get(hex)! }));
}

function formatMass(mass: number) {
  if (mass >= 10) return mass.toFixed(1);
  if (mass >= 1) return mass.toFixed(2);
  return mass.toFixed(3);
}

function formatVolume(cubicMetres: number) {
  const millilitres = cubicMetres * 1e6;
  if (millilitres >= 1000) return `${(millilitres / 1000).toFixed(2)} L`;
  if (millilitres >= 100) return `${millilitres.toFixed(1)} mL`;
  return `${millilitres.toFixed(2)} mL`;
}
