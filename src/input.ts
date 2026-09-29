export const input = {
  keys: new Set<string>(),
  lookX: 0,
  lookY: 0,
  pourX: 0,
  space: false,
  toggleLeft: false,
  toggleRight: false,
  squeezeLeft: false,
  squeezeRight: false,
  locked: false,
  playing: false,
};

export function bindInput(canvas: HTMLCanvasElement, prompt: HTMLElement) {
  const setLocked = (locked: boolean) => {
    input.locked = locked;
    prompt.classList.toggle("hidden", locked);
    if (!locked) {
      input.keys.clear();
      input.space = false;
      input.squeezeLeft = false;
      input.squeezeRight = false;
    }
  };

  let wasLocked = false;
  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    input.locked = locked;
    if (locked) {
      wasLocked = true;
      input.playing = true;
      prompt.classList.add("hidden");
    } else if (wasLocked) {
      wasLocked = false;
      setLocked(false);
      input.playing = false;
    }
  });

  document.addEventListener("contextmenu", (event) => event.preventDefault());

  document.addEventListener("keydown", (event) => {
    if (event.code === "Space") event.preventDefault();
    if (!input.playing) return;
    input.keys.add(event.code);
    if (event.code === "Space") input.space = true;
  });

  document.addEventListener("keyup", (event) => {
    input.keys.delete(event.code);
    if (event.code === "Space") input.space = false;
  });

  document.addEventListener("mousemove", (event) => {
    if (!input.playing) return;
    if (input.space) input.pourX += event.movementX;
    else if (input.locked) {
      input.lookX += event.movementX;
      input.lookY += event.movementY;
    }
  });

  const pressedAt = [0, 0, 0];
  const lastTap = [0, 0, 0];

  const onPress = (event: MouseEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    if (!input.playing) {
      input.playing = true;
      prompt.classList.add("hidden");
      canvas.requestPointerLock();
      return;
    }
    pressedAt[event.button] = performance.now();
    if (event.button === 0) input.squeezeLeft = true;
    if (event.button === 2) input.squeezeRight = true;
  };

  const onRelease = (event: MouseEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    const held = performance.now() - pressedAt[event.button];
    pressedAt[event.button] = 0;
    if (event.button === 0) input.squeezeLeft = false;
    if (event.button === 2) input.squeezeRight = false;
    if (!input.playing || held <= 0 || held > 220) {
      lastTap[event.button] = 0;
      return;
    }
    const now = performance.now();
    if (now - lastTap[event.button] <= 320) {
      lastTap[event.button] = 0;
      if (event.button === 0) input.toggleLeft = true;
      if (event.button === 2) input.toggleRight = true;
    } else {
      lastTap[event.button] = now;
    }
  };

  canvas.addEventListener("mousedown", onPress);
  prompt.addEventListener("mousedown", onPress);
  document.addEventListener("mouseup", onRelease);
}
