import type { PromptGenerator } from "../ai/promptGenerator.js";
import type { ConversationStateManager } from "./stateManager.js";
import type { ImageGenerationService } from "../images/imageGenerationService.js";
import type { KapsoWhatsAppService } from "../kapso/kapsoWhatsAppService.js";
import type { StickerConversionService } from "../stickers/stickerConversionService.js";
import type { FileStorageService } from "../storage/fileStorageService.js";
import type { BotResponse, ConversationSession, InboundMedia, InboundWhatsAppMessage, StoredSticker } from "../types.js";

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

    if (message.media) {
      return this.handleMediaMessage(message.from, message.media, text);
    }

    if (session.state === "waiting_for_edit_instructions") {
      return this.handleStoredMediaInstructions(message.from, text, "edit");
    }

    if (session.state === "waiting_for_image_sticker_instructions") {
      return this.handleStoredMediaInstructions(message.from, text, "image");
    }

    if (session.state === "waiting_for_sticker_to_edit") {
      return this.reply(message.from, session, ["Mándame el sticker que quieres editar."]);
    }

    if (session.state === "waiting_for_image_to_sticker") {
      return this.reply(message.from, session, ["Mándame la imagen o foto que quieres convertir en sticker."]);
    }

    if (isEditNextStickerIntent(text)) {
      const updated = this.deps.state.update(message.from, { state: "waiting_for_sticker_to_edit" });
      return this.reply(message.from, updated, ["Claro. Mándame el sticker que quieres editar."]);
    }

    if (isImageNextIntent(text)) {
      const updated = this.deps.state.update(message.from, { state: "waiting_for_image_to_sticker" });
      return this.reply(message.from, updated, ["Claro. Mándame la imagen o foto que quieres convertir en sticker."]);
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

  private async handleMediaMessage(userId: string, media: InboundMedia, text: string): Promise<BotResponse> {
    if (media.kind === "sticker") {
      if (hasEnoughMediaInstruction(text) && !isUnsafeOrOffTopic(text)) {
        return this.startMediaStickerGeneration(userId, media, text, "edit");
      }

      const session = this.deps.state.update(userId, {
        sourceMedia: media,
        state: "waiting_for_edit_instructions"
      });

      return this.reply(userId, session, ["Recibí el sticker. ¿Qué cambios quieres que haga?"]);
    }

    if (media.kind === "image") {
      if (hasEnoughMediaInstruction(text) && !isUnsafeOrOffTopic(text)) {
        return this.startMediaStickerGeneration(userId, media, text, "image");
      }

      const session = this.deps.state.update(userId, {
        sourceMedia: media,
        state: "waiting_for_image_sticker_instructions"
      });

      return this.reply(userId, session, ["Recibí la imagen. ¿Qué sticker quieres que haga con ella?"]);
    }

    const session = this.deps.state.setState(userId, "waiting_for_brand_or_theme");
    return this.reply(userId, session, ["Por ahora solo puedo trabajar con stickers o imágenes para crear stickers."]);
  }

  private async handleStoredMediaInstructions(userId: string, text: string, mode: "edit" | "image"): Promise<BotResponse> {
    const current = this.deps.state.getOrCreate(userId);

    if (!current.sourceMedia) {
      const state = mode === "edit" ? "waiting_for_sticker_to_edit" : "waiting_for_image_to_sticker";
      const session = this.deps.state.setState(userId, state);
      const reply = mode === "edit" ? "Mándame el sticker que quieres editar." : "Mándame la imagen que quieres usar.";
      return this.reply(userId, session, [reply]);
    }

    if (isUnsafeOrOffTopic(text)) {
      return this.reply(userId, current, ["Solo puedo ayudarte a crear o editar stickers. Dime qué cambio visual quieres hacer."]);
    }

    if (!hasEnoughMediaInstruction(text)) {
      const reply = mode === "edit" ? "¿Qué cambios quieres que haga al sticker?" : "¿Qué sticker quieres que haga con la imagen?";
      return this.reply(userId, current, [reply]);
    }

    return this.startMediaStickerGeneration(userId, current.sourceMedia, text, mode);
  }

  private async startMediaStickerGeneration(
    userId: string,
    sourceMedia: InboundMedia,
    instructions: string,
    mode: "edit" | "image"
  ): Promise<BotResponse> {
    const prompt = buildMediaPrompt(sourceMedia, instructions, mode);
    const session = this.deps.state.update(userId, {
      brandOrTheme: prompt,
      sourceMedia,
      state: "generating_stickers"
    });
    const generatingReply = mode === "edit" ? "Estoy editando tu sticker." : "Estoy creando tu sticker con la imagen.";
    await this.sendText(userId, generatingReply);

    void this.generateAndSendSingleSticker(userId, prompt, sourceMedia).catch((error) => {
      console.error("Sticker generation failed", error);
    });

    return {
      replies: [generatingReply],
      stickers: [],
      conversation: session
    };
  }

  private async generateAndSendSingleSticker(userId: string, userPrompt: string, sourceMedia?: InboundMedia): Promise<void> {
    try {
      const referenceStatus = sourceMedia?.url ? "media-url" : sourceMedia ? "media-without-url" : "none";
      console.log(`[sticky] generating sticker for=${userId} reference=${referenceStatus}`);
      const sticker = await this.generateSingleSticker(userId, userPrompt, sourceMedia);
      console.log(`[sticky] sticker generated for=${userId} url=${sticker.url}`);
      this.deps.state.update(userId, { state: "completed" });

      try {
        await this.deps.kapso.sendStickerLink(userId, sticker.url);
      } catch (error) {
        console.error(`Sticker send failed for ${sticker.url}`, error);
      }

      console.log(`[sticky] sticker flow completed for=${userId}`);
    } catch (error) {
      console.error("Sticker generation failed", error);
      this.deps.state.update(userId, { state: "waiting_for_brand_or_theme" });
      await this.sendText(userId, "Algo salió mal al generar el sticker. Mándame tu idea otra vez para intentarlo de nuevo.");
    }
  }

  private async generateSingleSticker(userId: string, userPrompt: string, sourceMedia?: InboundMedia): Promise<StoredSticker> {
    const prompt = this.deps.promptGenerator.buildOpenStickerPrompt(userPrompt);
    const image = sourceMedia?.url
      ? await this.generateImageFromReference(prompt, sourceMedia)
      : await this.deps.imageGeneration.generate(prompt);
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

  private async generateImageFromReference(prompt: ReturnType<PromptGenerator["buildOpenStickerPrompt"]>, sourceMedia: InboundMedia) {
    if (!sourceMedia.url) {
      console.warn(`[sticky] source media has no downloadable url; using text-only generation. media_id=${sourceMedia.id ?? "missing"}`);
      return this.deps.imageGeneration.generate(prompt);
    }

    console.log(`[sticky] downloading reference media kind=${sourceMedia.kind} url=${sourceMedia.url}`);
    const reference = await this.deps.kapso.downloadMedia(sourceMedia.url);
    console.log(`[sticky] reference media downloaded bytes=${reference.buffer.byteLength} mime=${reference.mimeType}`);
    return this.deps.imageGeneration.generateWithReference(prompt, reference.buffer);
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

function hasEnoughMediaInstruction(text: string): boolean {
  const normalized = normalize(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length >= 2 && !/^(hola|hey|buenas|hi|hello)$/.test(normalized);
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

function isEditNextStickerIntent(text: string): boolean {
  const normalized = normalize(text);
  return /\b(edita|editar|modifica|modificar|cambia|cambiar|arregla|retoca)\b/.test(normalized) && /\bsticker\b/.test(normalized);
}

function isImageNextIntent(text: string): boolean {
  const normalized = normalize(text);
  return /(imagen|foto|fotografia)/.test(normalized) && /(sticker|calcomania|convertir|hacer|crear|usar)/.test(normalized);
}

function buildMediaPrompt(media: InboundMedia, instructions: string, mode: "edit" | "image"): string {
  const source = media.url ? `URL de referencia: ${media.url}.` : media.id ? `ID de media de referencia: ${media.id}.` : "Media de referencia recibida por WhatsApp.";

  if (mode === "edit") {
    return [
      "Edita el sticker de referencia y genera un nuevo sticker de WhatsApp.",
      source,
      `Cambios solicitados por el usuario: ${instructions}.`,
      "Conserva la idea principal y el estilo visual del sticker original cuando sea posible.",
      "No lo conviertas en caricatura, cómic, ilustración o meme a menos que el usuario lo pida explícitamente."
    ].join(" ");
  }

  return [
    "Crea un sticker de WhatsApp usando la imagen de referencia del usuario.",
    source,
    `Indicaciones del usuario: ${instructions}.`,
    "Usa la imagen como referencia principal y conserva su estilo visual salvo que el usuario pida explícitamente otro estilo.",
    "No la conviertas en caricatura, cómic, ilustración o meme a menos que el usuario lo pida explícitamente.",
    "Haz un sticker limpio, con fondo transparente o simple, y texto solo si el usuario lo pidió."
  ].join(" ");
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
