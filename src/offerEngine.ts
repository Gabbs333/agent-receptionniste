import { findOffers } from "./availability";
import { HOTEL } from "./hotelConfig";

export async function buildOfferMessage(params: {
  guests?: number;
  budget?: number;
  checkIn?: Date;
  checkOut?: Date;
  roomType?: string;
}) {
  if (!params.checkIn || !params.checkOut) {
    return "Afin de vous proposer nos meilleures disponibilités, pourriez-vous m'indiquer vos dates d'arrivée et de départ ?";
  }

  const offers = await findOffers(params);

  if (offers.length === 0) {
    const roomList = Object.values(HOTEL.rooms)
      .map((r) => `• ${r.name} à partir de ${r.basePrice.toLocaleString("fr-FR")} ${HOTEL.currency}/nuit`)
      .join("\n");
    return `Malheureusement, je ne trouve pas de disponibilité exacte pour ces dates. Voici nos tarifs habituels :\n\n${roomList}\n\nSouhaitez-vous que je vérifie des dates alternatives ? Ou puis-je transmettre votre demande à notre équipe commerciale pour une recherche approfondie ?`;
  }

  if (offers.length === 1) {
    const top = offers[0];
    const roomInfo = Object.values(HOTEL.rooms).find(
      (r) => r.name === top.roomType,
    );
    const desc = roomInfo?.description?.split(".")[0] ?? "";
    return `Excellente nouvelle ! J'ai une disponibilité pour vous :\n\n✨ *${top.roomType}*\n💰 ${top.price.toLocaleString("fr-FR")} ${HOTEL.currency} / nuit\n📅 Le ${top.date}\n🛏️ ${desc}.\n\nSouhaitez-vous réserver ou préférez-vous voir d'autres options ?`;
  }

  const top3 = offers.slice(0, 3);
  const lines = top3.map(
    (o, i) =>
      `${i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"} *${o.roomType}* — ${o.price.toLocaleString("fr-FR")} ${HOTEL.currency}/nuit`,
  );

  return `Voici nos meilleures disponibilités pour vos dates :\n\n${lines.join("\n")}\n\nLaquelle vous inspire le plus ? Je peux vous décrire chaque option en détail.`;
}
