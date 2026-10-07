function chunks(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (current && current.length + piece.length > 280) {
      out.push(current);
      current = piece;
    } else current = current ? `${current} ${piece}` : piece;
  }
  if (current) out.push(current);
  return out;
}

export type Voice = "jane" | "player";

const FEMALE = /\bfemale\b|zira|aria|jenny|samantha|libby|sonia|hazel|susan|karen|moira|tessa|victoria|emma|ava|michelle|google us english/i;
const MALE = /\bmale\b|david|mark|guy|ryan|george|daniel|james|christopher|eric|roger|thomas|alex|fred/i;

type Cast = { voice: SpeechSynthesisVoice | null; pitch: number };
let cast: Record<Voice, Cast> | null = null;

// Browsers fill the voice list asynchronously, so the first call can see none.
function voices(): Promise<SpeechSynthesisVoice[]> {
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 2000);
  });
}

async function castVoices(): Promise<Record<Voice, Cast>> {
  if (cast) return cast;
  const english = (await voices()).filter((item) => /^en/i.test(item.lang));
  const female = english.find((item) => FEMALE.test(item.name) && !MALE.test(item.name.replace(/female/i, "")));
  const male = english.find((item) => MALE.test(item.name) && !/female/i.test(item.name));
  const any = english[0] ?? null;
  const picked = {
    jane: { voice: female ?? any, pitch: female ? 1 : 1.4 },
    player: { voice: male ?? any, pitch: male ? 0.9 : 0.6 },
  };
  if (english.length) cast = picked;
  return picked;
}

async function fallback(text: string, voice: Voice): Promise<void> {
  if (!("speechSynthesis" in window)) return;
  const role = (await castVoices())[voice];
  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.96;
    utter.voice = role.voice;
    utter.pitch = role.pitch;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    speechSynthesis.speak(utter);
  });
}

function play(url: string): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    void audio.play().catch(() => resolve());
  });
}

export function createSpeaker() {
  const queue: { text: string; voice: Voice }[] = [];
  let busy = false;
  let piper = true;

  async function pump() {
    if (busy || queue.length === 0) return;
    busy = true;
    const item = queue.shift()!;
    try {
      if (!piper) throw new Error("piper off");
      const response = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      await play(url);
      URL.revokeObjectURL(url);
    } catch {
      piper = false;
      await fallback(item.text, item.voice);
    }
    busy = false;
    void pump();
  }

  return {
    say(text: string, voice: Voice = "jane") {
      for (const part of chunks(text)) queue.push({ text: part, voice });
      void pump();
    },
    speaking() {
      return busy || queue.length > 0;
    },
  };
}
