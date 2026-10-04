import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { bindInput, input } from "./input";
import { applyFeel, createPlayer, DRINK_PITCH, playerCapsule, updatePlayer } from "./player";
import { createReach, updateReach } from "./reach";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createHands, driveLeftHand, followLeftHand, settleHand, tintSkin, updateHands, type Hands } from "./hands";
import { createHold, updateHold } from "./hold";
import { createHandShadow, updateHandShadow } from "./handShadow";
import { createLab, readIntake, syncBeakers, type Beaker } from "./lab";
import { dressLab } from "./dressing";
import { createFluid, updateFluid } from "./fluid/sim";
import { toChem } from "./fluid/solution";
import { abilityNotes, bloodCard, organClass, organTone, receiptCard, symptomCard, tracePolyline, traceSamples, vitalReadout } from "./healthHud";
import { createAffect, stepAffect } from "./sim/affect";
import { createBlood, createBody, pilotOpen, stepBody, swallow, symptomsFrom, type Blood, type OrganName } from "./sim/body";
import { chemLabel, isCatalog } from "./sim/colorName";
import { senseOf, type Sense } from "./sim/reactions";
import { createTitle } from "./title";
import { applyTheme, dark } from "./theme";

const loading = document.getElementById("loading")!;
loading.textContent = "Loading physics";
await RAPIER.init();
loading.textContent = "Loading the laboratory";

const canvas = document.createElement("canvas");
document.body.prepend(canvas);
const prompt = document.getElementById("prompt")!;
const pourReadout = document.getElementById("pour")!;
const eyeReadout = document.getElementById("eyed")!;
const organMarks: Record<OrganName, SVGElement> = {
  heart: document.querySelector("#organ-heart") as SVGElement,
  brain: document.querySelector("#organ-brain") as SVGElement,
  liver: document.querySelector("#organ-liver") as SVGElement,
};
const vitalPulse = document.getElementById("vital-pulse")!;
const vitalBreath = document.getElementById("vital-breath")!;
const vitalTemp = document.getElementById("vital-temp")!;
const vitalClear = document.getElementById("vital-clear")!;
const waves: Record<OrganName, SVGPolylineElement> = {
  heart: document.querySelector("#wave-heart") as SVGPolylineElement,
  brain: document.querySelector("#wave-brain") as SVGPolylineElement,
  liver: document.querySelector("#wave-liver") as SVGPolylineElement,
};
const hurts: Record<OrganName, HTMLElement> = {
  heart: document.getElementById("hurt-heart")!,
  brain: document.getElementById("hurt-brain")!,
  liver: document.getElementById("hurt-liver")!,
};
const traces: Record<OrganName, HTMLElement> = {
  heart: document.getElementById("trace-heart")!,
  brain: document.getElementById("trace-brain")!,
  liver: document.getElementById("trace-liver")!,
};
const symptoms = document.getElementById("symptoms")!;
const bloodReadout = document.getElementById("blood")!;
const affectReadout = document.getElementById("affect")!;
const abilities = document.getElementById("abilities")!;
const affect = createAffect();
const receipt = document.getElementById("receipt")!;
const veil = document.getElementById("veil")!;
const restart = document.getElementById("restart") as HTMLButtonElement;
restart.addEventListener("click", () => location.reload());
bindInput(canvas, prompt);

const hud = document.getElementById("hud")!;
const hudToggle = document.getElementById("hud-toggle")!;
const setHudOpen = (open: boolean) => {
  hud.classList.toggle("collapsed", !open);
  hudToggle.setAttribute("aria-expanded", String(open));
};
hudToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  setHudOpen(hud.classList.contains("collapsed"));
});
document.addEventListener("keydown", (event) => {
  if (event.code !== "KeyC" || event.repeat || !input.playing) return;
  setHudOpen(hud.classList.contains("collapsed"));
});

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf7f7f5);
scene.fog = new THREE.Fog(0xf3f3f1, 20, 46);

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.05, 40);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.integrationParameters.numSolverIterations = 16;

