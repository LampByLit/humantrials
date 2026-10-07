import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { Capsule, FluidSim, Gulp } from "../fluid/sim";
import { input } from "../input";
import { addBox, DOOR_WIDTH, DOOR_X, ROOM_Z, type Beaker } from "../lab";
import { createRats } from "../rats";
import { replyTo, stateCard } from "./ask";
import { arrivalBrief, helloLine, lineDown, orderArrival, ratReplaceLine, rewardArrival, stillOnLine } from "./lines";
import { createLedger, submitSamples } from "./ledger";
import { createMemory, note, remember } from "./memory";
import { createPanel, type JanePanel } from "./panel";
import { createSpeaker } from "./speaker";
import { createWalker, type JaneJob } from "./walker";

export type JaneSession = {
  update(
    dt: number,
    held: Set<Beaker>,
    eye: { camera: THREE.Camera; x: number; y: number; z: number; hands: { x: number; y: number; z: number }[] },
  ): void;
  mouths(): Capsule[];
  feed(gulps: Gulp[]): void;
  stepRats(dt: number): void;
  carrying(): boolean;
  debug: {
    rush(faction: "green" | "blue"): void;
    skipWaits(): void;
  };
};

export function createSession(game: {
  scene: THREE.Scene;
  world: RAPIER.World;
  beakers: Beaker[];
  fluid: FluidSim;
  cast: { jane: GLTF; rat: GLTF; cage: GLTF };
  seed: number;
}): JaneSession {
  const ledger = createLedger(game.seed ^ 0x9e3779b9);
  const memory = createMemory();
  const speaker = createSpeaker();
  const rats = createRats(game.scene, game.world, game.cast.rat, game.cast.cage, game.seed);
  let asking = false;
  const jobs: { enqueue: (job: JaneJob) => void } = {
    enqueue: () => {},
  };
  const cue = document.getElementById("interact")!;
  const cuePoint = new THREE.Vector3();
  const buttonAt = { x: DOOR_X + DOOR_WIDTH / 2 + 0.55, y: 1.35, z: ROOM_Z - 0.16 };
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x2a2e32, roughness: 0.45, metalness: 0.45 });
  const cap = new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.42, metalness: 0.25, emissive: 0x000000 });
  addBox(game.scene, game.world, plateMat, 0.62, 0.78, 0.06, buttonAt.x, buttonAt.y, buttonAt.z);
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 28), cap);
  button.rotation.x = Math.PI / 2;
  const restZ = buttonAt.z - 0.08;
  button.position.set(buttonAt.x, buttonAt.y, restZ);
  button.castShadow = true;
  game.scene.add(button);
  let pressed = 0;
  let latched = false;
  const audio = { ctx: null as AudioContext | null };
  document.addEventListener("pointerdown", () => {
    if (!audio.ctx) audio.ctx = new AudioContext();
    void audio.ctx.resume();
  });

  let panel: JanePanel;
  const write = (text: string) => {
    panel.add("Jane", text);
    remember(memory, "jane", text);
  };
  const say = (text: string) => {
    write(text);
    speaker.say(text);
  };

  panel = createPanel((text) => {
    panel.add("You", text);
    remember(memory, "user", text);
    speaker.say(text, "player");
    const reply = replyTo(text, { ledger, rats: rats.summary(), introduced: memory.introduced });
    if (reply.effect?.type === "order") {
      jobs.enqueue({
        kind: "deliver",
        fill: reply.effect.fill,
        litres: reply.effect.litres,
        line: orderArrival(reply.effect.name, reply.effect.litres),
      });
      note(memory, `Ordered ${reply.effect.litres} L of ${reply.effect.name}.`);
    }
    if (reply.effect?.type === "reward") {
      jobs.enqueue({ kind: "deliver", fill: reply.effect.fill, litres: 1, line: rewardArrival(reply.effect.name) });
      note(memory, `Blue reward: 1 L of ${reply.effect.name}.`);
    }
    if (reply.intent === "local") {
      if (reply.text) say(reply.text);
      return;
    }
    void askModel(text);
  });

  const walker = createWalker(game.scene, game.world, game.beakers, game.fluid, game.cast.jane, {
    speak: write,
    report: (faction, samples) => {
      const result = submitSamples(ledger, faction, samples);
      note(memory, result.note);
      say(result.line);
    },
    revive: (index) => rats.revive(index),
    conceal: (index) => rats.conceal(index),
    tote: (index) => rats.tote(index),
    release: () => rats.release(),
    spot: (index) => rats.spot(index),
    greet() {
      if (memory.introduced) {
        say(helloLine());
        return;
      }
      memory.introduced = true;
      say(arrivalBrief(ledger.green, ledger.blue));
    },
  });
  jobs.enqueue = (job) => walker.enqueue(job);

  async function askModel(text: string) {
    if (asking) {
      say(stillOnLine());
      return;
    }
    asking = true;
    const pending = panel.add("Jane", "…");
    try {
      const response = await fetch("/api/jane", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history: memory.turns.slice(0, -1),
          text,
          state: stateCard(ledger, rats.summary(), memory),
        }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { text?: string };
      const line = (data.text ?? "").trim() || lineDown();
      panel.replace(pending, line);
      remember(memory, "jane", line);
      speaker.say(line);
    } catch {
      panel.replace(pending, lineDown());
      remember(memory, "jane", lineDown());
      speaker.say(lineDown());
    } finally {
      asking = false;
    }
  }

  let janeNear = false;
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.code !== "KeyE" || event.repeat || !input.playing || input.console) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (!janeNear) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      input.keys.delete("KeyE");
      if (janeNear) panel.open();
    },
    true,
  );

  function lowThud() {
    const ctx = audio.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(78, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(36, ctx.currentTime + 0.22);
    gain.gain.setValueAtTime(0.42, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.34);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
  }

  function pushButton(dt: number, hands: { x: number; y: number; z: number }[]) {
    let push = 0;
    for (const hand of hands) {
      if (Math.hypot(hand.x - buttonAt.x, hand.y - buttonAt.y) > 0.22) continue;
      if (hand.z < restZ - 0.14 || hand.z > restZ + 0.1) continue;
      push = Math.max(push, Math.min(1, (hand.z - (restZ - 0.05)) / 0.08));
    }
    pressed += (push - pressed) * (1 - Math.exp(-14 * dt));
    button.position.z = restZ + pressed * 0.06;
    cap.emissive.setHex(pressed > 0.2 ? 0x4a3b1c : 0x000000);
    if (pressed > 0.8 && !latched) {
      latched = true;
      lowThud();
      walker.summon();
    }
    if (pressed < 0.22) latched = false;
  }

  return {
    update(dt, held, eye) {
      for (const death of rats.claimDeaths()) {
        jobs.enqueue({ kind: "replace", index: death.index, line: ratReplaceLine(death.name, death.cause) });
        note(memory, `${death.name} died${death.cause ? `: ${death.cause}` : ""}.`);
      }
      walker.update(dt, held, {
        speaking: () => panel.isOpen() || speaker.speaking(),
        face: panel.isOpen() ? { x: eye.x, z: eye.z } : null,
      });
      panel.setLedger(ledger);
      pushButton(dt, eye.hands);
      janeNear = walker.here() && flatDistance(eye.x, eye.z, walker.place().x, walker.place().z) < 1.8;
      if (panel.isOpen() && !janeNear) panel.close();
      const mark = janeNear && !panel.isOpen() ? walker.place() : null;
      if (!mark || !input.playing) {
        cue.classList.remove("show");
      } else {
        cuePoint.set(mark.x, mark.y, mark.z).project(eye.camera);
        const onScreen = cuePoint.z < 1;
        cue.classList.toggle("show", onScreen);
        cue.style.left = `${(cuePoint.x * 0.5 + 0.5) * window.innerWidth}px`;
        cue.style.top = `${(-cuePoint.y * 0.5 + 0.5) * window.innerHeight}px`;
        cue.textContent = "E";
      }
    },
    mouths: () => rats.mouths(),
    feed(gulps) {
      for (const gulp of gulps) rats.feed(gulp.id, gulp.solution);
    },
    stepRats(dt) {
      rats.wade(game.fluid, dt);
      rats.step(dt);
    },
    carrying: () => walker.carrying(),
    debug: {
      rush: (faction) => walker.rush(faction),
      skipWaits: () => walker.skipWaits(),
    },
  };
}

function flatDistance(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(ax - bx, az - bz);
}
