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

function fallback(text: string, voice: Voice): Promise<void> {
  if (!("speechSynthesis" in window)) return Promise.resolve();
  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.96;
    const voices = speechSynthesis.getVoices();
    const english = (name: RegExp) => voices.find((item) => /^en/i.test(item.lang) && name.test(item.name));
    if (voice === "player") {
      const male = english(/david|mark|guy|ryan|george|daniel|james|male/i);
      utter.voice = male ?? voices.find((item) => /^en/i.test(item.lang)) ?? null;
      utter.pitch = male ? 0.92 : 0.72;
    } else {
      utter.voice =
        english(/female|zira|samantha|jenny|libby|aria/i) ?? voices.find((item) => /^en/i.test(item.lang)) ?? null;
      utter.pitch = 0.9;
    }
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

  async function pump() {
    if (busy || queue.length === 0) return;
    busy = true;
    const item = queue.shift()!;
    try {
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
