import axios from "axios";

const API_VERSION = "v26.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

// ---------- Types ----------

export interface WhatsAppTextParams {
  to: string;
  body: string;
  previewUrl?: boolean;
}

export interface WhatsAppMediaParams {
  to: string;
  type: "image" | "audio" | "video" | "document" | "sticker";
  link?: string; // public URL
  id?: string; // uploaded media ID
  caption?: string;
  filename?: string;
}

export interface WhatsAppLocationParams {
  to: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface WhatsAppContactParams {
  to: string;
  contacts: Array<{
    name: { firstName: string; lastName?: string };
    phones?: Array<{ phone: string; type?: string }>;
    emails?: Array<{ email: string; type?: string }>;
  }>;
}

export interface WhatsAppInteractiveParams {
  to: string;
  type: "button" | "list";
  header?: { type: "text" | "image" | "video" | "document"; text?: string; link?: string };
  body: { text: string };
  footer?: { text: string };
  action: WhatsAppButtonAction | WhatsAppListAction;
}

interface WhatsAppButtonAction {
  buttons: Array<{ type: "reply"; reply: { id: string; title: string } }>;
}

interface WhatsAppListAction {
  button: string;
  sections: Array<{
    title?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>;
}

export interface WhatsAppReactionParams {
  to: string;
  messageId: string;
  emoji: string;
}

export interface WhatsAppLocationRequestParams {
  to: string;
  body: string;
}

// ---------- API Calls ----------

const phoneId = () => process.env.WHATSAPP_PHONE_NUMBER_ID;
const token = () => process.env.WHATSAPP_ACCESS_TOKEN;

function headers() {
  return {
    Authorization: `Bearer ${token()}`,
    "Content-Type": "application/json",
  };
}

/** Send a plain text message */
export async function sendText(params: WhatsAppTextParams): Promise<string> {
  const url = `${BASE_URL}/${phoneId()}/messages`;
  const res = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: "text",
      text: {
        preview_url: params.previewUrl ?? false,
        body: params.body,
      },
    },
    { headers: headers() },
  );
  return res.data?.messages?.[0]?.id ?? "";
}

/** Send media (image, audio, video, document, sticker) */
export async function sendMedia(params: WhatsAppMediaParams): Promise<string> {
  const url = `${BASE_URL}/${phoneId()}/messages`;
  const mediaObj: Record<string, unknown> = {};
  if (params.id) mediaObj.id = params.id;
  if (params.link) mediaObj.link = params.link;
  if (params.caption) mediaObj.caption = params.caption;
  if (params.filename) mediaObj.filename = params.filename;

  const res = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: params.type,
      [params.type]: mediaObj,
    },
    { headers: headers() },
  );
  return res.data?.messages?.[0]?.id ?? "";
}

/** Send an interactive message (buttons or list) */
export async function sendInteractive(
  params: WhatsAppInteractiveParams,
): Promise<string> {
  const url = `${BASE_URL}/${phoneId()}/messages`;
  const res = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: "interactive",
      interactive: {
        type: params.type,
        ...(params.header ? { header: params.header } : {}),
        body: params.body,
        ...(params.footer ? { footer: params.footer } : {}),
        action: params.action,
      },
    },
    { headers: headers() },
  );
  return res.data?.messages?.[0]?.id ?? "";
}

/** Send a location */
export async function sendLocation(
  params: WhatsAppLocationParams,
): Promise<string> {
  const url = `${BASE_URL}/${phoneId()}/messages`;
  const res = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: "location",
      location: {
        latitude: params.latitude,
        longitude: params.longitude,
        ...(params.name ? { name: params.name } : {}),
        ...(params.address ? { address: params.address } : {}),
      },
    },
    { headers: headers() },
  );
  return res.data?.messages?.[0]?.id ?? "";
}

/** Send a contact card */
export async function sendContact(
  params: WhatsAppContactParams,
): Promise<string> {
  const url = `${BASE_URL}/${phoneId()}/messages`;
  const res = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: "contacts",
      contacts: params.contacts,
    },
    { headers: headers() },
  );
  return res.data?.messages?.[0]?.id ?? "";
}

/** React to a message with an emoji */
export async function sendReaction(
  params: WhatsAppReactionParams,
): Promise<string> {
  const url = `${BASE_URL}/${phoneId()}/messages`;
  const res = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: "reaction",
      reaction: {
        message_id: params.messageId,
        emoji: params.emoji,
      },
    },
    { headers: headers() },
  );
  return res.data?.messages?.[0]?.id ?? "";
}

/** Request user's location (interactive) */
export async function requestLocation(
  params: WhatsAppLocationRequestParams,
): Promise<string> {
  const url = `${BASE_URL}/${phoneId()}/messages`;
  const res = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: "interactive",
      interactive: {
        type: "location_request_message",
        body: { text: params.body },
        action: { name: "send_location" },
      },
    },
    { headers: headers() },
  );
  return res.data?.messages?.[0]?.id ?? "";
}

/** Reply to a specific message (threaded reply) */
export async function replyToMessage(
  to: string,
  body: string,
  replyToMessageId: string,
): Promise<string> {
  const url = `${BASE_URL}/${phoneId()}/messages`;
  const res = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body },
      context: { message_id: replyToMessageId },
    },
    { headers: headers() },
  );
  return res.data?.messages?.[0]?.id ?? "";
}

/** Mark a message as read (shows blue ticks) */
export async function markAsRead(messageId: string): Promise<void> {
  const url = `${BASE_URL}/${phoneId()}/messages`;
  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    },
    { headers: headers() },
  );
}

/** Send typing indicator */
export async function sendTyping(
  to: string,
  action: "typing_on" | "typing_off",
): Promise<void> {
  const url = `${BASE_URL}/${phoneId()}/messages`;
  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      status: action,
    },
    { headers: headers() },
  );
}

// ---------- Legacy alias (backward compatibility) ----------

/** @deprecated Use `sendText` instead */
export const sendWhatsAppText = sendText;
