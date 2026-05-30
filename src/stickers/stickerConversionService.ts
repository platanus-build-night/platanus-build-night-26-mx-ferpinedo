import sharp from "sharp";
import type { GeneratedImage } from "../types.js";

export class StickerConversionService {
  async toWhatsAppSticker(image: GeneratedImage): Promise<Buffer> {
    const maxBytes = 100 * 1024;
    let smallest: Buffer | undefined;

    for (const size of [512, 480, 448, 416, 384, 352, 320]) {
      for (const quality of [85, 75, 65, 55, 45, 35, 25]) {
        const webp = await sharp(image.buffer, { animated: false })
          .resize(size, size, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .extend({
            top: Math.floor((512 - size) / 2),
            bottom: Math.ceil((512 - size) / 2),
            left: Math.floor((512 - size) / 2),
            right: Math.ceil((512 - size) / 2),
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .webp({ quality, effort: 6 })
          .toBuffer();

        if (!smallest || webp.byteLength < smallest.byteLength) {
          smallest = webp;
        }

        if (webp.byteLength > 0 && webp.byteLength <= maxBytes) {
          console.log(`[sticker] converted sticker bytes=${webp.byteLength} contentSize=${size} quality=${quality}`);
          return webp;
        }
      }
    }

    throw new Error(`Unable to convert image below WhatsApp sticker limit. Smallest size: ${smallest?.byteLength ?? 0} bytes.`);
  }
}
