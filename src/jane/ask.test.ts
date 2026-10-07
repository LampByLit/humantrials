import { describe, expect, it } from "vitest";
import { replyTo, type TalkContext } from "./ask";
import { createLedger } from "./ledger";
import { arrivalBrief } from "./lines";

function ctx(seed = 7): TalkContext {
  return {
    ledger: createLedger(seed),
    rats: [
      { name: "Hood", status: "fed" },
      { name: "Albino", status: "hungry" },
    ],
    introduced: true,
  };
}

describe("Jane's local answers", () => {
  it("answers the opening books without a model", () => {
    const talk = ctx();
    expect(replyTo("what do the greens want", talk).text).toContain(talk.ledger.green.name);
    expect(replyTo("blue", talk).text).toContain("Thy Flesh Consumed");
    expect(replyTo("how much money do I have", talk).text).toContain("$500");
    expect(replyTo("who are you", talk).intent).toBe("local");
    expect(replyTo("why am I here", talk).text.toLowerCase()).toContain("recursion");
  });

  it("won't sell a stocktail", () => {
    const talk = ctx();
    const refused = replyTo("order 1 litre of sugar", talk);
    expect(refused.effect).toBeUndefined();
    expect(refused.text).toContain("stocktail");
    expect(talk.ledger.credits).toBe(500);
  });

  it("quotes and sells from the book", () => {
    const talk = ctx();
    expect(replyTo("how much is fentanyl", talk).text).toContain("$1,600");
    const bought = replyTo("order 1 litre of water", talk);
    expect(bought.effect?.type).toBe("order");
    expect(talk.ledger.credits).toBe(496);
    talk.ledger.credits = 0;
    const broke = replyTo("buy 1L of milk", talk);
    expect(broke.effect).toBeUndefined();
    expect(broke.text).toContain("$4");
    talk.ledger.credits = 20;
    const more = replyTo("buy 2L of milk", talk);
    expect(more.effect?.type).toBe("order");
    expect(talk.ledger.credits).toBe(12);
  });

  it("treats a bare name as blue's reward and a purchase as a purchase", () => {
    const talk = ctx();
    talk.ledger.awaitingReward = true;
    const reward = replyTo("caffeine", talk);
    expect(reward.effect?.type).toBe("reward");
    expect(talk.ledger.awaitingReward).toBe(false);
    talk.ledger.awaitingReward = true;
    talk.ledger.credits = 100;
    const bought = replyTo("order 1L water", talk);
    expect(bought.effect?.type).toBe("order");
    expect(talk.ledger.awaitingReward).toBe(true);
  });

  it("explains a drug from the catalog and refuses a route", () => {
    const talk = ctx();
    expect(replyTo("what is fentanyl", talk).text.toLowerCase()).toContain("numb");
    expect(replyTo("how do I make thy flesh consumed", talk).text.toLowerCase()).toContain("don't hand out");
    expect(replyTo("what do the rats eat", talk).text).toContain("Hood");
  });

  it("briefs a first meeting briefly", () => {
    const line = arrivalBrief();
    expect(line).toContain("I'm Jane");
    expect(line).toContain("experiment inside an experiment");
    expect(line.length).toBeLessThan(220);
  });

  it("sends an open question to the model", () => {
    expect(replyTo("does the ceiling know my name", ctx()).intent).toBe("model");
  });
});
