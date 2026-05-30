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
  "Hola",
  "Hazme un sticker de basquetbol estilo graffiti con texto Jordan"
];

await storage.ensureOutputDir();

for (const text of messages) {
  console.log(`User: ${text}`);
  const response = await bot.handleIncomingMessage({ from, text, messageType: "text" });
  for (const reply of response.replies) {
    console.log(`Bot: ${reply}`);
  }
}

const editFrom = "demo-edit-user";
console.log("User sends sticker");
let editResponse = await bot.handleIncomingMessage({
  from: editFrom,
  text: "",
  messageType: "sticker",
  media: { kind: "sticker", id: "demo-sticker-id" }
});
for (const reply of editResponse.replies) {
  console.log(`Bot: ${reply}`);
}

const imageFrom = "demo-image-user";
console.log("User sends image with caption");
const imageResponse = await bot.handleIncomingMessage({
  from: imageFrom,
  text: "Hazlo estilo cómic con fondo transparente",
  messageType: "image",
  media: {
    kind: "image",
    id: "demo-image-id",
    caption: "Hazlo estilo cómic con fondo transparente"
  }
});
for (const reply of imageResponse.replies) {
  console.log(`Bot: ${reply}`);
}

console.log("User: Ponle lentes negros");
editResponse = await bot.handleIncomingMessage({ from: editFrom, text: "Ponle lentes negros", messageType: "text" });
for (const reply of editResponse.replies) {
  console.log(`Bot: ${reply}`);
}
