import { Router } from "express";
import type { Request, Response } from "express";
import type { StickyBot } from "../conversation/stickyBot.js";
import type { InboundWhatsAppMessage } from "../types.js";

export function createWhatsAppWebhookRouter(bot: StickyBot): Router {
  const router = Router();

  router.get("/webhooks/whatsapp", (req, res) => {
    const challenge = req.query["hub.challenge"] || req.query.challenge;
    if (challenge) {
      res.send(String(challenge));
      return;
    }

    res.json({ ok: true, webhook: "sticky-whatsapp" });
  });

  router.post("/webhooks/whatsapp", async (req: Request, res: Response) => {
    try {
      const incoming = normalizeIncomingWhatsAppMessage(req.body);
      const result = await bot.handleIncomingMessage(incoming);

      res.json({
        ok: true,
        replies: result.replies,
        stickers: result.stickers,
        conversation: result.conversation
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown webhook error.";
      const status = message.includes("Missing") ? 400 : 500;
      res.status(status).json({ ok: false, error: message });
    }
  });

  return router;
}

function normalizeIncomingWhatsAppMessage(body: unknown): InboundWhatsAppMessage {
  const payload = asRecord(body);
  const entry = asRecord(asArray(payload.entry)[0]);
  const change = asRecord(asArray(entry.changes)[0]);
  const value = asRecord(change.value);
  const metaMessage = asRecord(asArray(value.messages)[0]);
  const metaContact = asRecord(asArray(value.contacts)[0]);
  const data = asRecord(payload.data);
  const message = asRecord(payload.message ?? data.message);
  const payloadMessage = asRecord(asRecord(payload.payload)?.message);

  const from = firstString(
    payload.from,
    payload.sender,
    payload.phone,
    payload.wa_id,
    message.from,
    message.sender,
    data.from,
    data.sender,
    data.phone,
    payloadMessage.from,
    metaMessage.from,
    metaContact.wa_id
  );

  const text = firstString(
    payload.text,
    payload.body,
    payload.message,
    asRecord(payload.text)?.body,
    message.text,
    message.body,
    asRecord(message.text)?.body,
    data.text,
    data.body,
    asRecord(data.text)?.body,
    payloadMessage.text,
    asRecord(payloadMessage.text)?.body,
    asRecord(metaMessage.text)?.body,
    asRecord(metaMessage.button)?.text,
    asRecord(asRecord(metaMessage.interactive)?.button_reply)?.title,
    asRecord(asRecord(metaMessage.interactive)?.list_reply)?.title
  );

  const messageId = firstString(payload.id, message.id, data.id, payloadMessage.id, metaMessage.id);

  if (!from) {
    throw new Error("Missing WhatsApp sender in webhook payload.");
  }

  if (!text) {
    throw new Error("Missing WhatsApp text message in webhook payload.");
  }

  return {
    from,
    text,
    messageId,
    raw: body
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number") {
      return String(value);
    }
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
