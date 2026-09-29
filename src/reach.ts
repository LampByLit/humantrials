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
// Extra reach added as the arc swings below the shoulder, so looking at the bench puts the
// hands on it without scrolling.
const DOWN_REACH = 0.25;
const REACH_SENS = 0.0005;
const FOLLOW = 14;
const MODEL_TILT = 0.2;
// The one hand sits a little right of the view centre, like a held weapon in an FPS.
const HAND_SIDE = 0.12;

export type Reach = {
  distance: number;
  shoulder: THREE.Vector3;
  // From the model's origin to the right wrist, in the body's frame.
  wristOffset: THREE.Vector3;
};

const target = new THREE.Vector3();

export function createReach(hands: Hands, player: Player): Reach {
  const model = hands.model;
  model.removeFromParent();
  model.position.set(0, 0, 0);
  model.rotation.set(MODEL_TILT + REST_PITCH, 0, 0);
  player.object.add(model);
  player.object.updateMatrixWorld(true);

  const wristOffset = player.object.worldToLocal(hands.arm.hand.getWorldPosition(new THREE.Vector3()));

  const reach: Reach = {
    distance: REACH_REST,
    shoulder: new THREE.Vector3(HAND_SIDE, player.pivot.position.y - SHOULDER_DROP, 0),
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
  const distance = reach.distance + DOWN_REACH * Math.max(0, -Math.sin(arc));
  // Past the top of the arc the hand would swing behind the head. Keep it in front so a
  // beaker tipped while looking up pours onto the player.
  const ahead = Math.min(-0.16, -Math.cos(arc) * distance);
  target
    .set(0, Math.sin(arc) * distance, ahead)
    .add(reach.shoulder)
    .sub(reach.wristOffset);
  hands.model.position.lerp(target, blend);
}
