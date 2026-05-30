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
  kapsoSendMessagePath: "/whatsapp/messages",
  blockedNumbers: ["5215587069436", "525587069436"]
};

const { app, services } = createApp(config);
let server: Server;
let baseUrl = "";
const exampleBullets =
  "- Crea desde cero: 'haz un sticker de mi perro con texto Firulais'\n- Convierte una foto: manda una imagen con instrucciones como 'convierte en sticker con fondo transparente'\n- Edita un sticker: manda el sticker y dime qué cambiar, como 'ponle lentes negros'";
const introReply = `Hola, soy Sticky y te puedo ayudar a crear un sticker con AI en segundos.\n\n${exampleBullets}`;
const offTopicReply = `Solo puedo ayudar a crear stickers. Aquí tienes algunas ideas:\n\n${exampleBullets}`;
const generatingReply = "Estoy generando tu sticker. Puede tardar hasta 90 segundos en generarse. Gracias por tu paciencia.";
const editingReply = "Estoy editando tu sticker. Puede tardar hasta 90 segundos en generarse. Gracias por tu paciencia.";
const imageReply = "Estoy creando tu sticker con la imagen. Puede tardar hasta 90 segundos en generarse. Gracias por tu paciencia.";

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
    assert.deepEqual(body.replies, [introReply]);
    assert.equal(body.conversation.state, "waiting_for_brand_or_theme");
  });

  test("redirects off-topic requests back to stickers", async () => {
    const body = await postWebhook({ from: "e2e-off-topic", text: "¿Cuál es el clima de hoy?" });

    assert.equal(body.ok, true);
    assert.deepEqual(body.replies, [offTopicReply]);
    assert.equal(body.conversation.state, "waiting_for_brand_or_theme");
  });

  test("ignores blocked senders without replying", async () => {
    const body = await postWebhook({ from: "+52 1 55 8706 9436", text: "Hazme un sticker" });

    assert.equal(body.ok, true);
    assert.equal(body.ignored, true);
    assert.deepEqual(body.replies, []);
    assert.deepEqual(body.stickers, []);
    assert.equal(body.conversation, undefined);
  });

  test("generates one WhatsApp-ready sticker from an open prompt", async () => {
    const userId = "e2e-open-prompt";
    const body = await postWebhook({
      from: userId,
      text: "Hazme un sticker de basquetbol estilo graffiti con texto Jordan"
    });

    assert.equal(body.ok, true);
    assert.deepEqual(body.replies, [generatingReply]);
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
    assert.deepEqual(body.replies, [editingReply]);

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
    assert.deepEqual(body.replies, [imageReply]);
    assert.equal(body.conversation.state, "generating_stickers");
    await waitForSession(userId, "completed");
  });

  test("queues generations when all concurrent slots are busy", async () => {
    const users = Array.from({ length: 4 }, (_, index) => `e2e-queue-${index + 1}`);
    const results = await Promise.all(
      users.map((userId) => postWebhook({ from: userId, text: `Hazme un sticker de estrella numero ${userId}` }))
    );

    const queued = results.filter((body) => body.replies[0].includes("entró a la cola"));
    const running = results.filter((body) => body.replies[0] === generatingReply);

    assert.equal(running.length, 3);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].replies[0], "Tu sticker entró a la cola en la posición 1. Te lo mando aquí cuando esté listo.");

    await Promise.all(users.map((userId) => waitForSession(userId, "completed")));
  });

  test("rejects generations when beta queue is full", async () => {
    const users = Array.from({ length: 14 }, (_, index) => `e2e-full-${index + 1}`);
    const results = await Promise.all(
      users.map((userId) => postWebhook({ from: userId, text: `Hazme un sticker beta prueba numero ${userId}` }))
    );

    const running = results.filter((body) => body.replies[0] === generatingReply);
    const queued = results.filter((body) => body.replies[0].includes("entró a la cola"));
    const rejected = results.filter((body) => body.replies[0].includes("límite de creación de stickers simultáneo"));

    assert.equal(running.length, 3);
    assert.equal(queued.length, 10);
    assert.equal(rejected.length, 1);
    assert.equal(
      rejected[0].replies[0],
      "En esta versión beta hay un límite de creación de stickers simultáneo. Por favor espera unos minutos e intenta más tarde."
    );

    const acceptedUsers = users.filter((_, index) => !results[index].replies[0].includes("límite de creación de stickers simultáneo"));
    await Promise.all(acceptedUsers.map((userId) => waitForSession(userId, "completed")));
  });

  test("limits each contact to two generations every ten minutes", async () => {
    const userId = "e2e-rate-limit";
    await postWebhook({ from: userId, text: "Hazme un sticker de una pizza feliz" });
    const first = await waitForSession(userId, "completed");

    await postWebhook({ from: userId, text: "Ponle lentes" });
    await waitForSession(userId, "completed", first.updatedAt);

    const body = await postWebhook({ from: userId, text: "Ponle sombrero" });
    assert.equal(body.ok, true);
    assert.deepEqual(body.replies, [
      "En la versión gratuita puedes crear hasta 2 stickers cada 10 minutos. Para recibir una versión premium escribe a fer@quentli.com."
    ]);
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
