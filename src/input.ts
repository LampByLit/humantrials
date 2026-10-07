export const input = {
  keys: new Set<string>(),
  lookX: 0,
  lookY: 0,
  pourX: 0,
  pourY: 0,
  reach: 0,
  space: false,
  toggle: false,
  pairToggle: false,
  themeToggle: false,
  gripLocked: false,
  squeeze: false,
  locked: false,
  playing: false,
  // Pointer lock is down so Jane's field can take keys, and the lab keeps simulating.
  console: false,
  ready: false,
  dead: false,
  slow: (): boolean => input.keys.has("ShiftLeft") || input.keys.has("ShiftRight"),
  run: (): boolean => input.keys.has("AltLeft") || input.keys.has("AltRight"),
};

let regainLook = () => {};

// Pointer lock cannot be taken back from the Escape key. Ask, and if the browser
// refuses, the next click on the lab takes it.
export function resumeLook() {
  regainLook();
}

export function bindInput(canvas: HTMLCanvasElement, prompt: HTMLElement) {
  const setLocked = (locked: boolean) => {
    input.locked = locked;
    prompt.classList.toggle("hidden", locked);
    if (!locked) {
      input.keys.clear();
      input.space = false;
      input.squeeze = false;
      input.gripLocked = false;
      input.pairToggle = false;
      input.themeToggle = false;
    }
  };

  const showLook = () => {
    prompt.textContent = "Click to look";
    prompt.classList.remove("hidden");
  };

  regainLook = () => {
    input.console = false;
    const pending = canvas.requestPointerLock() as void | Promise<void>;
    if (pending && typeof pending.then === "function") void pending.catch(() => showLook());
  };

  let wasLocked = false;
  document.addEventListener("pointerlockerror", () => {
    if (input.playing && !input.console && document.pointerLockElement !== canvas) showLook();
  });

  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    input.locked = locked;
    if (locked) {
      wasLocked = true;
      input.playing = true;
      input.console = false;
      prompt.classList.add("hidden");
    } else if (wasLocked) {
      wasLocked = false;
      input.locked = false;
      input.keys.clear();
      input.space = false;
      input.squeeze = false;
      input.gripLocked = false;
      input.pairToggle = false;
      input.themeToggle = false;
      if (!input.console) {
        input.playing = false;
        prompt.textContent = "Click to begin";
        prompt.classList.remove("hidden");
      }
    }
  });

  document.addEventListener("contextmenu", (event) => event.preventDefault());

  document.addEventListener(
    "keydown",
    (event) => {
      if (input.console || event.target instanceof HTMLInputElement) return;
      if (!input.playing) return;
      if (event.altKey || event.code === "AltLeft" || event.code === "AltRight") event.preventDefault();
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (event.code === "Space" && !typing) event.preventDefault();
    if (typing || input.console) return;
    if (!input.playing) return;
    if (event.altKey || event.code === "AltLeft" || event.code === "AltRight") event.preventDefault();
    if (event.code === "KeyF" && !event.repeat) input.pairToggle = true;
    if (event.code === "KeyQ" && !event.repeat) input.themeToggle = true;
    input.keys.add(event.code);
    if (event.code === "Space") input.space = true;
  });

  document.addEventListener("keyup", (event) => {
    input.keys.delete(event.code);
    if (event.code === "Space") input.space = false;
  });

  document.addEventListener("mousemove", (event) => {
    if (!input.playing) return;
    if (input.space) {
      input.pourX += event.movementX;
      input.pourY += event.movementY;
    } else if (input.locked) {
      input.lookX += event.movementX;
      input.lookY += event.movementY;
    }
  });

  document.addEventListener(
    "wheel",
    (event) => {
      if (input.playing && !input.console) input.reach += event.deltaY;
    },
    { passive: true },
  );

  const pressedAt = [0, 0, 0];
  const lastTap = [0, 0, 0];

  const onPress = (event: MouseEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    if (!input.playing) {
      if (!input.ready || input.dead) return;
      input.playing = true;
      prompt.classList.add("hidden");
      canvas.requestPointerLock();
      return;
    }
    if (!input.locked) {
      if (event.button !== 0) return;
      input.console = false;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.dispatchEvent(new Event("resume-play"));
      prompt.classList.add("hidden");
      canvas.requestPointerLock();
      return;
    }
    if (event.button !== 0) return;
    pressedAt[event.button] = performance.now();
    input.squeeze = true;
  };

  const onRelease = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const held = performance.now() - pressedAt[event.button];
    pressedAt[event.button] = 0;
    input.squeeze = false;
    if (!input.playing || held <= 0 || held > 220) {
      lastTap[event.button] = 0;
      return;
    }
    const now = performance.now();
    if (now - lastTap[event.button] <= 320) {
      lastTap[event.button] = 0;
      input.toggle = true;
    } else {
      lastTap[event.button] = now;
    }
  };

  canvas.addEventListener("mousedown", onPress);
  prompt.addEventListener("mousedown", onPress);
  document.addEventListener("mouseup", onRelease);
}
