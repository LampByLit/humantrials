import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

type Turn = { role: "user" | "jane"; text: string };

const cache = new Map<string, Buffer>();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: string, type = "application/json") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.end(body);
}

function piperExe(root: string): string | null {
  const candidates = [path.join(root, "tools", "piper", "piper", "piper.exe"), path.join(root, "tools", "piper", "piper.exe")];
  return candidates.find((file) => existsSync(file)) ?? null;
}

function voice(root: string): { model: string; dir: string } | null {
  const model = path.join(root, "tools", "piper", "en_US-lessac-medium.onnx");
  if (!existsSync(model) || !existsSync(`${model}.json`)) return null;
  return { model, dir: path.dirname(piperExe(root) ?? model) };
}

function speakWithPiper(root: string, text: string): Promise<Buffer> {
  const exe = piperExe(root);
  const model = voice(root);
  if (!exe || !model) return Promise.reject(new Error("piper missing"));
  const file = path.join(tmpdir(), `jane-${createHash("sha1").update(text).digest("hex")}.wav`);
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ["--model", model.model, "--output_file", file], { cwd: model.dir });
    let error = "";
    child.stderr.on("data", (chunk: Buffer) => {
      error += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(error || `piper ${code}`));
        return;
      }
      resolve(await readFile(file));
    });
    child.stdin.write(text);
    child.stdin.end();
  });
}

function book(root: string): string {
  const knowledge = readFileSync(path.join(root, "concept", "jane-knowledge.md"), "utf8");
  const chems = JSON.parse(readFileSync(path.join(root, "concept", "chems.json"), "utf8")) as {
    name: string;
    hex: string;
    note: string;
  }[];
  const catalog = chems.map((entry) => `${entry.name} ${entry.hex}: ${entry.note}`).join("\n");
  return `${knowledge}\n${catalog}`;
}

async function complete(apiKey: string, system: string, history: Turn[], text: string, state: string): Promise<string> {
  const messages = [
    { role: "system", content: system },
    ...history.slice(-6).map((turn) => ({ role: turn.role === "jane" ? "assistant" : "user", content: turn.text })),
    { role: "user", content: `STATE\n${state}\n\nPLAYER\n${text}` },
  ];
  const body = {
    model: "deepseek-flash",
    messages,
    temperature: 0.7,
    max_tokens: 180,
    thinking: { type: "disabled" },
  };
  let response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const failed = await response.text();
    const { thinking: _thinking, ...plain } = body;
    response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(plain),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(failed);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return (data.choices?.[0]?.message?.content ?? "")
    .replace(/\*\*/g, "")
    .replace(/^[-*]\s+/gm, "")
    .trim();
}

export function janePlugin(apiKey: string): Plugin {
  const system = book(process.cwd());
  return {
    name: "jane",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "POST" || (req.url !== "/api/jane" && req.url !== "/api/speak")) {
          next();
          return;
        }
        try {
          const payload = JSON.parse(await readBody(req)) as { text?: string; history?: Turn[]; state?: string };
          const text = (payload.text ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
          if (!text) {
            send(res, 400, JSON.stringify({ error: "empty" }));
            return;
          }
          if (req.url === "/api/speak") {
            const key = createHash("sha1").update(text).digest("hex");
            let wav = cache.get(key);
            if (!wav) {
              wav = await speakWithPiper(process.cwd(), text);
              if (cache.size > 40) cache.clear();
              cache.set(key, wav);
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "audio/wav");
            res.end(wav);
            return;
          }
          if (!apiKey) {
            send(res, 503, JSON.stringify({ error: "no-key" }));
            return;
          }
          const line = await complete(apiKey, system, payload.history ?? [], text, payload.state ?? "");
          send(res, 200, JSON.stringify({ text: line || "" }));
        } catch (error) {
          console.error(error);
          send(res, 502, JSON.stringify({ error: "jane" }));
        }
      });
    },
  };
}
