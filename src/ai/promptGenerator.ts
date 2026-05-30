import type { StickerPrompt } from "../types.js";

interface BuildStickerPromptsInput {
  brandOrTheme: string;
  style: string;
  phrases: string[];
}

export class PromptGenerator {
  buildStickerPrompts(input: BuildStickerPromptsInput): StickerPrompt[] {
    return input.phrases.map((phrase) => ({
      phrase,
      prompt: this.buildPrompt(input.brandOrTheme, input.style, phrase)
    }));
  }

  private buildPrompt(brandOrTheme: string, style: string, phrase: string): string {
    return [
      "Create a single WhatsApp sticker, square composition, 512 by 512 pixels.",
      `Brand or theme: ${brandOrTheme}.`,
      `Visual style: ${style}.`,
      `Sticker phrase, exactly as readable text: \"${phrase}\".`,
      "Make it feel like a fun WhatsApp sticker, not an ad, flyer, poster, or logo lockup.",
      "Use transparent or very clean background, bold readable lettering, simple character or icon art, and strong contrast.",
      "Avoid complex backgrounds, tiny text, dense details, photorealistic scenes, watermarks, borders that crop, or extra words."
    ].join(" ");
  }
}
