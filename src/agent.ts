import { z } from "zod";
import { getLlmProvider, getDefaultModel } from "./llm/index";

export const AnalysisSchema = z.object({
  intent: z.enum(["reservation", "faq", "pricing", "support", "other"]),
  guests: z.number().int().optional(),
  budget: z.number().int().optional(),
  roomType: z.string().optional(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  language: z.enum(["fr", "en"]).default("fr"),
  needsHuman: z.boolean().default(false),
  summary: z.string().optional(),
  reply: z.string(),
});

export type Analysis = z.infer<typeof AnalysisSchema>;

export async function analyzeMessage(
  text: string,
  context: string,
): Promise<Analysis> {
  const llm = getLlmProvider();
  const model = getDefaultModel();

  const system = `Tu es un agent réceptionniste d'hôtel. Réponds uniquement en JSON valide. Champs requis: intent, guests, budget, roomType, checkIn, checkOut, language, needsHuman, summary, reply.`;

  const user = `Contexte conversation:
${context || "(vide)"}

Message client:
${text}`;

  const raw = await llm.complete({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
  });

  // Clean potential markdown code fences from the response
  const jsonStr = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  return AnalysisSchema.parse(JSON.parse(jsonStr));
}
