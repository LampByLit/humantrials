import { input } from "../input";
import { litresText, moneyText } from "./format";
import type { Ledger } from "./ledger";

export type JanePanel = {
  add(who: "Jane" | "You", text: string): HTMLElement;
  replace(node: HTMLElement, text: string): void;
  setLedger(ledger: Ledger): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
  log: HTMLElement;
};

export function createPanel(onTalk: (text: string) => void): JanePanel {
  const root = document.getElementById("jane")!;
  const log = document.getElementById("jane-log")!;
  const form = document.getElementById("jane-form") as HTMLFormElement;
  const field = document.getElementById("jane-input") as HTMLInputElement;
  const credits = document.getElementById("jane-credits")!;
  const wants = document.getElementById("jane-wants")!;
  const canvas = document.querySelector("canvas");

  const close = () => {
    root.classList.add("collapsed");
    input.console = false;
    field.blur();
    canvas?.requestPointerLock();
  };

  const open = () => {
    root.classList.remove("collapsed");
    input.console = true;
    if (document.pointerLockElement) document.exitPointerLock();
    field.focus();
  };

  root.addEventListener("mousedown", () => {
    if (!root.classList.contains("collapsed")) input.console = true;
  });

  field.addEventListener("focus", () => {
    input.console = true;
    if (document.pointerLockElement) document.exitPointerLock();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = field.value.trim();
    field.value = "";
    if (text) onTalk(text);
    field.focus();
  });

  document.addEventListener("keydown", (event) => {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (typing) {
      if (event.code === "Escape") {
        event.preventDefault();
        close();
      }
      return;
    }
    if (!input.playing || event.repeat) return;
    if (event.code === "Escape" && !root.classList.contains("collapsed")) {
      event.preventDefault();
      close();
    }
  });

  let shown = "";
  return {
    log,
    add(who, text) {
      const line = document.createElement("p");
      const whoEl = document.createElement("b");
      whoEl.textContent = who;
      line.append(whoEl, document.createTextNode(` ${text}`));
      log.append(line);
      log.scrollTop = log.scrollHeight;
      return line;
    },
    replace(node, text) {
      node.replaceChildren();
      const whoEl = document.createElement("b");
      whoEl.textContent = "Jane";
      node.append(whoEl, document.createTextNode(` ${text}`));
      log.scrollTop = log.scrollHeight;
    },
    setLedger(ledger) {
      const credit = moneyText(ledger.credits);
      const greenLeft = Math.max(0, ledger.green.litres - ledger.green.filled);
      const blueLeft = Math.max(0, ledger.blue.litres - ledger.blue.filled);
      const green = `Green  ${litresText(greenLeft)} ${ledger.green.name}  ${moneyText(ledger.green.pricePerLitre)}`;
      const blue = ledger.awaitingReward
        ? "Blue  name the litre you want"
        : `Blue  ${litresText(blueLeft)} ${ledger.blue.name}`;
      const next = `${credit}|${green}|${blue}`;
      if (next === shown) return;
      shown = next;
      credits.textContent = credit;
      wants.textContent = "";
      const greenLine = document.createElement("div");
      greenLine.textContent = green;
      const blueLine = document.createElement("div");
      blueLine.textContent = blue;
      wants.append(greenLine, blueLine);
    },
    open,
    close,
    isOpen: () => !root.classList.contains("collapsed"),
  };
}
