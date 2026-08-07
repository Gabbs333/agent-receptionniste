export function scoreLead(data: {
  budget?: number;
  guests?: number;
  checkIn?: Date;
  checkOut?: Date;
  responseDelayMinutes?: number;
  source?: string;
  roomType?: string;
  intent?: string;
}) {
  let score = 0;

  if (data.intent === "reservation") score += 20;
  if (data.checkIn && data.checkOut) score += 25;
  if ((data.budget ?? 0) >= 50000) score += 20;
  if ((data.guests ?? 0) >= 2) score += 10;
  if ((data.guests ?? 0) >= 4) score += 10;
  if ((data.responseDelayMinutes ?? 9999) <= 30) score += 15;
  if (data.source === "whatsapp") score += 10;
  if (data.roomType === "suite") score += 10;
  if ((data.budget ?? 0) < 30000) score -= 15;
  if (!data.checkIn) score -= 10;

  return Math.max(0, Math.min(100, score));
}
