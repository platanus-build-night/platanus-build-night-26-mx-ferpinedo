import { PromptGenerator } from "../src/ai/promptGenerator.js";
import { loadConfig } from "../src/config.js";
import { ConversationStateManager } from "../src/conversation/stateManager.js";
import { StickyBot } from "../src/conversation/stickyBot.js";
import { ImageGenerationService } from "../src/images/imageGenerationService.js";
import { KapsoWhatsAppService } from "../src/kapso/kapsoWhatsAppService.js";
import { StickerConversionService } from "../src/stickers/stickerConversionService.js";
import { FileStorageService } from "../src/storage/fileStorageService.js";

const config = loadConfig();
const storage = new FileStorageService({
  outputDir: config.storageDir,
  publicFilesUrl: config.publicFilesUrl
});

const bot = new StickyBot({
  state: new ConversationStateManager(),
  promptGenerator: new PromptGenerator(),
  imageGeneration: new ImageGenerationService({
    apiKey: undefined,
    model: config.openAiImageModel,
    mode: "mock"
  }),
  stickerConversion: new StickerConversionService(),
  storage,
  kapso: new KapsoWhatsAppService({
    enabled: false,
    apiBaseUrl: config.kapsoApiBaseUrl,
    sendMessagePath: config.kapsoSendMessagePath
  })
});

const from = "demo-whatsapp-user";
const messages = [
  "Hi",
  "Tacos Don Rafa",
  "Funny Mexican meme style with cute tacos",
  "Hoy toca pastor, Sin salsa no hay paraiso, Yo invito tu pagas"
];

await storage.ensureOutputDir();

for (const text of messages) {
  console.log(`User: ${text}`);
  const response = await bot.handleIncomingMessage({ from, text });
  for (const reply of response.replies) {
    console.log(`Bot: ${reply}`);
  }
}
