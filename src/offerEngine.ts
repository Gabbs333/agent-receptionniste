import { findOffers } from "./availability";

export async function buildOfferMessage(params: { guests?: number; budget?: number; checkIn?: Date; checkOut?: Date; }) {
  if (!params.checkIn || !params.checkOut) {
    return "Merci. Pouvez-vous préciser vos dates d’arrivée et de départ ?";
  }

  const offers = await findOffers(params);
  if (offers.length === 0) return "Je n’ai pas trouvé d’offre parfaitement adaptée. Voulez-vous que je vous propose les meilleures alternatives ?";

  const top = offers[0];
  return `Proposition disponible: ${top.roomType} à ${top.price.toLocaleString("fr-FR")} XAF. Souhaitez-vous d’autres options ou une réservation ?`;
}
