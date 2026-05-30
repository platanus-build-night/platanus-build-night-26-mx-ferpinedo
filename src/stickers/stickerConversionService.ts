import sharp from "sharp";
import type { GeneratedImage } from "../types.js";

export class StickerConversionService {
  async toWhatsAppSticker(image: GeneratedImage): Promise<Buffer> {
    const maxBytes = 100 * 1024;

    for (const quality of [90, 80, 70, 60, 50]) {
      const webp = await sharp(image.buffer, { animated: false })
        .resize(512, 512, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .webp({ quality, effort: 6 })
        .toBuffer();

      if (webp.byteLength <= maxBytes || quality === 50) {
        return webp;
      }
    }

    throw new Error("Unable to convert image to WhatsApp sticker.");
  }
}
