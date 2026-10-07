import catalog from "../../concept/chems.json";
import { latinName } from "../sim/colorName";
import { janeConfig } from "./config";
import { cents } from "./format";
import { acceptReward, tryOrder, type Ledger } from "./ledger";
import {
  analogHelp,
  analyzerLine,
  balanceLine,
  blueWant,
  brokeLine,
  chemNote,
  controlHelp,
  craftLine,
  experimentLine,
  greenWant,
  helloLine,
  missingNameLine,
  mixHelp,
  orderAccept,
  orderArrival,
  orderLimitLine,
  pilotLine,
  priceLine,
  ratHelp,
  redWant,
  rehabLine,
  rewardAccept,
  rewardArrival,
  stocktailRefusal,
  submitHelp,
  thanksLine,
  whoLine,
} from "./lines";
import type { Memory } from "./memory";
import { cleanQuery, orderBody, priceBody, readLitres, resolveChem } from "./names";
import { priceOfFill, type Fill } from "./prices";
import { isStocktail } from "./stocktails";

export type TalkEffect =
  | { type: "order"; fill: Fill; name: string; litres: number; arrival: string }
  | { type: "reward"; fill: Fill; name: string; arrival: string };

export type TalkReply = { text: string; intent: "local" | "model"; effect?: TalkEffect };

export type TalkContext = {
  ledger: Ledger;
  rats: { name: string; status: string }[];
  introduced: boolean;
};

const notes = new Map(catalog.map((entry) => [entry.hex.toUpperCase(), entry.note]));

function asking(text: string): boolean {
  return /^(what|who|why|how|when|where|do |does |is |are |can you explain|tell me|explain)\b/i.test(text.trim());
}

function faction(text: string, color: "green" | "blue" | "red"): boolean {
  const word = color === "red" ? "reds?" : `${color}s?`;
  if (!new RegExp(`\\b${word}\\b`, "i").test(text)) return false;
  return new RegExp(`\\b(want|need|higher|ups|counter|order|pay|paying|brief|asking|request|list)\\b`, "i").test(text);
}

