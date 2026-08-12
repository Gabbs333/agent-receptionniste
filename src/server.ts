import express from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { execSync } from "child_process";
import { prisma } from "./db";
import { analyzeMessage } from "./agent";
import { scoreLead } from "./leadScoring";
import { buildOfferMessage } from "./offerEngine";
import { HOTEL } from "./hotelConfig";
import {
  sendText,
  sendTyping,
  markAsRead,
} from "./whatsapp";
import adminRoutes from "./routes/admin";

dotenv.config();

// Anti-doublon : mémorise les IDs de messages déjà traités
const processedMessages = new Set<string>();
// Anti-flood : dernière réponse envoyée par contact (évite les réponses en rafale)
const lastReplyTime = new Map<string, number>();
const MIN_REPLY_INTERVAL_MS = 30_000; // 30 secondes minimum entre deux réponses
// Nettoie les anciens IDs toutes les 10 minutes pour éviter la fuite mémoire
setInterval(() => { if (processedMessages.size > 1000) { processedMessages.clear(); lastReplyTime.clear(); } }, 600_000);

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/admin", adminRoutes);

// ==================== WhatsApp Webhook Verification ====================

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    console.log("✅ Webhook verified");
    return res.status(200).send(String(challenge));
  }
  return res.sendStatus(403);
});

// ==================== WhatsApp Webhook Handler ====================

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    if (!entry) return res.sendStatus(200);

    const changes = entry.changes?.[0];
    const value = changes?.value;

    // --- Status callbacks (sent, delivered, read, failed) ---
    if (value?.statuses) {
      for (const status of value.statuses) {
        console.log(
          `📬 Message ${status.id}: ${status.status} (to: ${status.recipient_id})`,
        );
        if (status.errors) {
          console.error("  ↳ Errors:", JSON.stringify(status.errors));
        }
      }
      return res.sendStatus(200);
    }

    // --- Incoming messages ---
    const messages = value?.messages;
    const contacts = value?.contacts;
    if (!messages || !contacts || messages.length === 0) {
      return res.sendStatus(200);
    }

    // Process each message (usually 1, but can be multiple)
    for (const message of messages) {
      await handleIncomingMessage(message, contacts[0]);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(500);
  }
});

// ==================== Incoming Message Handler ====================

