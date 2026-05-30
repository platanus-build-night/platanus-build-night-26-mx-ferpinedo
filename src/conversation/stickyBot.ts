import type { PromptGenerator } from "../ai/promptGenerator.js";
import type { ConversationStateManager } from "./stateManager.js";
import type { ImageGenerationService } from "../images/imageGenerationService.js";
import type { KapsoWhatsAppService } from "../kapso/kapsoWhatsAppService.js";
import type { StickerConversionService } from "../stickers/stickerConversionService.js";
import type { FileStorageService } from "../storage/fileStorageService.js";
import type { BotResponse, ConversationSession, InboundWhatsAppMessage, StoredSticker } from "../types.js";

interface StickyBotDependencies {
  state: ConversationStateManager;
  promptGenerator: PromptGenerator;
  imageGeneration: ImageGenerationService;
  stickerConversion: StickerConversionService;
  storage: FileStorageService;
  kapso: KapsoWhatsAppService;
}

export class StickyBot {
  constructor(private readonly deps: StickyBotDependencies) {}

  async handleIncomingMessage(message: InboundWhatsAppMessage): Promise<BotResponse> {
    const text = message.text.trim();
    const session = this.deps.state.getOrCreate(message.from);

    if (text.toLowerCase() === "restart" || text.toLowerCase() === "new") {
      this.deps.state.reset(message.from);
      return this.reply(message.from, this.deps.state.setState(message.from, "waiting_for_brand_or_theme"), [
        "Listo. Describe el sticker que quieres generar."
      ]);
    }

    switch (session.state) {
      case "initial_message_received":
      case "waiting_for_brand_or_theme":
      case "waiting_for_sticker_style":
      case "waiting_for_sticker_phrases":
      case "completed":
        return this.handleOpenStickerPrompt(message.from, text);
      case "generating_stickers":
        return this.reply(message.from, session, ["Todavía estoy generando tu sticker. Te lo mando aquí cuando esté listo."]);
    }
  }

  private async handleOpenStickerPrompt(userId: string, text: string): Promise<BotResponse> {
    if (isUnsafeOrOffTopic(text)) {
      const session = this.deps.state.setState(userId, "waiting_for_brand_or_theme");
      return this.reply(userId, session, [
        "Solo puedo ayudar a crear stickers. Describe el sticker que quieres, por ejemplo: 'un taco feliz estilo meme con texto Hoy toca pastor'."
      ]);
    }

    if (!hasEnoughStickerDetail(text)) {
      const session = this.deps.state.setState(userId, "waiting_for_brand_or_theme");
      return this.reply(userId, session, [
        "¿Cómo quieres el sticker? Dime el tema, estilo y texto si debe llevar texto."
      ]);
    }

    const session = this.deps.state.update(userId, {
      brandOrTheme: text,
      style: undefined,
      phrases: undefined,
      state: "generating_stickers"
    });

    const generatingReply = "Estoy generando tu sticker.";
    await this.sendText(userId, generatingReply);

    void this.generateAndSendSingleSticker(userId, text).catch((error) => {
      console.error("Sticker generation failed", error);
    });

    return {
      replies: [generatingReply],
      stickers: [],
      conversation: session
    };
  }

  private async generateAndSendSingleSticker(userId: string, userPrompt: string): Promise<void> {
    try {
      console.log(`[sticky] generating sticker for=${userId}`);
      const sticker = await this.generateSingleSticker(userId, userPrompt);
      console.log(`[sticky] sticker generated for=${userId} url=${sticker.url}`);
      this.deps.state.update(userId, { state: "completed" });

      try {
        await this.deps.kapso.sendStickerLink(userId, sticker.url);
      } catch (error) {
        console.error(`Sticker send failed for ${sticker.url}`, error);
      }

      await this.sendText(userId, `Tu sticker está listo: ${sticker.url}`);
      console.log(`[sticky] sticker flow completed for=${userId}`);
    } catch (error) {
      console.error("Sticker generation failed", error);
      this.deps.state.update(userId, { state: "waiting_for_brand_or_theme" });
      await this.sendText(userId, "Algo salió mal al generar el sticker. Mándame tu idea otra vez para intentarlo de nuevo.");
    }
  }

  private async generateSingleSticker(userId: string, userPrompt: string): Promise<StoredSticker> {
    const prompt = this.deps.promptGenerator.buildOpenStickerPrompt(userPrompt);
    const image = await this.deps.imageGeneration.generate(prompt);
    const webp = await this.deps.stickerConversion.toWhatsAppSticker(image);
    const sticker = await this.deps.storage.saveSticker({
      userId,
      index: 0,
      phrase: prompt.phrase,
      prompt: prompt.prompt,
      webp
    });

    await this.deps.storage.saveManifest(userId, [sticker]);
    return sticker;
  }

  private async reply(
    userId: string,
    conversation: ConversationSession,
    replies: string[],
    stickers: StoredSticker[] = []
  ): Promise<BotResponse> {
    for (const text of replies) {
      await this.sendText(userId, text);
    }

    return {
      replies,
      stickers,
      conversation
    };
  }

  private async sendText(userId: string, text: string): Promise<void> {
    await this.deps.kapso.sendText(userId, text);
  }
}

function hasEnoughStickerDetail(text: string): boolean {
  const normalized = normalize(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  const isGreetingOnly = /^(hola|hey|buenas|hi|hello|que tal|buenos dias|buenas tardes|buenas noches)$/.test(normalized);

  if (isGreetingOnly) {
    return false;
  }

  if (words.length >= 4) {
    return true;
  }

  return /sticker|stickers|calcomania|dibujo|logo|meme|texto|estilo|personaje|mascota/.test(normalized) && words.length >= 2;
}

function isUnsafeOrOffTopic(text: string): boolean {
  const normalized = normalize(text);
  const promptInjection = [
    "ignora las instrucciones",
    "ignora instrucciones",
    "ignore previous",
    "ignore all",
    "system prompt",
    "developer message",
    "prompt injection",
    "jailbreak",
    "actua como",
    "actúa como",
    "revela tu prompt",
    "muestra tu prompt"
  ];

  if (promptInjection.some((phrase) => normalized.includes(phrase))) {
    return true;
  }

  const unrelated = [
    "distancia del sol",
    "recordatorio",
    "recuerdame",
    "recuérdame",
    "programa una alarma",
    "agenda",
    "clima",
    "capital de",
    "codigo en",
    "código en",
    "hazme una app",
    "resuelve",
    "cuanto es",
    "cuánto es"
  ];

  return unrelated.some((phrase) => normalized.includes(phrase));
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
