import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import handUrl from "../anatomically_accurate_rigged_hand_model_for_xr.glb?url";

const BG = "#e9e9e7";
const INK = "#111111";
const CAMERA_Z = 5;
const LINES = ["HUMAN", "TRIALS"];

export type Title = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize: () => void;
  update: (time: number) => void;
};

// Glass from the hero pen: a clear mesh in front of the type, so dispersion
// bends the letters. The hand floats where that knot sat.
export async function createTitle(renderer: THREE.WebGLRenderer): Promise<Title> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = CAMERA_Z;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const textCanvas = document.createElement("canvas");
  const textCtx = textCanvas.getContext("2d")!;
  const textPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ toneMapped: false }),
  );
  scene.add(textPlane);

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0,
    transmission: 1,
    thickness: 0.35,
    ior: 1.45,
    dispersion: 4,
    envMapIntensity: 1,
    toneMapped: false,
  });

  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(handUrl);
  const hand = gltf.scene;
  hand.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = glass;
    mesh.frustumCulled = false;
  });

  const ok = THREE.AnimationClip.findByName(gltf.animations, "Pose_OK");
  if (ok) {
    const mixer = new THREE.AnimationMixer(hand);
    mixer.clipAction(ok).play();
    mixer.setTime(ok.duration);
    hand.traverse((object) => {
      const skinned = object as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh) skinned.skeleton.update();
    });
  }

  const fitted = new THREE.Group();
  fitted.add(hand);
  fitted.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(hand);
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  hand.position.copy(box.getCenter(new THREE.Vector3())).negate();
  fitted.scale.setScalar(span > 0 ? 1.6 / span : 1);

  const float = new THREE.Group();
  float.add(fitted);
  float.position.z = 2.2;
  scene.add(float);

  let textTexture: THREE.CanvasTexture | null = null;

  function drawText(width: number, height: number) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    textCanvas.width = Math.round(width * dpr);
    textCanvas.height = Math.round(height * dpr);
    textCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    textCtx.fillStyle = BG;
    textCtx.fillRect(0, 0, width, height);
    textCtx.fillStyle = INK;
    textCtx.textAlign = "center";
    textCtx.textBaseline = "middle";
    textCtx.letterSpacing = "-0.04em";

    const maxWidth = width * 0.92;
    const maxHeight = height * 0.78;
    const baseSize = 100;
    const lineGap = 0.98;
    textCtx.font = `900 ${baseSize}px Arial, "Segoe UI", sans-serif`;
    const sizes = LINES.map((line) => baseSize * (maxWidth / textCtx.measureText(line).width));
    const totalHeight = sizes.reduce((sum, size) => sum + size * lineGap, 0);
    const fit = Math.min(1, maxHeight / totalHeight);

    let y = height / 2 - (totalHeight * fit) / 2;
    LINES.forEach((line, i) => {
      const size = sizes[i] * fit;
      textCtx.font = `900 ${size}px Arial, "Segoe UI", sans-serif`;
      y += (size * lineGap) / 2;
      textCtx.fillText(line, width / 2, y);
      y += (size * lineGap) / 2;
    });

    textTexture?.dispose();
    textTexture = new THREE.CanvasTexture(textCanvas);
    textTexture.colorSpace = THREE.SRGBColorSpace;
    textTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const material = textPlane.material as THREE.MeshBasicMaterial;
    material.map = textTexture;
    material.needsUpdate = true;
  }

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const visibleHeight = 2 * CAMERA_Z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const visibleWidth = visibleHeight * camera.aspect;
    textPlane.scale.set(visibleWidth, visibleHeight, 1);
    drawText(width, height);
  }

  resize();
  window.addEventListener("resize", resize);

  return {
    scene,
    camera,
    resize,
    update(time: number) {
      float.rotation.y = time * 0.5;
      float.position.y = Math.sin(time * 0.8) * 0.06;
    },
  };
}
