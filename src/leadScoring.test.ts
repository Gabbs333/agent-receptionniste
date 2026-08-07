import { scoreLead } from "./leadScoring";

describe("scoreLead", () => {
  it("returns 0 for an empty lead", () => {
    expect(scoreLead({})).toBe(0);
  });

  it("reservation intent gives +20, minus checkIn penalty if missing", () => {
    // 20 - 10 (no checkIn) - 15 (budget 0 < 30000) = -5 -> floor 0
    expect(scoreLead({ intent: "reservation" })).toBe(0);
    // With checkIn: 20 - 0 - 15 (budget 0) = 5
    expect(
      scoreLead({ intent: "reservation", checkIn: new Date("2026-08-10") }),
    ).toBe(5);
    // With budget >= 50000: 20 + 20 - 0 = 40
    expect(
      scoreLead({
        intent: "reservation",
        budget: 50000,
        checkIn: new Date("2026-08-10"),
      }),
    ).toBe(40);
  });

  it("checkIn+checkOut gives +25, minus low budget penalty", () => {
    // 25 - 15 (budget 0) = 10
    expect(
      scoreLead({
        checkIn: new Date("2026-08-10"),
        checkOut: new Date("2026-08-15"),
      }),
    ).toBe(10);
  });

  it("budget >= 50000 gives +20, minus checkIn penalty", () => {
    // 20 - 10 (no checkIn) = 10
    expect(scoreLead({ budget: 50000 })).toBe(10);
    expect(scoreLead({ budget: 100000 })).toBe(10);
    // 49999 >= 50000? No. But 49999 >= 30000 so no penalty either. Only -10 for checkIn.
    // 0 - 10 = -10 -> floor 0
    expect(scoreLead({ budget: 49999 })).toBe(0);
  });

  it("guests give +10 for 2+, +20 for 4+ (minus penalties)", () => {
    // 10 - 10 - 15 = -15 -> floor 0
    expect(scoreLead({ guests: 2 })).toBe(0);
    // 20 - 10 - 15 = -5 -> floor 0
    expect(scoreLead({ guests: 4 })).toBe(0);
    // 0 - 10 - 15 = -25 -> floor 0
    expect(scoreLead({ guests: 1 })).toBe(0);
  });

  it("fast response gives +15 (minus penalties)", () => {
    // 15 - 10 - 15 = -10 -> floor 0
    expect(scoreLead({ responseDelayMinutes: 30 })).toBe(0);
    expect(scoreLead({ responseDelayMinutes: 31 })).toBe(0);
  });

  it("WhatsApp source gives +10 (minus penalties)", () => {
    // 10 - 10 - 15 = -15 -> floor 0
    expect(scoreLead({ source: "whatsapp" })).toBe(0);
    expect(scoreLead({ source: "web" })).toBe(0);
  });

  it("suite room type gives +10 (minus penalties)", () => {
    // 10 - 10 - 15 = -15 -> floor 0
    expect(scoreLead({ roomType: "suite" })).toBe(0);
    expect(scoreLead({ roomType: "standard" })).toBe(0);
  });

  it("penalizes low budget by -15", () => {
    // 0 - 10 (no checkIn) - 15 = -25 -> floor 0
    expect(scoreLead({ budget: 29999 })).toBe(0);
    expect(scoreLead({ budget: 10000 })).toBe(0);
  });

  it("caps score at 100", () => {
    const score = scoreLead({
      intent: "reservation",
      checkIn: new Date("2026-08-10"),
      checkOut: new Date("2026-08-15"),
      budget: 100000,
      guests: 5,
      responseDelayMinutes: 5,
      source: "whatsapp",
      roomType: "suite",
    });
    // 20 + 25 + 20 + 10 + 10 + 15 + 10 + 10 = 120, capped at 100
    expect(score).toBe(100);
  });

  it("correctly scores a warm lead", () => {
    const score = scoreLead({
      intent: "reservation",
      checkIn: new Date("2026-08-10"),
      checkOut: new Date("2026-08-15"),
      budget: 35000,
      guests: 1,
      source: "whatsapp",
    });
    // 20 + 25 + 0 + 0 + 0 + 10 = 55
    expect(score).toBe(55);
  });

  it("correctly scores a cold lead", () => {
    const score = scoreLead({
      intent: "faq",
      responseDelayMinutes: 60,
    });
    // 0 - 10 - 15 = -25 -> floor 0
    expect(score).toBe(0);
  });
});