export function replyTo(raw: string, ctx: TalkContext): TalkReply {
  const text = raw.trim();
  if (!text) return { text: "I'm listening.", intent: "local" };
  const lower = text.toLowerCase();

  if (/\b(credits?|balance|how much money|my account|what do i have)\b/.test(lower)) {
    return { text: balanceLine(ctx.ledger.credits), intent: "local" };
  }

  const priced = priceBody(text);
  if (priced) return quote(priced);

  const shop = /^(?:please\s+)?(?:(?:can|could|would) (?:i|you) )?(?:order|buy|purchase)\b/i.test(text) || /\b(bring me|get me|sell me)\b/i.test(text);
  if (shop) {
    const ordered = orderBody(text);
    if (ordered) return order(ordered, ctx.ledger);
  }

  if (ctx.ledger.awaitingReward && !asking(text)) {
    const found = resolveChem(cleanQuery(readLitres(text).rest));
    if (found) return reward(found.fill, found.name, ctx.ledger);
  }

  const ordered = orderBody(text);
  if (ordered) return order(ordered, ctx.ledger);

  if (/^(hi|hello|hey|good morning|good evening|you there)\b/.test(lower)) return { text: helloLine(), intent: "local" };
  if (/^(thanks|thank you|cheers)\b/.test(lower)) return { text: thanksLine(), intent: "local" };
  if (/\b(who are you|your name|you jane)\b/.test(lower) || lower === "jane") return { text: whoLine(), intent: "local" };
  if (/\b(experiment|recursion|accident|rehab|why am i|human trial|selected)\b/.test(lower)) {
    return { text: `${experimentLine()} ${rehabLine()}`, intent: "local" };
  }
  if (faction(lower, "red") || lower === "red" || lower === "reds") return { text: redWant(), intent: "local" };
  if (faction(lower, "green") || lower === "green" || lower === "greens") {
    return { text: greenWant(ctx.ledger.green), intent: "local" };
  }
  if (faction(lower, "blue") || lower === "blue" || lower === "blues") {
    return { text: ctx.ledger.awaitingReward ? `${blueWant(ctx.ledger.blue)} Name the litre you want back.` : blueWant(ctx.ledger.blue), intent: "local" };
  }
  if (/\b(rats?|cages?|hood|albino|ink|brindle|feed)\b/.test(lower)) return { text: ratHelp(ctx.rats), intent: "local" };
  if (/\b(submit|turn in|hand in|where do i put|which counter|green counter|blue counter)\b/.test(lower)) {
    return { text: submitHelp(), intent: "local" };
  }
  if (/\b(analog|analogs|cousin|cousins|sliding scale)\b/.test(lower)) return { text: analogHelp(), intent: "local" };
  if (/\b(controls?|how do i play|buttons|keybinds?)\b/.test(lower)) return { text: controlHelp(), intent: "local" };
  if (/\b(mix|mixing|demixer|elemental|dilut|how does (the )?chem)\b/.test(lower)) return { text: mixHelp(), intent: "local" };
  if (/\b(how (do|can) i (make|mix|get|synthesize)|recipe|synthesis)\b/.test(lower)) {
    const found = resolveChem(cleanQuery(text.replace(/^.*\b(?:make|mix|get|synthesize)\b/i, "")));
    return { text: craftLine(found?.name ?? "That", found?.hex ?? null), intent: "local" };
  }
  if (/\b(100 mph|pilot|eyedropper|can't read|cannot read|don't know the name)\b/.test(lower)) {
    return { text: pilotLine(), intent: "local" };
  }
  if (/\b(analyzer|the cabinet|east cabinet)\b/.test(lower)) return { text: analyzerLine(), intent: "local" };
  if (/^(what|tell me about|describe|explain)\b/.test(lower)) {
    const found = resolveChem(cleanQuery(text.replace(/^(what is|what's|what does|what do|tell me about|describe|explain)\s+/i, "")));
    if (found?.hex) {
      return { text: chemNote(found.name, found.hex, notes.get(found.hex) ?? null, latinName(found.hex)), intent: "local" };
    }
  }
  return { text: "", intent: "model" };
}

function quote(body: string): TalkReply {
  const read = readLitres(body);
  const found = resolveChem(read.rest);
  if (!found) return { text: missingNameLine(), intent: "local" };
  const price = priceOfFill(found.fill);
  const litres = read.litres;
  const cost = litres === null ? null : cents(price * litres);
  return { text: priceLine(found.name, price, litres, cost), intent: "local" };
}

function order(body: string, ledger: Ledger): TalkReply {
  const read = readLitres(body);
  const litres = read.litres ?? 1;
  if (!(litres >= janeConfig.minOrderLitres) || litres > janeConfig.maxOrderLitres) {
    return { text: orderLimitLine(), intent: "local" };
  }
  const found = resolveChem(read.rest);
  if (!found) return { text: missingNameLine(), intent: "local" };
  if (found.hex && isStocktail(found.hex)) return { text: stocktailRefusal(found.name), intent: "local" };
  const placed = tryOrder(ledger, found.fill, litres);
  if (!placed.ok) return { text: brokeLine(placed.cost, ledger.credits), intent: "local" };
  return {
    text: orderAccept(found.name, litres, placed.cost),
    intent: "local",
    effect: { type: "order", fill: found.fill, name: found.name, litres, arrival: orderArrival(found.name, litres) },
  };
}

function reward(fill: Fill, name: string, ledger: Ledger): TalkReply {
  const accepted = acceptReward(ledger, fill, name);
  if (!accepted) return { text: "Blue is not waiting on a name.", intent: "local" };
  return {
    text: rewardAccept(name, accepted.nextName, accepted.reason),
    intent: "local",
    effect: { type: "reward", fill, name, arrival: rewardArrival(name) },
  };
}

export function stateCard(ledger: Ledger, rats: { name: string; status: string }[], memory: Memory): string {
  const greenLeft = Math.max(0, ledger.green.litres - ledger.green.filled);
  const blueLeft = Math.max(0, ledger.blue.litres - ledger.blue.filled);
  const lines = [
    `credits: ${ledger.credits}`,
    `green wants ${greenLeft} L of ${ledger.green.name} (${ledger.green.hex}) at $${ledger.green.pricePerLitre}/L, filled ${ledger.green.filled}, analogs ${ledger.green.allowAnalogs ? "yes" : "no"}`,
    `blue wants ${blueLeft} L of ${ledger.blue.name} (${ledger.blue.hex}), exact only, filled ${ledger.blue.filled}`,
    `awaiting reward name: ${ledger.awaitingReward ? "yes" : "no"}`,
    `rats: ${rats.map((rat) => `${rat.name} ${rat.status}`).join(", ") || "none"}`,
    memory.notes.length ? `notes: ${memory.notes.join(" | ")}` : "notes: none",
  ];
  return lines.join("\n");
}
