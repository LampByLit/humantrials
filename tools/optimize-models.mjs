// Shrinks the shipped models in place. Run once after adding or replacing a model:
//   node tools/optimize-models.mjs [path ...]
// Painted models have every material swapped in code, so their textures and UVs go.
// Textured models keep their maps, resized and re-encoded as WebP.
// Only models loaded through a meshopt-aware GLTFLoader get geometry compression;
// the arm rig is also parsed raw by tools/*-lab.mjs, and Jane and the rat are loaded elsewhere.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, metalRough, prune, resample, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { renameSync, statSync } from "node:fs";

const painted = [
  "public/models/lab/window.glb",
  "public/models/lab/floor.glb",
  "public/models/lab/shelf.glb",
  "public/models/lab/extinguisher.glb",
  "public/models/lab/chair.glb",
  "anatomically_accurate_rigged_hand_model_for_xr.glb",
];
const textured = [
  { path: "retro_industrial_control_cabinet.glb", squeeze: true },
  { path: "faucet.glb", squeeze: true },
  { path: "public/models/fps-arm-rig.glb", squeeze: false },
  { path: "base_female_-_game_ready_-_rigged_-_low_poly.glb", squeeze: false },
  { path: "rat_multi_animations_textured.glb", squeeze: false },
];

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

const unpaint = () => (document) => {
  const root = document.getRoot();
  for (const texture of root.listTextures()) texture.dispose();
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const semantic of prim.listSemantics()) {
        if (semantic.startsWith("TEXCOORD_") || semantic === "TANGENT" || semantic.startsWith("COLOR_")) {
          prim.setAttribute(semantic, null);
        }
      }
    }
  }
};

async function run(path, steps) {
  const before = statSync(path).size;
  const document = await io.read(path);
  await document.transform(...steps);
  // A running dev server can hold the file open, so write beside it and swap.
  const temp = path.replace(/\.glb$/, ".tmp.glb");
  await io.write(temp, document);
  renameSync(temp, path);
  const after = statSync(path).size;
  console.log(`${path}: ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB`);
}

// Pass paths to redo only those, e.g. after restoring an original from git.
const only = process.argv.slice(2).map((arg) => arg.replaceAll("\\", "/"));
const picked = (path) => only.length === 0 || only.includes(path);

for (const path of painted.filter(picked)) {
  await run(path, [unpaint(), dedup(), prune(), weld(), resample(), meshopt({ encoder: MeshoptEncoder, level: "medium" })]);
}
for (const { path, squeeze } of textured.filter(({ path }) => picked(path))) {
  // three.js ignores spec-gloss materials, which left the rat's texture unused.
  const steps = [metalRough(), dedup(), prune(), resample(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024] })];
  if (squeeze) steps.push(weld(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  await run(path, steps);
}
