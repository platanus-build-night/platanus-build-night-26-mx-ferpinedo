import sharp from "sharp";
import type { GeneratedImage } from "../types.js";

export class StickerConversionService {
  async toWhatsAppSticker(image: GeneratedImage): Promise<Buffer> {
    return sharp(image.buffer, { animated: false })
      .resize(512, 512, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .webp({ quality: 90, effort: 4 })
      .toBuffer();
  }
}
