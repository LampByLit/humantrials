export type Turn = { role: "user" | "jane"; text: string };

export type Memory = {
  introduced: boolean;
  turns: Turn[];
  notes: string[];
};

const TURNS = 8;
const NOTES = 12;

export function createMemory(): Memory {
  return { introduced: false, turns: [], notes: [] };
}

export function remember(memory: Memory, role: Turn["role"], text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return;
  memory.turns.push({ role, text: line });
  if (memory.turns.length > TURNS) memory.turns.splice(0, memory.turns.length - TURNS);
}

export function note(memory: Memory, text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return;
  memory.notes.push(line);
  if (memory.notes.length > NOTES) memory.notes.splice(0, memory.notes.length - NOTES);
}
