import { litresText, moneyText } from "./format";

const GREEN_REASONS = [
  (name: string) =>
    `They want ${name}. A seal somewhere only answers to that exact frequency of light, they said, and then they stopped explaining.`,
  (name: string) =>
    `${name}. Someone upstairs is filling a chart and refuses to be missing a cell. I would admire the pettiness if I were paid to.`,
  (name: string) =>
    `The request is ${name}. Officially it is calibration. Unofficially, calibration is what they call an appetite.`,
  (name: string) => `${name}, one litre. A visitor is coming who can taste the difference. I did not ask what kind of visitor.`,
  (name: string) => `They circled ${name} as if it had insulted them. Bring a litre and the room can move on.`,
  (name: string) => `${name}. The note says "for the archive," which is how this building apologizes in advance.`,
  (name: string) =>
    `Green is collecting ${name}. They claim it stabilizes a reaction I have never seen go unstable. I signed the slip anyway.`,
  (name: string) => `${name}. A quiet order. The quiet ones are either dull or the ones that stain. We will know which.`,
];

const BLUE_REASONS = [
  (name: string) =>
    `Blue asks for ${name}. They wrote only: the recursion notices what it is fed. I have decided not to interpret that.`,
  (name: string) =>
    `${name}. The slip says the mirror is hungry on that frequency. Mirrors, in my experience, are hungry for whatever you hoped to keep.`,
  (name: string) =>
    `They want ${name}. "To close a parenthesis opened in a room you have not been in." Their punctuation, not mine.`,
  (name: string) =>
    `${name}. A marginal note: bring the thing that remembers being ${name}. I don't know what they think matter remembers. I do know they don't take cousins.`,
  (name: string) =>
    `Blue's next appetite is ${name}. A key, they say, that only fits a lock made of the same absence. I poured myself water and felt briefly better.`,
  (name: string) =>
    `${name}. "For the inner experiment," as if the outer one were having a pleasant day. It is not.`,
  (name: string) => `They named ${name} and, underneath, "so the trial can hear itself." I am not paid to find that comforting.`,
  (name: string) => `${name}. A debt the color owes the color. Exact hex. They were underlining.`,
];

export function greenReason(name: string, rng: () => number): string {
  return GREEN_REASONS[Math.floor(rng() * GREEN_REASONS.length)](name);
}

export function blueReason(name: string, rng: () => number): string {
  return BLUE_REASONS[Math.floor(rng() * BLUE_REASONS.length)](name);
}

export type Want = {
  name: string;
  litres: number;
  filled: number;
  pricePerLitre: number;
  generation: number;
  reason: string;
};

export function experimentLine(): string {
  return "You were selected for the human-trial arm of an experiment inside an experiment. They are researching recursion. A mirror pointed at a mirror, if you want it shorter. Your part is the hexchemistry.";
}

export function rehabLine(): string {
  return "I hope you're recovering from the accident, and that rehab is going well. It usually does, until someone gets curious.";
}

export function greenWant(want: Want): string {
  const left = Math.max(0, want.litres - want.filled);
  if (want.generation === 0 && want.filled <= 0) {
    return "Green wants one litre of fentanyl. A thousand dollars, on your account, after I have looked at it. The glass goes on the green counter. I come about a minute later, one vessel at a time. Cousins of the color are paid on a sliding scale. They are not sentimental.";
  }
  const progress = want.filled > 0.01 ? ` They already have ${litresText(want.filled)}.` : "";
  return `Green wants ${litresText(left)} of ${want.name}. ${moneyText(want.pricePerLitre)} a litre, analogs on a scale.${progress} ${want.reason}`;
}

export function blueWant(want: Want): string {
  const left = Math.max(0, want.litres - want.filled);
  if (want.generation === 0 && want.filled <= 0) {
    return "Blue wants one litre of Thy Flesh Consumed, hex 398514. Exact. They do not take analogs. In return, one litre of any hexchem you name. The glass goes on the blue counter. I put their answer on the red counter.";
  }
  const progress = want.filled > 0.01 ? ` They already have ${litresText(want.filled)}.` : "";
  return `Blue wants ${litresText(left)} of ${want.name}. Exact hex, no cousins. The reward is still one litre of whatever you name.${progress} ${want.reason}`;
}

