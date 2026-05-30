import { parseStickerPhrases } from "./phraseParser.js";
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
        "¿Para qué marca o tema quieres los stickers?"
      ]);
    }

    switch (session.state) {
      case "initial_message_received":
        return this.handleInitialMessage(message.from);
      case "waiting_for_brand_or_theme":
        return this.handleBrand(message.from, text);
      case "waiting_for_sticker_style":
        return this.handleStyle(message.from, text);
      case "waiting_for_sticker_phrases":
        return this.handlePhrases(message.from, text);
      case "generating_stickers":
        return this.reply(message.from, session, ["Todavía estoy generando tus stickers. Te mando los links aquí cuando estén listos."]);
      case "completed":
        this.deps.state.reset(message.from);
        return this.handleInitialMessage(message.from);
    }
  }

  private async handleInitialMessage(userId: string): Promise<BotResponse> {
    const session = this.deps.state.setState(userId, "waiting_for_brand_or_theme");
    return this.reply(userId, session, ["¿Para qué marca o tema quieres los stickers?"]);
  }

  private async handleBrand(userId: string, text: string): Promise<BotResponse> {
    if (!text) {
      const session = this.deps.state.getOrCreate(userId);
      return this.reply(userId, session, ["Mándame la marca o el tema para este paquete de stickers."]);
    }

    const session = this.deps.state.update(userId, {
      brandOrTheme: text,
      state: "waiting_for_sticker_style"
    });
    return this.reply(userId, session, ["¿Qué estilo visual quieres?"]);
  }

  private async handleStyle(userId: string, text: string): Promise<BotResponse> {
    if (!text) {
      const session = this.deps.state.getOrCreate(userId);
      return this.reply(userId, session, ["Descríbeme el estilo visual que quieres para los stickers."]);
    }

    const session = this.deps.state.update(userId, {
      style: text,
      state: "waiting_for_sticker_phrases"
    });
    return this.reply(userId, session, ["Mándame tres frases para los stickers, separadas por comas."]);
  }

  private async handlePhrases(userId: string, text: string): Promise<BotResponse> {
    const phrases = parseStickerPhrases(text);
    if (phrases.length !== 3) {
      const session = this.deps.state.getOrCreate(userId);
      return this.reply(userId, session, ["Mándame exactamente tres frases separadas por comas."]);
    }

    let session = this.deps.state.update(userId, {
      phrases,
      state: "generating_stickers"
    });

    const generatingReply = "Estoy generando tus stickers.";
    await this.sendText(userId, generatingReply);

    try {
      const stickers = await this.generateStickerPack(userId, session);
      session = this.deps.state.update(userId, { state: "completed" });
      const links = stickers.map((sticker, index) => `${index + 1}. ${sticker.phrase}: ${sticker.url}`).join("\n");
      const readyReply = `Tus stickers están listos:\n${links}`;

      for (const sticker of stickers) {
        try {
          await this.deps.kapso.sendStickerLink(userId, sticker.url);
        } catch (error) {
          console.error(`Sticker send failed for ${sticker.url}`, error);
        }
      }

      await this.sendText(userId, readyReply);

      return {
        replies: [generatingReply, readyReply],
        stickers,
        conversation: session
      };
    } catch (error) {
      console.error("Sticker generation failed", error);
      session = this.deps.state.update(userId, { state: "waiting_for_sticker_phrases" });
      const failureReply = "Algo salió mal al generar los stickers. Mándame otra vez las tres frases para intentarlo de nuevo.";
      await this.sendText(userId, failureReply);

      return {
        replies: [generatingReply, failureReply],
        stickers: [],
        conversation: session
      };
    }
  }

  private async generateStickerPack(userId: string, session: ConversationSession): Promise<StoredSticker[]> {
    if (!session.brandOrTheme || !session.style || !session.phrases) {
      throw new Error("Conversation is missing brand, style, or phrases.");
    }

    const prompts = this.deps.promptGenerator.buildStickerPrompts({
      brandOrTheme: session.brandOrTheme,
      style: session.style,
      phrases: session.phrases
    });

    const stickers: StoredSticker[] = [];
    for (const [index, prompt] of prompts.entries()) {
      const image = await this.deps.imageGeneration.generate(prompt);
      const webp = await this.deps.stickerConversion.toWhatsAppSticker(image);
      const stored = await this.deps.storage.saveSticker({
        userId,
        index,
        phrase: prompt.phrase,
        prompt: prompt.prompt,
        webp
      });
      stickers.push(stored);
    }

    await this.deps.storage.saveManifest(userId, stickers);
    return stickers;
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
