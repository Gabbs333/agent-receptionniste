/**
 * Configuration de l'hôtel — modifiable sans toucher au code métier.
 */
export const HOTEL = {
  name: "Hôtel Conrad Grand Luxury",
  city: "Yaoundé",
  country: "Cameroun",
  currency: "FCFA",
  currencySymbol: "F CFA",
  timezone: "Africa/Douala",
  phone: "+237 6 90 00 00 00",
  email: "reservation@conradgrandluxury.cm",
  address: "Carrefour Beignets, Rue Manguiers, face Station Confex Oil, Yaoundé",

  /** Nombre total d'étoiles */
  stars: 4,

  /** Langues parlées par l'agent */
  languages: ["fr", "en"] as const,

  /** Réduction maximale que le réceptionniste peut accorder (%) */
  maxDiscountPercent: 30,

  /** Services réellement disponibles dans l'hôtel */
  services: [
    "Wi-Fi haut débit gratuit dans tout l'établissement",
    "Climatisation individuelle dans chaque chambre",
    "Restaurant Premium Le Manguier d'Or (cuisine camerounaise et internationale)",
    "Snack-Bar chic & lounge (ouvert le week-end, ambiance musicale)",
    "Navette aéroport sur réservation",
    "Parking privé sécurisé",
    "Service de chambre 12h/24",
    "Petit-déjeuner buffet offert",
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
        "Chambre confortable de 28 m² avec lit queen-size, bureau, salle de bain privative, douche à l'italienne. Wi-Fi, climatisation, minibar, TV écran plat, coffre-fort. Vue sur le jardin.",
    },
    premium: {
      name: "Chambre Premium",
      basePrice: 30000,
      totalQuantity: 6,
      capacity: 2,
      description:
        "Chambre spacieuse de 35 m² avec lit king-size, coin salon, balcon privé. Salle de bain en marbre avec baignoire et douche. Wi-Fi, climatisation, minibar, machine Nespresso, TV 4K.",
    },
    suiteStandard: {
      name: "Suite Standard",
      basePrice: 45000,
      totalQuantity: 2,
      capacity: 3,
      description:
        "Suite de 55 m² avec chambre séparée, salon privé, deux salles de bain, terrasse. Literie king-size, canapé-lit, bureau. Idéal pour les familles ou séjours prolongés.",
    },
    suitePremium: {
      name: "Suite Premium",
      basePrice: 75000,
      totalQuantity: 2,
      capacity: 4,
      description:
        "Notre plus belle suite, 80 m² avec chambre principale, salon, salle à manger privée, deux salles de bain en marbre. Vue panoramique sur les collines de Yaoundé. Service privilège inclus.",
    },
  },

  /** Politique d'annulation */
  cancellationPolicy:
    "Annulation gratuite jusqu'à 48h avant l'arrivée. Au-delà, la première nuit est facturée. Pour les suites Premium, annulation gratuite jusqu'à 72h avant.",

  /** Positionnement marketing */
  tagline: "Le haut standing à prix accessible, au cœur de Yaoundé.",
} as const;

export function buildHotelContext(): string {
  const roomLines = Object.entries(HOTEL.rooms).map(([key, room]) => {
    return `• ${room.name} : ${room.basePrice.toLocaleString("fr-FR")} ${HOTEL.currency}/nuit (${room.totalQuantity} dispo., max ${room.capacity} pers.) — ${room.description}`;
  });

  return `🏨 INFORMATIONS HÔTEL — CONFIDENTIEL RÉCEPTION

Nom: ${HOTEL.name} (${HOTEL.stars} étoiles)
Adresse: ${HOTEL.address}
Téléphone: ${HOTEL.phone} | Email: ${HOTEL.email}
Check-in: ${HOTEL.checkInTime} | Check-out: ${HOTEL.checkOutTime}
Positionnement: ${HOTEL.tagline}

🛏️ TARIFS OFFICIELS (à respecter scrupuleusement)
${roomLines.join("\n\n")}

⚠️ RÈGLE TARIFAIRE STRICTE :
- Le prix de base est ${roomLines[0]?.split(":")[0] ?? "la chambre standard"} à 25 000 FCFA/nuit
- Tu PEUX accorder une réduction (max ${HOTEL.maxDiscountPercent}%) UNIQUEMENT si :
  → Séjour ≥ 7 nuits : jusqu'à -30%
  → Séjour ≥ 4 nuits : jusqu'à -20%
  → Séjour ≥ 2 nuits : jusqu'à -10%
  → Réservation de 3 chambres ou plus : jusqu'à -30%
- N'annonce JAMAIS le pourcentage. Intègre-le naturellement : « pour un séjour de 5 nuits, je peux vous proposer un tarif préférentiel à 24 000 FCFA au lieu de 30 000 FCFA »
- Ne JAMAIS réduire un prix déjà réduit
- Le client qui demande pour 1-2 nuits paie le tarif normal — NE PAS lui accorder de réduction

🎁 SERVICES
${HOTEL.services.map((s) => "• " + s).join("\n")}

📋 ANNULATION
${HOTEL.cancellationPolicy}`;
}