async function handleIncomingMessage(
  message: Record<string, unknown>,
  contact: Record<string, unknown>,
) {
  const phone = String(message.from ?? "");
  const messageId = String(message.id ?? "");
  const msgType = String(message.type ?? "unknown");

  // Éviter les doublons : WhatsApp peut renvoyer le même message
  if (processedMessages.has(messageId)) {
    console.log(`⏭️ Message doublon ignoré: ${messageId}`);
    return;
  }
  processedMessages.add(messageId);

  // Extraire le contenu texte du message
  const text = extractMessageText(message, msgType);

  // Ne pas traiter les messages sans contenu réel
  if (!text || text.length < 2) {
    console.log(`⏭️ Message ignoré (type=${msgType}, pas de contenu)`);
    processedMessages.add(messageId);
    return;
  }

  // Ne pas répondre à soi-même (messages sortants renvoyés par WhatsApp)

  // Get contact name
  const profile = (contact as Record<string, unknown>).profile as Record<string, unknown> | undefined;
  const name = (profile?.name as string) ?? null;

  // Mark as read
  try {
    await markAsRead(messageId);
  } catch {
    // Non-blocking
  }

  // Show typing indicator
  try {
    await sendTyping(phone, "typing_on");
  } catch {
    // Non-blocking
  }

  try {
    // Upsert lead
    const lead = await prisma.lead.upsert({
      where: { phone },
      update: {
        name: (name as string) ?? undefined,
        lastMessageAt: new Date(),
      },
      create: {
        phone,
        name: (name as string) ?? undefined,
        source: "whatsapp",
        lastMessageAt: new Date(),
      },
    });

    // Fetch conversation context (last 100 messages)
    const pastMessages = await prisma.message.findMany({
      where: { leadId: lead.id },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    const context = pastMessages
      .map((m) => `${m.direction}: ${m.content}`)
      .join("\n");

    // Rappeler à Gloria ce qu'elle sait déjà de ce lead
    const leadInfo = [
      lead.name ? `Nom: ${lead.name}` : null,
      lead.checkIn ? `Check-in: ${new Date(lead.checkIn).toLocaleDateString("fr-FR")}` : null,
      lead.checkOut ? `Check-out: ${new Date(lead.checkOut).toLocaleDateString("fr-FR")}` : null,
      lead.guests ? `Personnes: ${lead.guests}` : null,
      lead.roomType ? `Type chambre: ${lead.roomType}` : null,
      lead.budget ? `Budget: ${lead.budget.toLocaleString("fr-FR")} FCFA` : null,
    ].filter(Boolean).join(" | ");

    // Analyze with LLM (only for text-based messages)
    let analysis: Awaited<ReturnType<typeof analyzeMessage>> | null = null;
    if (text) {
      analysis = await analyzeMessage(text, context, leadInfo);
    } else {
      // Non-text message: use a simple fallback
      const { getLlmProvider, getDefaultModel } = await import("./llm/index");
      const llm = getLlmProvider();
      const raw = await llm.complete({
        model: getDefaultModel(),
        messages: [
          {
            role: "system",
            content:
              "Tu es un agent réceptionniste d'hôtel. Réponds UNIQUEMENT en JSON valide. Champs requis: intent, reply.",
          },
          {
            role: "user",
            content: `Contexte: ${context}\n\nLe client a envoyé un message de type "${msgType}" (image, audio, vidéo, document, localisation, etc.). Réponds poliment en demandant plus de détails.`,
          },
        ],
        temperature: 0.2,
      });
      try {
        const cleaned = raw
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();
        analysis = JSON.parse(cleaned);
      } catch {
        analysis = {
          intent: "other" as const,
          language: "fr" as const,
          needsHuman: false,
          reply: `Merci pour votre message ! Je ne peux pas traiter les ${msgType} pour le moment. Pouvez-vous m'écrire votre demande en texte ?`,
        };
      }
    }

    // Save inbound message (truncate if too long)
    const displayContent =
      text ||
      `[${msgType}${message.location ? `: ${JSON.stringify(message.location)}` : ""}]`;
    await prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "inbound",
        content: displayContent.slice(0, 1000),
        rawJson: JSON.stringify({ ...message, analysis }),
      },
    });

    // Build reply
    let reply = analysis?.reply ?? "";
    if (analysis?.intent === "reservation") {
      const offerMsg = await buildOfferMessage({
        guests: analysis.guests ?? undefined,
        budget: analysis.budget ?? undefined,
        checkIn: analysis.checkIn ? new Date(analysis.checkIn) : undefined,
        checkOut: analysis.checkOut ? new Date(analysis.checkOut) : undefined,
        roomType: analysis.roomType ?? undefined,
      });
      reply = analysis?.reply?.trim() || offerMsg;
    }

    // Handle human escalation
    if (analysis?.needsHuman) {
      reply =
        "Merci. Votre demande est transmise à notre équipe pour prise en charge. Quelqu'un va vous recontacter dans les meilleurs délais.";

      // Notifier l'équipe humaine sur WhatsApp
      const escalationMsg = `🚨 *ESCALADE CLIENT*

👤 *Nom:* ${name ?? "Non renseigné"}
📞 *Tél:* ${phone}
💬 *Demande:* ${analysis?.summary ?? text}
🏷 *Statut:* ${lead.status}
⭐ *Score:* ${lead.score}

_Répondre directement à ce client sur WhatsApp._`;

      for (const humanNumber of HOTEL.humanEscalationNumbers) {
        try {
          await sendText({ to: humanNumber, body: escalationMsg });
          console.log(`📤 Escalade envoyée à ${humanNumber}`);
        } catch (e) {
          console.error(`❌ Échec escalade vers ${humanNumber}`);
        }
      }
      await prisma.leadEvent.create({
        data: {
          leadId: lead.id,
          type: "escalation",
          payload: JSON.stringify({ reason: "needsHuman" }),
        },
      });
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: "needs_human", intent: analysis?.intent },
      });
      await prisma.message.create({
        data: { leadId: lead.id, direction: "outbound", content: reply },
      });
      await sendText({ to: phone, body: reply });
      return;
    }

    // Score the lead
    const score = scoreLead({
      budget: analysis?.budget ?? undefined,
      guests: analysis?.guests ?? undefined,
      checkIn: analysis?.checkIn ? new Date(analysis.checkIn) : undefined,
      checkOut: analysis?.checkOut ? new Date(analysis.checkOut) : undefined,
      responseDelayMinutes: 5,
      source: "whatsapp",
      roomType: analysis?.roomType ?? undefined,
      intent: analysis?.intent,
    });

    // Update lead data
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        score,
        status: score >= 80 ? "hot" : score >= 50 ? "warm" : "cold",
        intent: analysis?.intent,
        guests: analysis?.guests ?? undefined,
        budget: analysis?.budget ?? undefined,
        roomType: analysis?.roomType ?? undefined,
        checkIn: analysis?.checkIn ? new Date(analysis.checkIn) : undefined,
        checkOut: analysis?.checkOut ? new Date(analysis.checkOut) : undefined,
        language: analysis?.language,
      },
    });

    // Escalade automatique pour toute réservation confirmée
    if (analysis?.intent === "reservation" && analysis.checkIn && analysis.checkOut) {
      const reservationMsg = `🛎 *RÉSERVATION CONFIRMÉE*

👤 ${lead.name ?? "Inconnu"}
📞 ${phone}
🛏 ${analysis.roomType ?? "?"}
📅 ${new Date(analysis.checkIn).toLocaleDateString("fr-FR")} → ${new Date(analysis.checkOut).toLocaleDateString("fr-FR")}
👥 ${analysis.guests ?? "?"} pers
💰 ${analysis.budget ? analysis.budget.toLocaleString("fr-FR") + " FCFA" : "?"}
⭐ Score: ${score}`;

      for (const humanNumber of HOTEL.humanEscalationNumbers) {
        try {
          await sendText({ to: humanNumber, body: reservationMsg });
          console.log(`🛎 Réservation escaladée à ${humanNumber}`);
        } catch (e) {
          console.error(`❌ Échec escalade réservation vers ${humanNumber}`);
        }
      }

      await prisma.leadEvent.create({
        data: {
          leadId: lead.id,
          type: "reservation_confirmed",
          payload: JSON.stringify({ checkIn: analysis.checkIn, checkOut: analysis.checkOut, roomType: analysis.roomType, guests: analysis.guests, budget: analysis.budget }),
        },
      });
    }

    // Save offer record
    await prisma.offer.create({
      data: {
        leadId: lead.id,
        roomType: analysis?.roomType ?? "unknown",
        price: analysis?.budget ?? 0,
        notes: `intent=${analysis?.intent}; summary=${analysis?.summary ?? ""}`,
      },
    });

    // Save and send reply (with cooldown to avoid spam)
    const now = Date.now();
    const lastReply = lastReplyTime.get(phone) ?? 0;
    if (now - lastReply < MIN_REPLY_INTERVAL_MS) {
      console.log(`⏭️ Réponse ignorée (cooldown actif pour ${phone})`);
      return;
    }
    lastReplyTime.set(phone, now);

    await prisma.message.create({
      data: { leadId: lead.id, direction: "outbound", content: reply },
    });
    await sendText({ to: phone, body: reply });

    console.log(
      `✅ ${lead.name ?? phone}: intent=${analysis?.intent}, score=${score} (${score >= 80 ? "hot" : score >= 50 ? "warm" : "cold"})`,
    );
  } catch (err) {
    console.error(`❌ Error handling message from ${phone}:`, err);
    // Try to send a fallback message
    try {
      await sendText({
        to: phone,
        body: "Désolé, une erreur est survenue. Veuillez réessayer ou contacter notre équipe.",
      });
    } catch {
      // Last resort, give up
    }
  } finally {
    // Turn off typing indicator
    try {
      await sendTyping(phone, "typing_off");
    } catch {
      // Non-blocking
    }
  }
}

