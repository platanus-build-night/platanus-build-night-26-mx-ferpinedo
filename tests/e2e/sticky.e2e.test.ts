import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Server } from "node:http";
import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";

const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "sticky-e2e-"));
const config: AppConfig = {
  port: 0,
  baseUrl: "http://127.0.0.1",
  publicFilesUrl: "http://127.0.0.1/files",
  storageDir,
  imageGenerationMode: "mock",
  openAiImageModel: "gpt-image-1",
  kapsoEnabled: false,
  kapsoApiBaseUrl: "https://api.kapso.ai",
  kapsoSendMessagePath: "/whatsapp/messages"
};

const { app, services } = createApp(config);
let server: Server;
let baseUrl = "";

describe("Sticky WhatsApp bot e2e", () => {
  before(async () => {
    await services.storage.ensureOutputDir();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  test("health endpoint is available", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: "sticky" });
  });

  test("asks for detail when user only sends a greeting", async () => {
    const body = await postWebhook({ from: "e2e-greeting", text: "Hola" });

    assert.equal(body.ok, true);
    assert.deepEqual(body.replies, ["¿Cómo quieres el sticker? Dime el tema, estilo y texto si debe llevar texto."]);
    assert.equal(body.conversation.state, "waiting_for_brand_or_theme");
  });

  test("generates one WhatsApp-ready sticker from an open prompt", async () => {
    const userId = "e2e-open-prompt";
    const body = await postWebhook({
      from: userId,
      text: "Hazme un sticker de basquetbol estilo graffiti con texto Jordan"
    });

    assert.equal(body.ok, true);
    assert.deepEqual(body.replies, ["Estoy generando tu sticker."]);
    assert.equal(body.conversation.state, "generating_stickers");

    const completed = await waitForSession(userId, "completed");
    assert.equal(completed.sourceMedia.kind, "sticker");
    assert.equal(completed.sourceMedia.mimeType, "image/webp");

    await assertStickerFile(completed.sourceMedia.localFilePath);
  });

  test("uses the last generated sticker as context for follow-up edits", async () => {
    const userId = "e2e-follow-up";
    await postWebhook({ from: userId, text: "Hazme un sticker de un perro feliz con texto Guau" });
    const first = await waitForSession(userId, "completed");
    const firstPath = first.sourceMedia.localFilePath;
    assert.ok(firstPath);

    const body = await postWebhook({ from: userId, text: "Ponle lentes negros" });
    assert.equal(body.ok, true);
    assert.deepEqual(body.replies, ["Estoy editando tu sticker."]);

    const second = await waitForSession(userId, "completed", first.updatedAt);
    assert.equal(second.sourceMedia.kind, "sticker");
    assert.notEqual(second.sourceMedia.localFilePath, firstPath);
    await assertStickerFile(second.sourceMedia.localFilePath);
  });

  test("uses image captions as immediate sticker instructions", async () => {
    const userId = "e2e-image-caption";
    const body = await postWebhook({
      message: {
        id: "wamid.image-caption",
        type: "image",
        from: userId,
        image: {
          id: "media-image-123",
          caption: "Hazlo como sticker limpio con fondo transparente"
        }
      },
      conversation: { phone_number: userId },
      phone_number_id: "phone-number-id"
    });

    assert.equal(body.ok, true);
    assert.deepEqual(body.replies, ["Estoy creando tu sticker con la imagen."]);
    assert.equal(body.conversation.state, "generating_stickers");
  });

  test("asks for edit instructions when a sticker arrives without text", async () => {
    const userId = "e2e-sticker-only";
    const body = await postWebhook({
      message: {
        id: "wamid.sticker-only",
        type: "sticker",
        from: userId,
        sticker: { id: "media-sticker-123" }
      },
      conversation: { phone_number: userId },
      phone_number_id: "phone-number-id"
    });

    assert.equal(body.ok, true);
    assert.deepEqual(body.replies, ["Recibí el sticker. ¿Qué cambios quieres que haga?"]);
    assert.equal(body.conversation.state, "waiting_for_edit_instructions");
  });

  test("rejects unsupported media types", async () => {
    const body = await postWebhook({
      message: {
        id: "wamid.video",
        type: "video",
        from: "e2e-video",
        video: { id: "media-video-123" }
      },
      conversation: { phone_number: "e2e-video" },
      phone_number_id: "phone-number-id"
    });

    assert.equal(body.ok, true);
    assert.deepEqual(body.replies, [
      "Solo acepto texto, fotos/imágenes y stickers. No puedo procesar videos, audios, ubicaciones, documentos, contactos ni otros tipos de archivo o contenido."
    ]);
  });
});

async function postWebhook(payload: unknown) {
  const response = await fetch(`${baseUrl}/webhooks/whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

async function waitForSession(userId: string, state: string, afterUpdatedAt?: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const session = services.state.getOrCreate(userId);
    if (session.state === state && (!afterUpdatedAt || session.updatedAt !== afterUpdatedAt)) {
      return session;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.fail(`Timed out waiting for ${userId} to reach state ${state}`);
}

async function assertStickerFile(filePath: string | undefined) {
  assert.ok(filePath, "Expected sticker local file path");
  const metadata = await sharp(filePath).metadata();
  const stat = await fs.stat(filePath);

  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
  assert.ok(stat.size > 0, "Sticker should not be empty");
  assert.ok(stat.size <= 100 * 1024, `Sticker should be <= 100KB, got ${stat.size}`);
}
