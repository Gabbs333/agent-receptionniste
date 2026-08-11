/**
 * Configuration de l'hôtel — modifiable sans toucher au code métier.
 */
export const HOTEL = {
  name: "Hôtel Le Paradis",
  city: "Abidjan",
  country: "Côte d'Ivoire",
  currency: "FCFA",
  currencySymbol: "F CFA",
  timezone: "Africa/Abidjan",
  phone: "+225 01 02 03 04 05",
  email: "contact@hotelleparadis.ci",
  address: "Boulevard Lagunaire, Cocody, Abidjan",

  /** Nombre total d'étoiles (influence le ton du réceptionniste) */
  stars: 5,

  /** Langues parlées par l'agent */
  languages: ["fr", "en"] as const,

  /** Services proposés */
  services: [
    "Wi-Fi haut débit gratuit",
    "Climatisation",
    "Piscine à débordement",
    "Spa & Centre de bien-être",
    "Service en chambre 24h/24",
    "Restaurant gastronomique Le Baobab",
    "Bar lounge Le Rooftop",
    "Navette aéroport gratuite",
    "Conciergerie personnalisée",
    "Parking sécurisé",
    "Salle de fitness",
    "Petit-déjeuner buffet inclus",
  ],

  /** Check-in / Check-out */
  checkInTime: "14:00",
  checkOutTime: "12:00",

  /** Types de chambres et suites */
  rooms: {
    standard: {
      name: "Chambre Standard",
      basePrice: 25000,
      totalQuantity: 6,
      capacity: 2,
      description:
        "Chambre élégante de 28 m² avec lit queen-size, bureau, salle de bain privative avec douche à l'italienne, vue sur le jardin. Wi-Fi, climatisation, minibar, coffre-fort, TV écran plat.",
    },
    premium: {
      name: "Chambre Premium",
      basePrice: 30000,
      totalQuantity: 6,
      capacity: 2,
      description:
        "Chambre raffinée de 35 m² avec lit king-size, coin salon, balcon privé, salle de bain en marbre avec baignoire et douche séparées. Wi-Fi, climatisation, minibar, Nespresso, coffre-fort, TV 4K.",
    },
    suiteStandard: {
      name: "Suite Standard",
      basePrice: 45000,
      totalQuantity: 2,
      capacity: 3,
      description:
        "Suite spacieuse de 55 m² avec chambre séparée, salon, deux salles de bain, terrasse panoramique. Literie king-size, canapé convertible, bureau exécutif. Service de majordome sur demande.",
    },
    suitePremium: {
      name: "Suite Premium",
      basePrice: 75000,
      totalQuantity: 2,
      capacity: 4,
      description:
        "Notre suite d'exception de 80 m² avec chambre principale, salon, salle à manger privée, deux salles de bain en marbre, jacuzzi sur la terrasse. Vue imprenable sur la lagune. Service majordome inclus, Champagne de bienvenue.",
    },
  },

  /** Politique d'annulation */
  cancellationPolicy:
    "Annulation gratuite jusqu'à 48h avant l'arrivée. Au-delà, la première nuit est facturée. Pour les suites Premium, annulation gratuite jusqu'à 72h avant.",
} as const;

/**
 * Construit un résumé textuel de toutes les chambres pour le prompt LLM.
 */
export function buildHotelContext(): string {
  const roomLines = Object.entries(HOTEL.rooms).map(([key, room]) => {
    return `• ${room.name} : ${room.basePrice.toLocaleString("fr-FR")} ${HOTEL.currency} / nuit (${room.totalQuantity} disponibles, max ${room.capacity} pers.) — ${room.description}`;
  });

  return `🏨 INFORMATIONS HÔTEL — CONFIDENTIEL RÉCEPTIONNISTE

Nom: ${HOTEL.name}
Étoiles: ${"⭐".repeat(HOTEL.stars)}
Adresse: ${HOTEL.address}
Téléphone: ${HOTEL.phone}
Email: ${HOTEL.email}
Ville: ${HOTEL.city}, ${HOTEL.country}
Monnaie: ${HOTEL.currency}
Check-in: ${HOTEL.checkInTime} | Check-out: ${HOTEL.checkOutTime}

🛏️ CHAMBRES & SUITES
${roomLines.join("\n\n")}

🎁 SERVICES
${HOTEL.services.map((s) => "• " + s).join("\n")}

📋 POLITIQUE D'ANNULATION
${HOTEL.cancellationPolicy}`;
}
