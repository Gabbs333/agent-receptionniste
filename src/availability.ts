import { prisma } from "./db";

export interface AvailabilityParams {
  guests?: number;
  budget?: number;
  checkIn?: Date;
  checkOut?: Date;
  roomType?: string;
}

export interface OfferResult {
  roomType: string;
  price: number;
  currency: string;
  date: string;
  available: number;
  notes?: string;
}

/**
 * Finds available rooms matching the given criteria.
 * Looks at RoomAvailability for the date range and filters by budget, guests, etc.
 */
export async function findOffers(
  params: AvailabilityParams,
): Promise<OfferResult[]> {
  if (!params.checkIn || !params.checkOut) return [];

  const availabilities = await prisma.roomAvailability.findMany({
    where: {
      date: { gte: params.checkIn, lte: params.checkOut },
      status: "open",
      available: { gt: 0 },
    },
    include: { roomType: true },
    orderBy: { price: "asc" },
  });

  let results: OfferResult[] = availabilities.map((a) => ({
    roomType: a.roomType.name,
    price: a.price,
    currency: a.currency,
    date: a.date.toISOString().split("T")[0],
    available: a.available,
    notes: a.notes ?? undefined,
  }));

  // Filter by budget if specified
  const budget = params.budget;
  if (budget != null) {
    results = results.filter((r) => r.price <= budget);
  }

  // Filter by room capacity if guests specified
  const guests = params.guests;
  if (guests != null) {
    results = results.filter((r) => {
      const capacity = availabilities.find(
        (a) => a.roomType.name === r.roomType,
      )?.roomType.capacity;
      return capacity != null && capacity >= guests;
    });
  }

  // Filter by specific room type
  if (params.roomType) {
    results = results.filter(
      (r) => r.roomType.toLowerCase() === params.roomType?.toLowerCase(),
    );
  }

  return results;
}

/** Returns all current availability records for the admin dashboard */
export async function getAllAvailability() {
  return prisma.roomAvailability.findMany({
    include: { roomType: true },
    orderBy: [{ date: "asc" }, { roomType: { name: "asc" } }],
  });
}

/** Upserts a room availability record */
export async function setAvailability(params: {
  roomTypeId: string;
  date: Date;
  available: number;
  price: number;
  currency?: string;
  minNights?: number;
  status?: string;
  notes?: string;
}) {
  return prisma.roomAvailability.upsert({
    where: {
      roomTypeId_date: {
        roomTypeId: params.roomTypeId,
        date: params.date,
      },
    },
    update: {
      available: params.available,
      price: params.price,
      currency: params.currency,
      minNights: params.minNights,
      status: params.status,
      notes: params.notes,
    },
    create: {
      roomTypeId: params.roomTypeId,
      date: params.date,
      available: params.available,
      price: params.price,
      currency: params.currency ?? "XAF",
      minNights: params.minNights ?? 1,
      status: params.status ?? "open",
      notes: params.notes,
    },
  });
}

/** Delete a single availability record */
export async function deleteAvailability(id: string) {
  return prisma.roomAvailability.delete({ where: { id } });
}