// The hand light in handShadow.ts supplies the rest of the light on upward surfaces,
// and is the only light the hand blocks, so its shadow stays readable.
scene.add(new THREE.HemisphereLight(0xfff8f0, 0xd9c4a4, 1));
const hemi = scene.children.at(-1) as THREE.HemisphereLight;
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
applyTheme(false, { scene, hemi, sun });

const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const player = createPlayer(scene, world, camera);
const beakers = createLab(scene, world);
const [hands, , title] = await Promise.all([
  createHands(world),
  dressLab(scene, world, beakers),
  createTitle(renderer),
]);
const reach = createReach(hands, player);
const hold = createHold();
const handShadow = createHandShadow(scene, camera, hands);
const fluid = createFluid(scene, beakers, envMap, sun.position);
const body = createBody(1);
const blood = createBlood();
const pourAnchor = new THREE.Vector3();
const pourUp = new THREE.Vector3();
const pourQuat = new THREE.Quaternion();

// The title only appears once the lab has been drawn, so the first click is not
// waiting on shader and shadow compilation.
await renderer.compileAsync(scene, camera);
renderer.render(scene, camera);
loading.classList.add("hidden");
input.ready = true;

if (import.meta.env.DEV) {
  Object.assign(window, { game: { input, player, hands, reach, hold, beakers, fluid, world, body, blood, affect } });
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
  document.body.classList.toggle("dead", input.dead);

  if (!input.playing) {
    title.update(now / 1000);
    renderer.render(title.scene, title.camera);
    requestAnimationFrame(frame);
    return;
  }

  if (input.themeToggle) {
    input.themeToggle = false;
    applyTheme(!dark, { scene, hemi, sun });
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
      input.dead = true;
      input.keys.clear();
      input.lookX = 0;
      input.lookY = 0;
      if (document.pointerLockElement) document.exitPointerLock();
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
  readIntake();
  showEyes(eyeReadout, camera, hands, beakers, blood);
  if (body.alive && fluid.drunk.mass > 0) swallow(blood, toChem(fluid.drunk));
  stepBody(body, blood, dt);
  if (body.alive) stepAffect(affect, blood.doses, dt);
  const felt = senseOf(body.organs, blood.doses, body.alive);
  applyFeel(player, felt);
  tintSkin(hands, felt);
  renderHealth(body, blood, felt.rate, player.clock);
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

const eyePoint = new THREE.Vector3();

function showEyes(root: HTMLElement, camera: THREE.PerspectiveCamera, hands: Hands, beakers: Beaker[], blood: Blood) {
  const found = nearestStock(hands, beakers);
  if (!found) {
    root.classList.remove("show");
    return;
  }
  const sample = toChem(found.solution);
  const known = sample.mass > 1e-8 && (isCatalog(sample.hex) || pilotOpen(blood));
  if (!known) {
    root.classList.remove("show");
    return;
  }
  const at = found.body.translation();
  eyePoint.set(at.x, at.y + found.height / 2 + 0.03, at.z).project(camera);
  root.textContent = chemLabel(sample.hex);
  root.style.left = `${(eyePoint.x * 0.5 + 0.5) * window.innerWidth}px`;
  root.style.top = `${(-eyePoint.y * 0.5 + 0.5) * window.innerHeight}px`;
  root.classList.toggle("show", eyePoint.z < 1);
}

function nearestStock(hands: Hands, beakers: Beaker[]): Beaker | null {
  let best = 0.045;
  let found: Beaker | null = null;
  const consider = (bone: THREE.Object3D) => {
    bone.getWorldPosition(eyePoint);
    for (const beaker of beakers) {
      if (beaker.fixed || beaker.solution.volume <= 1e-7) continue;
      const at = beaker.body.translation();
      const radial = Math.hypot(eyePoint.x - at.x, eyePoint.z - at.z) - beaker.radius;
      const vertical = Math.abs(eyePoint.y - at.y) - beaker.height / 2;
      const gap = Math.max(radial, vertical);
      if (gap < best) {
        best = gap;
        found = beaker;
      }
    }
  };
  consider(hands.arm.fingertip);
  if (hands.left.solid) consider(hands.left.fingertip);
  return found;
}

function renderVeil(root: HTMLElement, canvas: HTMLCanvasElement, sense: Sense, time: number) {
  const beat = sense.pound > 0 ? 0.5 + 0.5 * Math.sin(time * sense.rate * Math.PI * 2) : 0;
  const pulse = sense.pulse > 0 ? 0.35 + 0.65 * Math.sin(time * (2.2 + sense.pulse * 1.4)) : 1;
  const wash = Math.min(1, sense.wash * (0.65 + 0.35 * Math.abs(pulse)));
  const [r, g, b] = sense.tint;
  const red = Math.round(r * 255);
  const green = Math.round(g * 255);
  const blue = Math.round(b * 255);
  const spread = 50 + sense.vignette * 220 + sense.drift * 80;
  const rim = Math.round(40 + sense.pound * beat * 180);
  root.style.boxShadow = `inset 0 0 ${spread}px ${16 + sense.vignette * 120 + sense.mud * 40}px rgba(${rim}, 0, 0, ${0.25 + sense.vignette * 0.7 + sense.mud * 0.25})`;
  const trip = sense.trip;
  const wild = trip > 2.4;
  if (trip > 0.18) {
    const spin = (time * (14 + trip * (wild ? 70 : 28))) % 360;
    const fringe = Math.min(0.9, 0.12 + trip * (wild ? 0.18 : 0.1)).toFixed(2);
    const wedge = wild ? 7 : 16;
    const x = 50 + Math.sin(time * (0.7 + trip * 0.5)) * (wild ? 28 : 16);
    const y = 46 + Math.cos(time * (0.55 + trip * 0.35)) * (wild ? 24 : 14);
    root.style.mixBlendMode = "screen";
    root.style.opacity = String(Math.min(wild ? 0.96 : 0.7, 0.22 + trip * (wild ? 0.16 : 0.22)));
    root.style.filter = wild ? `hue-rotate(${(Math.sin(time * (3 + trip)) * 140).toFixed(0)}deg) saturate(2.4)` : "";
    const bands = [
      `radial-gradient(circle at ${x.toFixed(1)}% ${y.toFixed(1)}%, rgba(${red}, ${green}, ${blue}, ${fringe}), transparent ${wild ? 28 : 46}%)`,
      `radial-gradient(circle at ${(100 - x).toFixed(1)}% ${(100 - y).toFixed(1)}%, rgba(${255 - red}, ${green}, ${255 - blue}, ${(Number(fringe) * 0.8).toFixed(2)}), transparent 40%)`,
      `repeating-conic-gradient(from ${spin.toFixed(1)}deg at 50% 50%, transparent 0 ${wedge}deg, rgba(${red}, ${255 - green}, ${blue}, ${(Number(fringe) * (wild ? 0.72 : 0.38)).toFixed(2)}) ${wedge}deg ${wedge + (wild ? 3 : 2)}deg)`,
    ];
    if (wild) {
      const spin2 = (time * (40 + trip * 20)) % 360;
      bands.push(
        `repeating-conic-gradient(from ${spin2.toFixed(1)}deg at ${x.toFixed(1)}% ${y.toFixed(1)}%, transparent 0 11deg, rgba(${255 - blue}, ${red}, ${255 - green}, 0.45) 11deg 13deg)`,
      );
    }
    root.style.background = bands.join(", ");
  } else {
    root.style.mixBlendMode = "multiply";
    root.style.filter = "";
    root.style.opacity = String(Math.min(1, Math.max(wash * 0.85, sense.vignette * 0.5) + beat * sense.pound * 0.22));
    root.style.background = `rgb(${red}, ${green}, ${blue})`;
  }
  let contrast = 1;
  if (sense.pound > 0.2) contrast += beat * sense.pound * 0.35;
  if (sense.mud > 0.12) contrast += Math.sin(time * 11) * sense.mud * 0.22;
  if (wild) contrast += 0.35 + Math.sin(time * (4 + trip)) * 0.45;
  const flash = wild && Math.sin(time * (6 + trip * 0.4)) > 0.94 ? 0.55 : 0;
  const filter = [
    sense.blur > 0.03 ? `blur(${(sense.blur * 3.6).toFixed(2)}px)` : "",
    trip > 0.12
      ? `hue-rotate(${(Math.sin(time * (0.6 + trip * (wild ? 2.6 : 1.05))) * trip * (wild ? 95 : 55)).toFixed(1)}deg) saturate(${(1 + Math.min(trip, 4.2) * (wild ? 2.3 : 1.35)).toFixed(2)})`
      : "",
    sense.pulse > 0.15 ? `hue-rotate(${(Math.sin(time * 2.4) * sense.pulse * 70).toFixed(1)}deg) saturate(${(1 + sense.pulse).toFixed(2)})` : "",
    sense.mud > 0.12 ? `grayscale(${(sense.mud * 0.55).toFixed(2)})` : "",
    flash > 0 ? `invert(${flash.toFixed(2)})` : "",
    contrast !== 1 ? `contrast(${contrast.toFixed(2)})` : "",
  ].filter(Boolean);
  canvas.style.filter = filter.join(" ");
  const warpAmp = Math.min(wild ? 0.24 : 0.08, trip * 0.028 + sense.drift * (wild ? 0.08 : 0.04));
  const warp =
    Math.sin(time * (0.45 + trip * (wild ? 1.8 : 0.7))) * warpAmp +
    Math.sin(time * (2.4 + trip)) * (wild ? warpAmp * 0.45 : 0);
  canvas.style.transform = Math.abs(warp) > 0.002 ? `scale(${(1 + warp).toFixed(4)})` : "";
}

let receiptWritten = false;

function renderHealth(body: ReturnType<typeof createBody>, blood: Blood, rate: number, time: number) {
  if (!body.alive) {
    if (!receiptWritten) {
      receipt.innerHTML = receiptCard(body, blood);
      receiptWritten = true;
    }
    return;
  }
  const heart = body.organs.find((organ) => organ.name === "heart")!;
  const brain = body.organs.find((organ) => organ.name === "brain")!;
  const liver = body.organs.find((organ) => organ.name === "liver")!;
  for (const organ of body.organs) {
    const tone = organTone(organ, time);
    const mark = organMarks[organ.name];
    mark.style.fill = tone.fill;
    mark.style.opacity = String(tone.opacity);
    mark.style.filter = tone.glow;
    traces[organ.name].className = organClass(organ);
    waves[organ.name].setAttribute("points", tracePolyline(traceSamples(organ.name, organ.deflection, organ.integrity, time)));
    hurts[organ.name].style.width = `${Math.max(0, Math.min(1, organ.integrity)) * 100}%`;
  }
  const vitals = vitalReadout(true, heart.deflection, brain.deflection, rate, liver.deflection);
  vitalPulse.textContent = vitals.pulse;
  vitalBreath.textContent = vitals.breath;
  vitalTemp.textContent = vitals.temp;
  vitalClear.textContent = vitals.clear;
  const symptomHtml = symptomCard(symptomsFrom(body.organs));
  if (symptoms.dataset.card !== symptomHtml) {
    symptoms.dataset.card = symptomHtml;
    symptoms.innerHTML = symptomHtml;
  }
  const bloodHtml = bloodCard(blood);
  if (bloodReadout.dataset.card !== bloodHtml) {
    bloodReadout.dataset.card = bloodHtml;
    bloodReadout.innerHTML = bloodHtml;
  }
  if (affectReadout.textContent !== (affect.line ?? "")) affectReadout.textContent = affect.line ?? "";
  const notes = abilityNotes(pilotOpen(blood));
  const key = notes.join("|");
  if (abilities.dataset.notes !== key) {
    abilities.dataset.notes = key;
    abilities.replaceChildren(
      ...notes.map((text) => {
        const note = document.createElement("div");
        note.className = "ability";
        note.textContent = text;
        return note;
      }),
    );
  }
}

function formatVolume(cubicMetres: number) {
  const millilitres = cubicMetres * 1e6;
  if (millilitres >= 1000) return `${(millilitres / 1000).toFixed(2)} L`;
  if (millilitres >= 100) return `${millilitres.toFixed(1)} mL`;
  return `${millilitres.toFixed(2)} mL`;
}
