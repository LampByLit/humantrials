import { chemLabel } from "./sim/colorName";
import type { Blood, Body, Organ, OrganName, Symptom } from "./sim/body";

const TRACE_SAMPLES = 72;
const TRACE_WIDTH = 128;
const TRACE_MID = 14;

const CALM: readonly [number, number, number] = [214, 206, 190];
const HOT: readonly [number, number, number] = [226, 78, 58];
const COLD: readonly [number, number, number] = [78, 148, 214];

export function organTone(organ: Pick<Organ, "deflection" | "integrity">, time: number) {
  const mag = Math.min(1, Math.abs(organ.deflection));
  const toward = organ.deflection >= 0 ? HOT : COLD;
  const hurt = 1 - Math.min(1, Math.max(0, organ.integrity));
  const rgb = CALM.map((channel, index) => {
    const mixed = channel + (toward[index] - channel) * mag;
    return Math.round(mixed * (1 - hurt * 0.5));
  });
  const failing = mag >= 0.95 || organ.integrity <= 0;
  const beat = failing ? 0.84 + 0.16 * Math.sin(time * 8) : 1;
  return {
    fill: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    opacity: (0.62 + mag * 0.38) * beat,
    glow: failing ? `drop-shadow(0 0 3px rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]}))` : "none",
  };
}

export function organClass(organ: Pick<Organ, "deflection" | "integrity">) {
  const mag = Math.abs(organ.deflection);
  const tokens = ["trace"];
  if (organ.integrity < 0.85) tokens.push("hurt");
  if (organ.integrity <= 0.12 || mag >= 0.95) tokens.push("fail");
  if (mag < 0.25) return tokens.join(" ");
  tokens.push(organ.deflection > 0 ? "up" : "down");
  if (mag < 0.5) tokens.push("mild");
  else if (mag < 0.75) tokens.push("moderate");
  else tokens.push("severe");
  return tokens.join(" ");
}

export function symptomClass(symptom: Pick<Symptom, "direction" | "band">) {
  return `symptom ${symptom.direction} ${symptom.band}`;
}

export function vitalReadout(alive: boolean, heart: number, brain: number, rate: number, liver = 0) {
  if (!alive) return { pulse: "—", breath: "—", temp: "—", clear: "—" };
  const clear = liver >= 0.25 ? "Fast" : liver <= -0.25 ? "Slow" : "Steady";
  return {
    pulse: String(Math.round(rate * 60)),
    breath: String(Math.max(4, Math.round(14 + brain * 8))),
    temp: `${(37 + heart * 1.6).toFixed(1)}°`,
    clear,
  };
}

export function traceSamples(name: OrganName, deflection: number, integrity: number, time: number) {
  const failing = integrity <= 0.08;
  const span = name === "heart" ? 2.4 / heartHz(deflection) : name === "brain" ? 1.8 : 3.4;
  const samples: number[] = [];
  for (let i = 0; i < TRACE_SAMPLES; i++) {
    const t = time - ((TRACE_SAMPLES - 1 - i) / (TRACE_SAMPLES - 1)) * span;
    samples.push(sampleWave(name, deflection, integrity, t, failing));
  }
  return samples;
}

