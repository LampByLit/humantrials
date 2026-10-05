import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import janeUrl from "../../base_female_-_game_ready_-_rigged_-_low_poly.glb?url";
import ratUrl from "../../rat_multi_animations_textured.glb?url";

export type Cast = { jane: GLTF; rat: GLTF; cage: GLTF };

// Jane is the rigged low-poly figure already in the repo. She has a skeleton and no
// clips, so the walk is posed on the bones. The rats are the multi-animation model
// already in the repo; four coats share it. OpenGameArt's CC0 rats ship as blend
// and godot files, not a GLB this lab can load.
export function loadCast(): Promise<Cast> {
  const loader = new GLTFLoader();
  return Promise.all([loader.loadAsync(janeUrl), loader.loadAsync(ratUrl), loader.loadAsync("/models/cage.glb")]).then(([jane, rat, cage]) => ({ jane, rat, cage }));
}
