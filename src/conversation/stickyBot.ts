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
        "What brand or theme do you want stickers for?"
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
        return this.reply(message.from, session, ["I am still generating your stickers. I will send the links here when they are ready."]);
      case "completed":
        this.deps.state.reset(message.from);
        return this.handleInitialMessage(message.from);
    }
  }

  private async handleInitialMessage(userId: string): Promise<BotResponse> {
    const session = this.deps.state.setState(userId, "waiting_for_brand_or_theme");
    return this.reply(userId, session, ["What brand or theme do you want stickers for?"]);
  }

  private async handleBrand(userId: string, text: string): Promise<BotResponse> {
    if (!text) {
      const session = this.deps.state.getOrCreate(userId);
      return this.reply(userId, session, ["Please send the brand or theme for this sticker pack."]);
    }

    const session = this.deps.state.update(userId, {
      brandOrTheme: text,
      state: "waiting_for_sticker_style"
    });
    return this.reply(userId, session, ["What visual style do you want?"]);
  }

  private async handleStyle(userId: string, text: string): Promise<BotResponse> {
    if (!text) {
      const session = this.deps.state.getOrCreate(userId);
      return this.reply(userId, session, ["Please describe the visual style you want for the stickers."]);
    }

    const session = this.deps.state.update(userId, {
      style: text,
      state: "waiting_for_sticker_phrases"
    });
    return this.reply(userId, session, ["Send me three sticker phrases separated by commas."]);
  }

  private async handlePhrases(userId: string, text: string): Promise<BotResponse> {
    const phrases = parseStickerPhrases(text);
    if (phrases.length !== 3) {
      const session = this.deps.state.getOrCreate(userId);
      return this.reply(userId, session, ["Please send exactly three sticker phrases separated by commas."]);
    }

    let session = this.deps.state.update(userId, {
      phrases,
      state: "generating_stickers"
    });

    const generatingReply = "Generating your stickers.";
    await this.sendText(userId, generatingReply);

    try {
      const stickers = await this.generateStickerPack(userId, session);
      session = this.deps.state.update(userId, { state: "completed" });
      const links = stickers.map((sticker, index) => `${index + 1}. ${sticker.phrase}: ${sticker.url}`).join("\n");
      const readyReply = `Your stickers are ready:\n${links}`;

      await this.sendText(userId, readyReply);

      return {
        replies: [generatingReply, readyReply],
        stickers,
        conversation: session
      };
    } catch (error) {
      console.error("Sticker generation failed", error);
      session = this.deps.state.update(userId, { state: "waiting_for_sticker_phrases" });
      const failureReply = "Something went wrong while generating the stickers. Please send the three phrases again to retry.";
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