// ==================== Message Text Extraction ====================

function extractMessageText(
  message: Record<string, unknown>,
  type: string,
): string {
  switch (type) {
    case "text":
      return String((message.text as Record<string, unknown>)?.body ?? "");

    case "interactive": {
      const interactive = message.interactive as Record<string, unknown>;
      if (interactive?.type === "button_reply") {
        return String(
          (interactive.button_reply as Record<string, unknown>)?.title ?? "",
        );
      }
      if (interactive?.type === "list_reply") {
        return String(
          (interactive.list_reply as Record<string, unknown>)?.title ?? "",
        );
      }
      return "[Réponse interactive]";
    }

    case "button":
      return String(
        (message.button as Record<string, unknown>)?.text ?? "[Bouton]",
      );

    case "image":
      return (
        String(
          (message.image as Record<string, unknown>)?.caption ?? "",
        ) || "[Image]"
      );

    case "audio":
      return "[Message vocal]";

    case "video":
      return (
        String(
          (message.video as Record<string, unknown>)?.caption ?? "",
        ) || "[Vidéo]"
      );

    case "document":
      return (
        String(
          (message.document as Record<string, unknown>)?.caption ?? "",
        ) || "[Document]"
      );

    case "location": {
      const loc = message.location as Record<string, unknown>;
      return `[Localisation: ${loc?.latitude}, ${loc?.longitude}${loc?.name ? ` (${loc.name})` : ""}]`;
    }

    case "contacts":
      return "[Contact partagé]";

    case "sticker":
      return "[Sticker]";

    case "reaction": {
      const reaction = message.reaction as Record<string, unknown>;
      return `[Réaction: ${reaction?.emoji}]`;
    }

    case "order":
      return "[Commande]";

    case "unsupported":
      return "";

    default:
      return `[${type}]`;
  }
}