export function tracePolyline(samples: readonly number[]) {
  return samples
    .map((y, index) => {
      const x = (index / (samples.length - 1)) * TRACE_WIDTH;
      const py = TRACE_MID - Math.max(-1.15, Math.min(1.15, y)) * 11;
      return `${x.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
}

function heartHz(deflection: number) {
  return Math.max(0.35, 1.15 + deflection * 1.7);
}

function sampleWave(name: OrganName, deflection: number, integrity: number, time: number, failing: boolean) {
  if (failing) return Math.sin(time * 1.3) > 0.93 ? 0.55 : 0;
  const body = 0.4 + 0.6 * Math.max(0, Math.min(1, integrity));
  if (name === "heart") {
    const hz = heartHz(deflection);
    const wobble = deflection >= 0.75 ? 1 + 0.34 * Math.sin(time * 5.4) : deflection <= -0.75 ? 1 + 0.16 * Math.sin(time * 1.4) : 1;
    const phase = time * hz * wobble;
    let beat = heartBeat(phase);
    for (const nudge of [0.02, 0.04]) {
      const next = heartBeat(phase + nudge);
      if (Math.abs(next) > Math.abs(beat)) beat = next;
    }
    return beat * (0.82 + Math.min(1, Math.abs(deflection)) * 0.22) * body;
  }
  if (name === "brain") {
    const freq = 1.15 * (1 + 1.35 * Math.max(0, deflection)) * (1 - 0.62 * Math.max(0, -deflection));
    let y = Math.sin(time * freq * Math.PI * 2) * 0.34 + Math.sin(time * freq * 2.15 * Math.PI * 2) * 0.12;
    if (deflection >= 0.75 && Math.sin(time * 3.2) > 0.78) y += 0.55;
    if (deflection <= -0.75) y *= 0.35;
    return y * body;
  }
  const freq = 0.55 * (1 + 0.65 * Math.max(-0.35, deflection));
  let y = Math.sin(time * Math.max(0.22, freq) * Math.PI * 2) * 0.58;
  if (deflection <= -0.5) y = Math.sin(time * Math.PI * 2 * 0.7) * 0.22 - 0.08;
  return y * body;
}

function heartBeat(phase: number) {
  const x = ((phase % 1) + 1) % 1;
  if (x < 0.08) return 0;
  if (x < 0.2) return Math.sin(((x - 0.08) / 0.12) * Math.PI) * 0.18;
  if (x < 0.3) return 0;
  if (x < 0.36) return -0.28 * ((x - 0.3) / 0.06);
  if (x < 0.46) return -0.28 + 1.48 * ((x - 0.36) / 0.1);
  if (x < 0.56) return 1.2 - 1.58 * ((x - 0.46) / 0.1);
  if (x < 0.62) return -0.38 + 0.38 * ((x - 0.56) / 0.06);
  if (x < 0.68) return 0;
  if (x < 0.88) return Math.sin(((x - 0.68) / 0.2) * Math.PI) * 0.36;
  return 0;
}

export function symptomCard(symptoms: readonly Symptom[]) {
  if (!symptoms.length) return "";
  const lines = symptoms
    .map((symptom) => `<div class="${symptomClass(symptom)}">${escapeHtml(symptom.text)}</div>`)
    .join("");
  return `<div class="label">Symptoms</div>${lines}`;
}

export function bloodCard(blood: Blood) {
  const circulating = tally(blood.doses).sort((a, b) => b.mass - a.mass).slice(0, 4);
  const waiting = tally(blood.pending.map((dose) => ({ hex: dose.hex, mass: dose.mass })))
    .sort((a, b) => b.mass - a.mass)
    .slice(0, 3);
  const lines = circulating
    .map((dose) => {
      const width = Math.max(4, Math.min(100, (dose.mass / 0.25) * 100));
      return `<div class="dose"><i style="background:${escapeHtml(dose.hex)}"></i><span>${escapeHtml(chemLabel(dose.hex))}</span><span class="level"><b style="width:${width.toFixed(0)}%"></b></span><em>${formatMass(dose.mass)}</em></div>`;
    })
    .join("");
  const onset = waiting
    .map(
      (dose) =>
        `<div class="dose onset"><i style="background:${escapeHtml(dose.hex)}"></i><span>${escapeHtml(chemLabel(dose.hex))}</span><span class="level"></span><em>onset</em></div>`,
    )
    .join("");
  const body = lines || onset ? `${lines}${onset}` : `<div class="empty">Clear</div>`;
  return `<div class="label">Blood</div>${body}`;
}

export function abilityNotes(pilot: boolean) {
  const notes: string[] = [];
  if (pilot) notes.push("Pilot eyes");
  return notes;
}

export function receiptCard(body: Body, blood: Blood) {
  const lines = tally(blood.doses)
    .map(
      (dose) =>
        `<div class="line"><i style="background:${escapeHtml(dose.hex)}"></i><span>${escapeHtml(chemLabel(dose.hex))}</span><b>${formatMass(dose.mass)}</b></div>`,
    )
    .join("");
  const waiting = blood.pending
    .map(
      (dose) =>
        `<div class="line"><i style="background:${escapeHtml(dose.hex)}"></i><span>${escapeHtml(chemLabel(dose.hex))}</span><b>${formatMass(dose.mass)}</b></div>`,
    )
    .join("");
  const found = lines || `<div class="empty">Blood was clear</div>`;
  const onset = waiting ? `<div class="rule"></div><div class="sub">Still coming on</div>${waiting}` : "";
  return `<div class="shop">Human Trials</div><div class="sub">Toxicology</div><div class="rule"></div>${found}${onset}<div class="rule"></div><div class="sub">Cause of death</div><div class="cause">${escapeHtml(body.cause ?? "unknown")}</div>`;
}

function tally(doses: { hex: string; mass: number }[]) {
  const order: string[] = [];
  const mass = new Map<string, number>();
  for (const dose of doses) {
    const hex = dose.hex.toUpperCase();
    if (!mass.has(hex)) order.push(hex);
    mass.set(hex, (mass.get(hex) ?? 0) + dose.mass);
  }
  return order.map((hex) => ({ hex, mass: mass.get(hex)! }));
}

function formatMass(mass: number) {
  if (mass >= 10) return mass.toFixed(1);
  if (mass >= 1) return mass.toFixed(2);
  return mass.toFixed(3);
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}
