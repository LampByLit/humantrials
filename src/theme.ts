import * as THREE from "three";

const LIGHT = new THREE.Color(0xf6f6f4);
const DARK = new THREE.Color(0x141418);

export const surfaces: THREE.MeshStandardMaterial[] = [];
export let dark = false;

export function whiteSurface(roughness = 0.86) {
  const material = new THREE.MeshStandardMaterial({ color: LIGHT, roughness, metalness: 0 });
  surfaces.push(material);
  return material;
}

export function applyTheme(
  next: boolean,
  view: { scene: THREE.Scene; hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight },
) {
  dark = next;
  const color = dark ? DARK : LIGHT;
  for (const material of surfaces) material.color.copy(color);
  view.scene.background = new THREE.Color(dark ? 0x0c0c10 : 0xf7f7f5);
  view.scene.fog = new THREE.Fog(dark ? 0x0c0c10 : 0xf3f3f1, 20, 46);
  view.hemi.color.set(dark ? 0x6a6a78 : 0xfff8f0);
  view.hemi.groundColor.set(dark ? 0x121216 : 0xd9d9d4);
  view.hemi.intensity = dark ? 0.22 : 1;
  view.sun.intensity = dark ? 0.06 : 0.85;
}