export function redWant(): string {
  return "Red has not sent a list. When they do, I will tell you. They prefer to arrive as if the delay had been their idea.";
}

export type GreenReport = {
  name: string;
  exact: number;
  analog: number;
  rejected: number;
  surplus: number;
  pay: number;
  left: number;
  complete: boolean;
  next: { name: string; price: number; reason: string } | null;
};

export function greenReport(report: GreenReport): string {
  if (report.exact <= 0 && report.analog <= 0) {
    return `I had it looked at. It is not ${report.name}, and it is not near enough to invoice. Green sends nothing. The glass stays with me.`;
  }
  const parts: string[] = [];
  if (report.exact > 0) parts.push(`${litresText(report.exact)} of ${report.name}`);
  if (report.analog > 0) parts.push(`${litresText(report.analog)} on the cousin scale`);
  let line = `Green is taking ${parts.join(" and ")}. ${moneyText(report.pay)} on your account.`;
  if (report.rejected > 0) line += " The rest was not theirs.";
  if (report.surplus > 0.02) line += " The extra was not on the slip. I kept it anyway.";
  if (report.complete && report.next) {
    line += ` That closes the order. Next they want one litre of ${report.next.name}. ${moneyText(report.next.price)} a litre. ${report.next.reason}`;
  } else if (!report.complete) line += ` They still want ${litresText(report.left)}.`;
  return line;
}

export type BlueReport = {
  name: string;
  hex: string;
  exact: number;
  cousins: number;
  rejected: number;
  left: number;
  complete: boolean;
};

export function blueReport(report: BlueReport): string {
  if (report.exact <= 0) {
    if (report.cousins > 0) {
      return `Blue sent nothing. They wanted ${report.name}, not a cousin. Analogs are not a dialect they speak. The glass stays with me.`;
    }
    return `Blue wanted ${report.name}, hex ${report.hex}. This was not it. They do not pay in apologies.`;
  }
  let line = `${report.name}, confirmed. ${litresText(report.exact)} toward the litre.`;
  if (report.complete) {
    line += " That is the litre. They will answer with one litre of any hexchem you name. Say the name, or the hex. Be exact.";
  } else line += ` They still want ${litresText(report.left)}.`;
  if (report.rejected > 0) line += " The rest was refused.";
  return line;
}

export function rewardAccept(name: string, nextName: string, reason: string): string {
  return `Blue will send one litre of ${name}. I'll bring it to the red counter. Give me a minute. Their next interest is ${nextName}. ${reason}`;
}

export function rewardArrival(name: string): string {
  return `${name} is on the red counter. One litre. Blue calls that even.`;
}

export function orderAccept(name: string, litres: number, cost: number): string {
  return `${litresText(litres)} of ${name}. ${moneyText(cost)}. I'll finish what I'm holding and bring it to the red counter. About a minute.`;
}

export function orderArrival(name: string, litres: number): string {
  return `Your ${litresText(litres)} of ${name} is on the red counter.`;
}

export function brokeLine(cost: number, credits: number): string {
  return `That is ${moneyText(cost)}. You have ${moneyText(credits)}. I don't extend credit. That would be a different profession.`;
}

export function orderLimitLine(): string {
  return "Eight litres is as much as I will put on that counter in one trip. Fifty millilitres is as little. Order it in pieces.";
}

export function missingNameLine(): string {
  return "I don't have that name in the book. Give me the color's name, or the hex.";
}

export function priceLine(name: string, price: number, litres: number | null, cost: number | null): string {
  const base = `${name} is ${moneyText(price)} a litre.`;
  if (litres === null || cost === null) return base;
  return `${base} ${litresText(litres)} would be ${moneyText(cost)}.`;
}

export function balanceLine(credits: number): string {
  return `You have ${moneyText(credits)} on the account. I am the only one who adds to it.`;
}

