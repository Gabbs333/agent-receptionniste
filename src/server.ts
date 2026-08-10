import express from "express";
import dotenv from "dotenv";
import { prisma } from "./db";
import { analyzeMessage } from "./agent";
import { scoreLead } from "./leadScoring";
import { buildOfferMessage } from "./offerEngine";
import {
  sendText,
  sendTyping,
  markAsRead,
} from "./whatsapp";
import adminRoutes from "./routes/admin";

dotenv.config();

const app = express();
app.use(express.json());
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

  // Extract text content based on message type
  const text = extractMessageText(message, msgType);

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

    // Fetch conversation context (last 12 messages)
    const pastMessages = await prisma.message.findMany({
      where: { leadId: lead.id },
      orderBy: { createdAt: "asc" },
      take: 12,
    });
    const context = pastMessages
      .map((m) => `${m.direction}: ${m.content}`)
      .join("\n");

    // Analyze with LLM (only for text-based messages)
    let analysis: Awaited<ReturnType<typeof analyzeMessage>> | null = null;
    if (text) {
      analysis = await analyzeMessage(text, context);
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
        guests: analysis.guests,
        budget: analysis.budget,
        checkIn: analysis.checkIn ? new Date(analysis.checkIn) : undefined,
        checkOut: analysis.checkOut ? new Date(analysis.checkOut) : undefined,
      });
      reply = analysis?.reply?.trim() || offerMsg;
    }

    // Handle human escalation
    if (analysis?.needsHuman) {
      reply =
        "Merci. Votre demande est transmise à notre équipe pour prise en charge.";
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
      budget: analysis?.budget,
      guests: analysis?.guests,
      checkIn: analysis?.checkIn ? new Date(analysis.checkIn) : undefined,
      checkOut: analysis?.checkOut ? new Date(analysis.checkOut) : undefined,
      responseDelayMinutes: 5,
      source: "whatsapp",
      roomType: analysis?.roomType,
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

    // Save offer record
    await prisma.offer.create({
      data: {
        leadId: lead.id,
        roomType: analysis?.roomType ?? "unknown",
        price: analysis?.budget ?? 0,
        notes: `intent=${analysis?.intent}; summary=${analysis?.summary ?? ""}`,
      },
    });

    // Save and send reply
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

// ==================== Start ====================

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
});
