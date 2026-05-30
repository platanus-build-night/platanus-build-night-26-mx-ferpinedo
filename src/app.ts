import express from "express";
import { PromptGenerator } from "./ai/promptGenerator.js";
import type { AppConfig } from "./config.js";
import { ConversationStateManager } from "./conversation/stateManager.js";
import { StickyBot } from "./conversation/stickyBot.js";
import { ImageGenerationService } from "./images/imageGenerationService.js";
import { KapsoWhatsAppService } from "./kapso/kapsoWhatsAppService.js";
import { StickerConversionService } from "./stickers/stickerConversionService.js";
import { FileStorageService } from "./storage/fileStorageService.js";
import { createWhatsAppWebhookRouter } from "./whatsapp/webhook.js";

export function createApp(config: AppConfig) {
  const state = new ConversationStateManager();
  const promptGenerator = new PromptGenerator();
  const imageGeneration = new ImageGenerationService({
    apiKey: config.openAiApiKey,
    model: config.openAiImageModel,
    mode: config.imageGenerationMode
  });
  const stickerConversion = new StickerConversionService();
  const storage = new FileStorageService({
    outputDir: config.storageDir,
    publicFilesUrl: config.publicFilesUrl
  });
  const kapso = new KapsoWhatsAppService({
    enabled: config.kapsoEnabled,
    apiKey: config.kapsoApiKey,
    apiBaseUrl: config.kapsoApiBaseUrl,
    sendMessagePath: config.kapsoSendMessagePath,
    sendMessageUrl: config.kapsoSendMessageUrl,
    whatsappFrom: config.kapsoWhatsAppFrom
  });

  const bot = new StickyBot({
    state,
    promptGenerator,
    imageGeneration,
    stickerConversion,
    storage,
    kapso
  });

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/files", express.static(config.storageDir));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "sticky" });
  });

  app.use(createWhatsAppWebhookRouter(bot));

  return {
    app,
    services: {
      state,
      promptGenerator,
      imageGeneration,
      stickerConversion,
      storage,
      kapso,
      bot
    }
  };
}