export function whoLine(): string {
  return "Jane. I keep the books for green and blue, I move the glass, and I replace the rats. The wisdom is real. It arrives late, like most honest things.";
}

export function helloLine(): string {
  return "I'm here. The counters are where I left them.";
}

export function thanksLine(): string {
  return "Noted. I'll spend it on nothing.";
}

export function unstackLine(): string {
  return "There is glass inside glass on that counter. I carry one vessel. Unstack it, and I will come back.";
}

export function emptyCounterLine(): string {
  return "The counter was clear when I arrived. I'm not offended. I'm also not paying for the memory of a beaker.";
}

export function ratReplaceLine(name: string, cause: string | null): string {
  const why = cause ? ` The note says ${cause}.` : "";
  return `${name} didn't make it.${why} I've put another in the cage. Same name. Try to be less interesting at them.`;
}

export function ratDeathLine(name: string): string {
  return `${name} is down. I'll bring a replacement when my hands are empty.`;
}

export function ratHelp(rows: { name: string; status: string }[]): string {
  const roll = rows.length === 0 ? "The cages are empty, which is not the arrangement." : `${rows.map((row) => `${row.name} is ${row.status}`).join(". ")}.`;
  return `${roll} Hood, Albino, Ink, and Brindle live in the cages by the color counters. You cannot move the cages. Pour food on them and they eat: wormmeal, kelpmash, beetmash, and the named cousins. Pour anything else and it is a dose. They run hotter than you, and they get hungry sooner. When one dies, I replace it.`;
}

export function submitHelp(): string {
  return "Green glass goes on the green counter. Blue glass goes on the blue counter. About a minute later I come through the south door and take one vessel at a time. Green pays for fentanyl and, later, for whatever named color they have asked for. Analogs count there, at a discount. Blue takes only the exact hex, and pays with a litre of your choosing, which I leave on red. Red is not buying yet.";
}

export function analogHelp(): string {
  return "An analog is a near color of a catalog chemical. Green pays it on a scale: closer cousins are worth more, distant ones less, and none of them are worth the real article. Blue does not take them at all. If you wanted the compliment, green is the counter.";
}

export function controlHelp(): string {
  return "Look down to reach. Scroll reaches further. Hold the left mouse button, or double click, to grip. Hold Space and move the mouse to tip and pour. Shift is slow, Alt is run, F brings in the other hand, Q darkens the lab. Look all the way up and pour on yourself to drink. Push the large button by the south door with your hand and I will come. When I am in the room, E is beside me. C is the controls, H is your body.";
}

export function mixHelp(): string {
  return "Pour one hex into another and you get a new hex. The colors meet like dyes. It is not both drugs at once. Water changes how much of the hex is in the litre, not which hex it is. An elemental will not split in the demixer. The cabinet on the east side will name a pour, and it keeps what you give it. I don't hand out routes. That would bore the mirror, and they are worse when they are bored.";
}

export function craftLine(name: string, hex: string | null): string {
  const named = hex ? `${name} is ${hex}. ` : "";
  return `${named}I don't hand out the route. Mix, split what the demixer will split, and read the cabinet. The trial is the finding of it.`;
}

export function chemNote(name: string, hex: string, note: string | null, latin: string): string {
  if (note) return `${name}. ${note} Hex ${hex}.`;
  return `${name}. Hex ${hex}. ${latin}. A color from the book, not one of the named drugs.`;
}

export function pilotLine(): string {
  return "Ten millilitres of 100 Mph, hex C93F38, opens the names. Until then the eyedropper only admits chemicals it already knows, and their analogs. The cabinet on the east side is less shy. It will read a pour out loud, and it will keep the sample.";
}

export function analyzerLine(): string {
  return "The cabinet on the east side is an analyzer. Pour into the well. It prints the name it has, and the latin, and then the well is empty. I would not pour the last of something you meant to sell.";
}

export function lineDown(): string {
  return "The upstairs line is dead. Ask me something I can answer from the bench. The book still works.";
}

export function stillOnLine(): string {
  return "I'm already on the line. One question at a time. I'm not a chorus.";
}
