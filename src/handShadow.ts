import * as THREE from "three";
import type { Hands } from "./hands";

const HAND_LAYER = 1;
// From the palm. The shoulder sits about 0.34 away, and a mesh clipped by the shadow
// camera's near plane fills the map with a solid square, so anything past this is
// pulled onto the sphere before it is projected.
const CAST_RADIUS = 0.24;
const HALF = CAST_RADIUS + 0.02;
const MAP_SIZE = 1024;
const TEXEL = (2 * HALF) / MAP_SIZE;
// The cast sphere has to sit entirely in front of the near plane.
const HOVER = 0.6;
const NEAR = HOVER - CAST_RADIUS - 0.05;
// Above the floor tiles and below the bench body, so the hand shadow lands on
// glass and benches and never on the floor.
const FLOOR = 0.04;
const PALM = new THREE.Vector3(0, 0.06, 0);

export type HandShadow = {
  light: THREE.DirectionalLight;
};

// A light straight above the hand. The hand is the only thing drawn into its shadow
// map, so the silhouette falls directly underneath, on a bench or a beaker, whatever
// height and angle the hand is held at.
export function createHandShadow(scene: THREE.Scene, camera: THREE.Camera, hands: Hands): HandShadow {
  camera.layers.enable(HAND_LAYER);

  const localPalm = new THREE.Vector3();
  const localRadius = { value: 1 };
  const skip = { value: 0 };
  const depth = new THREE.MeshDepthMaterial({ side: THREE.BackSide });
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.localPalm = { value: localPalm };
    shader.uniforms.localRadius = localRadius;
    shader.uniforms.skip = skip;
    shader.vertexShader =
      "uniform vec3 localPalm;\nuniform float localRadius;\nuniform float skip;\n" +
      shader.vertexShader.replace(
        "#include <project_vertex>",
        /* glsl */ `
          vec3 delta = transformed - localPalm;
          float dist = length(delta);
          if (dist > localRadius) transformed = localPalm + delta * (localRadius / dist);
          #include <project_vertex>
          if (skip > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        `,
      );
  };

  const inverse = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  hands.model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.layers.set(HAND_LAYER);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.customDepthMaterial = depth;
    mesh.onBeforeShadow = (_renderer, skinned, _camera, shadowCamera) => {
      // This mesh is drawn into every shadow map the view camera can see. The sun's
      // map is the angled one; skip it so the hand has a single shadow, straight down.
      skip.value = shadowCamera.layers.isEnabled(HAND_LAYER) ? 0 : 1;
      skinned.updateWorldMatrix(true, false);
      inverse.copy(skinned.matrixWorld).invert();
      localPalm.copy(palm).applyMatrix4(inverse);
      skinned.getWorldScale(scale);
      localRadius.value = CAST_RADIUS / scale.x;
    };
  });

  const light = new THREE.DirectionalLight(0xfff6ea, 1.15);
  light.castShadow = true;
  light.shadow.mapSize.set(MAP_SIZE, MAP_SIZE);
  light.shadow.bias = -0.00015;
  light.shadow.normalBias = 0.003;
  const shadowCamera = light.shadow.camera;
  shadowCamera.left = -HALF;
  shadowCamera.right = HALF;
  shadowCamera.top = HALF;
  shadowCamera.bottom = -HALF;
  shadowCamera.near = NEAR;
  // Straight down is parallel to the default up axis, which breaks the shadow camera.
  shadowCamera.up.set(0, 0, -1);
  shadowCamera.layers.set(HAND_LAYER);
  shadowCamera.updateProjectionMatrix();
  scene.add(light, light.target);
  return { light };
}

const palm = new THREE.Vector3();
const sample = new THREE.Vector3();
const offset = new THREE.Vector3();
const handQuat = new THREE.Quaternion();

export function updateHandShadow(shadow: HandShadow, hands: Hands) {
  const hand = hands.arm.hand;
  hand.getWorldPosition(palm);
  hand.getWorldQuaternion(handQuat);
  palm.add(offset.copy(PALM).applyQuaternion(handQuat));
  if (hands.pair > 0.02) {
    hands.left.hand.getWorldPosition(sample);
    hands.left.hand.getWorldQuaternion(handQuat);
    sample.add(offset.copy(PALM).applyQuaternion(handQuat));
    palm.lerp(sample, hands.pair * 0.5);
  }

  const x = Math.round(palm.x / TEXEL) * TEXEL;
  const z = Math.round(palm.z / TEXEL) * TEXEL;
  const y = palm.y + HOVER;
  shadow.light.position.set(x, y, z);
  shadow.light.target.position.set(x, palm.y, z);

  const shadowCamera = shadow.light.shadow.camera;
  const far = y - FLOOR;
  if (shadowCamera.far !== far) {
    shadowCamera.far = far;
    shadowCamera.updateProjectionMatrix();
  }
}
