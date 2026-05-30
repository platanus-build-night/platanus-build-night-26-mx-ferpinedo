import { Router } from "express";
import type { Request, Response } from "express";
import { normalizePhoneNumber } from "../config.js";
import type { StickyBot } from "../conversation/stickyBot.js";
import type { InboundWhatsAppMessage } from "../types.js";

interface WhatsAppWebhookOptions {
  blockedNumbers?: string[];
}

export function createWhatsAppWebhookRouter(bot: StickyBot, options: WhatsAppWebhookOptions = {}): Router {
  const router = Router();
  const blockedNumbers = new Set(options.blockedNumbers ?? []);

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
      console.log(
        `[whatsapp] inbound from=${incoming.from} type=${incoming.messageType} text=${JSON.stringify(incoming.text)} media=${incoming.media ? JSON.stringify(incoming.media) : "none"}`
      );

      if (blockedNumbers.has(normalizePhoneNumber(incoming.from))) {
        console.log(`[whatsapp] ignored blocked sender from=${incoming.from}`);
        res.json({ ok: true, ignored: true, replies: [], stickers: [] });
        return;
      }

      const result = await bot.handleIncomingMessage(incoming);
      console.log(`[whatsapp] replies=${result.replies.length} stickers=${result.stickers.length} state=${result.conversation.state}`);

      res.json({
        ok: true,
        replies: result.replies,
        stickers: result.stickers,
        conversation: result.conversation
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown webhook error.";
      const status = message.includes("Missing") ? 400 : 500;
      console.error(`[whatsapp] webhook failed: ${message}`, JSON.stringify(req.body));
      res.status(status).json({ ok: false, error: message });
    }
  });

  return router;
}

function normalizeIncomingWhatsAppMessage(body: unknown): InboundWhatsAppMessage {
  const payload = asRecord(body);
  const eventData = asRecord(payload.data);
  const entry = asRecord(asArray(payload.entry)[0]);
  const change = asRecord(asArray(entry.changes)[0]);
  const value = asRecord(change.value);
  const metaMessage = asRecord(asArray(value.messages)[0]);
  const metaContact = asRecord(asArray(value.contacts)[0]);
  const data = asRecord(eventData.data ?? payload.data);
  const message = asRecord(payload.message ?? data.message);
  const payloadMessage = asRecord(asRecord(payload.payload)?.message);
  const kapso = asRecord(message.kapso);
  const kapsoMediaData = asRecord(kapso.media_data);
  const kapsoTypeData = asRecord(kapso.message_type_data);
  const conversation = asRecord(payload.conversation ?? data.conversation ?? eventData.conversation);
  const messageType = firstString(payload.type, message.type, data.type, payloadMessage.type, metaMessage.type) ?? "text";
  const mediaRecord = asRecord(message[messageType] ?? data[messageType] ?? payloadMessage[messageType] ?? metaMessage[messageType]);
  const media = buildInboundMedia(messageType, mediaRecord, kapso, kapsoMediaData, kapsoTypeData);

  const from = firstString(
    payload.from,
    payload.sender,
    payload.phone,
    payload.wa_id,
    message.from,
    message.from_user_id,
    message.sender,
    data.from,
    data.sender,
    data.phone,
    payloadMessage.from,
    metaMessage.from,
    metaContact.wa_id,
    conversation.phone_number,
    conversation.business_scoped_user_id
  );

  const text = firstString(
    payload.text,
    payload.body,
    payload.message,
    asRecord(payload.text)?.body,
    message.text,
    message.body,
    asRecord(message.text)?.body,
    media?.caption,
    data.text,
    data.body,
    asRecord(data.text)?.body,
    payloadMessage.text,
    asRecord(payloadMessage.text)?.body,
    asRecord(metaMessage.text)?.body,
    asRecord(metaMessage.button)?.text,
    asRecord(asRecord(metaMessage.interactive)?.button_reply)?.title,
    asRecord(asRecord(metaMessage.interactive)?.list_reply)?.title,
    media ? undefined : kapso.content
  );

  const messageId = firstString(payload.id, message.id, data.id, payloadMessage.id, metaMessage.id);

  if (!from) {
    throw new Error("Missing WhatsApp sender in webhook payload.");
  }

  if (!text && !media) {
    throw new Error("Missing WhatsApp text or media message in webhook payload.");
  }

  return {
    from,
    text: text ?? "",
    messageType,
    media,
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

function buildInboundMedia(
  messageType: string,
  mediaRecord: Record<string, unknown>,
  kapso: Record<string, unknown>,
  kapsoMediaData: Record<string, unknown>,
  kapsoTypeData: Record<string, unknown>
) {
  if (!["image", "sticker", "video", "document"].includes(messageType)) {
    return undefined;
  }

  return {
    kind: messageType,
    id: firstString(mediaRecord.id, kapso.media_id),
    url: firstString(kapso.media_url, kapsoMediaData.url, mediaRecord.link, mediaRecord.url),
    mimeType: firstString(kapsoMediaData.content_type, mediaRecord.mime_type),
    filename: firstString(kapsoMediaData.filename, mediaRecord.filename),
    caption: firstString(mediaRecord.caption, kapsoTypeData.caption)
  };
}
