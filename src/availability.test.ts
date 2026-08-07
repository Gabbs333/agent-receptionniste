import { findOffers } from "./availability";

// Mock the db module
jest.mock("./db", () => ({
  prisma: {
    roomAvailability: {
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from "./db";

describe("findOffers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockAvailabilities = [
    {
      roomType: { name: "Standard", capacity: 2 },
      price: 30000,
      currency: "XAF",
      date: new Date("2026-08-10"),
      available: 2,
      notes: null,
    },
    {
      roomType: { name: "Deluxe", capacity: 3 },
      price: 50000,
      currency: "XAF",
      date: new Date("2026-08-10"),
      available: 3,
      notes: "Vue mer",
    },
    {
      roomType: { name: "Suite", capacity: 4 },
      price: 80000,
      currency: "XAF",
      date: new Date("2026-08-10"),
      available: 1,
      notes: null,
    },
  ];

  it("returns empty array when no dates provided", async () => {
    const result = await findOffers({});
    expect(result).toEqual([]);
  });

  it("filters by budget", async () => {
    (prisma.roomAvailability.findMany as jest.Mock).mockResolvedValue(
      mockAvailabilities,
    );
    const result = await findOffers({
      checkIn: new Date("2026-08-10"),
      checkOut: new Date("2026-08-12"),
      budget: 40000,
    });
    expect(result).toHaveLength(1);
    expect(result[0].roomType).toBe("Standard");
  });

  it("filters by guests (capacity)", async () => {
    (prisma.roomAvailability.findMany as jest.Mock).mockResolvedValue(
      mockAvailabilities,
    );
    const result = await findOffers({
      checkIn: new Date("2026-08-10"),
      checkOut: new Date("2026-08-12"),
      guests: 3,
    });
    // Standard has capacity 2, Deluxe 3, Suite 4
    expect(result.map((r) => r.roomType)).toEqual(["Deluxe", "Suite"]);
  });

  it("filters by room type", async () => {
    (prisma.roomAvailability.findMany as jest.Mock).mockResolvedValue(
      mockAvailabilities,
    );
    const result = await findOffers({
      checkIn: new Date("2026-08-10"),
      checkOut: new Date("2026-08-12"),
      roomType: "suite",
    });
    expect(result).toHaveLength(1);
    expect(result[0].roomType).toBe("Suite");
  });

  it("returns empty when all filtered out", async () => {
    (prisma.roomAvailability.findMany as jest.Mock).mockResolvedValue(
      mockAvailabilities,
    );
    const result = await findOffers({
      checkIn: new Date("2026-08-10"),
      checkOut: new Date("2026-08-12"),
      budget: 10000,
    });
    expect(result).toEqual([]);
  });
});