// ==================== Health Check ====================

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ==================== Rapport quotidien automatique ====================

async function sendDailyReport() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const [newLeads, hotLeads, warmLeads, coldLeads, todayMessages, escalees] =
      await Promise.all([
        prisma.lead.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
        prisma.lead.count({ where: { status: "hot", lastMessageAt: { gte: today } } }),
        prisma.lead.count({ where: { status: "warm", lastMessageAt: { gte: today } } }),
        prisma.lead.count({ where: { status: "cold", lastMessageAt: { gte: today } } }),
        prisma.message.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
        prisma.lead.count({ where: { status: "needs_human", updatedAt: { gte: today } } }),
      ]);

    // Derniers leads actifs aujourd'hui avec résumé
    const activeLeads = await prisma.lead.findMany({
      where: { lastMessageAt: { gte: today } },
      orderBy: { score: "desc" },
      take: 10,
      select: {
        name: true, phone: true, status: true, score: true, intent: true,
        checkIn: true, checkOut: true, roomType: true, guests: true, budget: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, direction: true } },
      },
    });

    const leadLines = activeLeads.map((l) => {
      const emoji = l.score >= 80 ? "🔥" : l.score >= 50 ? "🌤" : "❄";
      const lastMsg = l.messages[0];
      const preview = lastMsg
        ? `${lastMsg.direction === "inbound" ? "💬" : "📤"} ${lastMsg.content.slice(0, 60)}${lastMsg.content.length > 60 ? "..." : ""}`
        : l.intent ?? "—";

      // Réservation : afficher les détails
      let details = "";
      if (l.intent === "reservation" || (l.checkIn && l.checkOut)) {
        const ci = l.checkIn ? new Date(l.checkIn).toLocaleDateString("fr-FR") : "?";
        const co = l.checkOut ? new Date(l.checkOut).toLocaleDateString("fr-FR") : "?";
        const rt = l.roomType ?? "?";
        const g = l.guests ?? "?";
        const b = l.budget ? `${l.budget.toLocaleString("fr-FR")} FCFA` : "?";
        details = `   🛏 ${rt} · ${ci} → ${co} · ${g} pers · ${b}`;
      }

      return `${emoji} *${l.name ?? l.phone}* (${l.score}pts)
   ${preview}${details}`;
    }).join("\n");

    const report = `📊 *Rapport ${today.toLocaleDateString("fr-FR")}*

🆕 ${newLeads} nouveaux | 💬 ${todayMessages} msg | 🚨 ${escalees} escalade${escalees > 1 ? "s" : ""}
🔥 ${hotLeads} chauds | 🌤 ${warmLeads} tièdes | ❄ ${coldLeads} froids

${leadLines ? `👥 *Aujourd'hui*\n${leadLines}` : "Aucune activité aujourd'hui."}

_Bonne soirée !_ ✨`;

    for (const humanNumber of HOTEL.humanEscalationNumbers) {
      try {
        await sendText({ to: humanNumber, body: report });
        console.log(`📊 Rapport quotidien envoyé à ${humanNumber}`);
      } catch (e) {
        console.error(`❌ Échec rapport vers ${humanNumber}`);
      }
    }
  } catch (err) {
    console.error("❌ Erreur génération rapport:", err);
  }
}

// Planifier le rapport quotidien à 20h (heure du serveur UTC)
function scheduleDailyReport() {
  const now = new Date();
  const reportHour = 20; // 20h UTC = 21h Yaoundé
  const nextRun = new Date(now);
  nextRun.setHours(reportHour, 0, 0, 0);
  if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);

  const msUntilRun = nextRun.getTime() - now.getTime();
  console.log(`📊 Rapport quotidien programmé dans ${Math.round(msUntilRun / 3600000)}h (${nextRun.toISOString()})`);

  setTimeout(() => {
    sendDailyReport();
    // Ensuite toutes les 24h
    setInterval(sendDailyReport, 86400000);
  }, msUntilRun);
}

// ==================== Start ====================

// Auto-migrate database on startup
try {
  console.log("🔄 Syncing database schema...");
  execSync("npx prisma db push --skip-generate", { stdio: "inherit" });
  console.log("✅ Database schema synced");
} catch (err) {
  console.error("⚠️ Database sync failed:", String(err).slice(0, 300));
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🏨 HotelBot server running on port ${port}`);
  console.log(`   LLM Provider: ${process.env.LLM_PROVIDER ?? "openai"}`);
  console.log(`   Dashboard: http://localhost:${port}/admin/dashboard`);
  console.log(
    `   Availability: http://localhost:${port}/admin/availability-page`,
  );
  console.log(
    `   Webhook: POST http://localhost:${port}/webhook (verify: GET)`,
  );
  scheduleDailyReport();
});
