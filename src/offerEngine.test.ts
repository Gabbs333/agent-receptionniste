import { buildOfferMessage } from "./offerEngine";

// Mock the availability module
jest.mock("./availability", () => ({
  findOffers: jest.fn(),
}));

import { findOffers } from "./availability";

describe("buildOfferMessage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("asks for dates when check-in is missing", async () => {
    const result = await buildOfferMessage({});
    expect(result).toContain("dates");
  });

  it("asks for dates when check-out is missing", async () => {
    const result = await buildOfferMessage({
      checkIn: new Date("2026-08-10"),
    });
    expect(result).toContain("dates");
  });

  it("returns fallback message when no offers found", async () => {
    (findOffers as jest.Mock).mockResolvedValue([]);
    const result = await buildOfferMessage({
      checkIn: new Date("2026-08-10"),
      checkOut: new Date("2026-08-15"),
    });
    expect(result).toContain("pas trouvé");
  });

  it("returns the top offer when available", async () => {
    (findOffers as jest.Mock).mockResolvedValue([
      { roomType: "Deluxe", price: 50000, currency: "XAF", date: "2026-08-10", available: 3 },
      { roomType: "Standard", price: 30000, currency: "XAF", date: "2026-08-10", available: 1 },
    ]);
    const result = await buildOfferMessage({
      checkIn: new Date("2026-08-10"),
      checkOut: new Date("2026-08-15"),
      budget: 60000,
      guests: 2,
    });
    expect(result).toContain("Deluxe");
    expect(result).toContain("50 000");
    expect(findOffers).toHaveBeenCalledWith({
      checkIn: expect.any(Date),
      checkOut: expect.any(Date),
      budget: 60000,
      guests: 2,
    });
  });
});
