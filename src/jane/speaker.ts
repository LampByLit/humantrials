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

function fallback(text: string): Promise<void> {
  if (!("speechSynthesis" in window)) return Promise.resolve();
  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.96;
    utter.pitch = 0.9;
    const voices = speechSynthesis.getVoices();
    utter.voice =
      voices.find((voice) => /en/i.test(voice.lang) && /female|zira|samantha|jenny|libby/i.test(voice.name)) ??
      voices.find((voice) => /^en/i.test(voice.lang)) ??
      null;
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
  const queue: string[] = [];
  let busy = false;

  async function pump() {
    if (busy || queue.length === 0) return;
    busy = true;
    const text = queue.shift()!;
    try {
      const response = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      await play(url);
      URL.revokeObjectURL(url);
    } catch {
      await fallback(text);
    }
    busy = false;
    void pump();
  }

  return {
    say(text: string) {
      for (const part of chunks(text)) queue.push(part);
      void pump();
    },
  };
}
