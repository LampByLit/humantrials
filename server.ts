import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { janeHandler } from "./vite/janePlugin.ts";

const root = path.resolve("dist");
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".wasm": "application/wasm",
  ".json": "application/json",
};
const jane = janeHandler(process.env.DEEPSEEK_API_KEY ?? "");

createServer((req, res) => {
  void jane(req, res, async () => {
    const url = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    let file = path.join(root, url === "/" ? "index.html" : url);
    if (!file.startsWith(root)) file = path.join(root, "index.html");
    try {
      const body = await readFile(file);
      res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
      if (url.startsWith("/assets/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
  });
}).listen(Number(process.env.PORT ?? 3000));
