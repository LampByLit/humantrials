import * as THREE from "three";
import { input } from "./input";
import type { Hands } from "./hands";
import type { Player } from "./player";

// The arms hang off the body rather than the camera: looking up or down swings the hands
// along an arc around the shoulder, and the wheel extends or pulls in the reach. The hands
// keep a level orientation so looking around never tips a held beaker; only the pour roll does.
const SHOULDER_DROP = 0.2;
const REST_PITCH = -0.28;
const ARC_GAIN = 1.25;
const REACH_MIN = 0.25;
const REACH_MAX = 0.75;
const REACH_REST = 0.32;
const REACH_SENS = 0.0005;
const FOLLOW = 14;
const MODEL_TILT = 0.2;

export type Reach = {
  distance: number;
  shoulder: THREE.Vector3;
  // From the model's origin to the midpoint of the two wrists, in the body's frame.
  wristOffset: THREE.Vector3;
};

const target = new THREE.Vector3();
const scratch = new THREE.Vector3();

export function createReach(hands: Hands, player: Player): Reach {
  const model = hands.model;
  model.removeFromParent();
  model.position.set(0, 0, 0);
  model.rotation.set(MODEL_TILT + REST_PITCH, 0, 0);
  player.object.add(model);
  player.object.updateMatrixWorld(true);

  const wristOffset = hands.left.hand.getWorldPosition(new THREE.Vector3());
  wristOffset.add(hands.right.hand.getWorldPosition(scratch)).multiplyScalar(0.5);
  player.object.worldToLocal(wristOffset);

  const reach: Reach = {
    distance: REACH_REST,
    shoulder: new THREE.Vector3(0, player.pivot.position.y - SHOULDER_DROP, 0),
    wristOffset,
  };
  place(reach, hands, player, 1);
  return reach;
}

export function updateReach(reach: Reach, hands: Hands, player: Player, dt: number) {
  reach.distance = Math.max(REACH_MIN, Math.min(REACH_MAX, reach.distance - input.reach * REACH_SENS));
  input.reach = 0;
  place(reach, hands, player, 1 - Math.exp(-FOLLOW * dt));
}

function place(reach: Reach, hands: Hands, player: Player, blend: number) {
  const arc = (player.pitch - REST_PITCH) * ARC_GAIN;
  target
    .set(0, Math.sin(arc) * reach.distance, -Math.cos(arc) * reach.distance)
    .add(reach.shoulder)
    .sub(reach.wristOffset);
  hands.model.position.lerp(target, blend);
}
