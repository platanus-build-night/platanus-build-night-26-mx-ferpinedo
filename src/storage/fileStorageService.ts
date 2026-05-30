import fs from "node:fs/promises";
import path from "node:path";
import type { StoredSticker } from "../types.js";

interface FileStorageServiceOptions {
  outputDir: string;
  publicFilesUrl: string;
}

interface SaveStickerInput {
  userId: string;
  index: number;
  phrase: string;
  prompt: string;
  webp: Buffer;
}

export class FileStorageService {
  constructor(private readonly options: FileStorageServiceOptions) {}

  async ensureOutputDir(): Promise<void> {
    await fs.mkdir(this.options.outputDir, { recursive: true });
  }

  async saveSticker(input: SaveStickerInput): Promise<StoredSticker> {
    await this.ensureOutputDir();

    const timestamp = Date.now();
    const safeUser = sanitizeFilePart(input.userId).slice(0, 24) || "user";
    const safePhrase = sanitizeFilePart(input.phrase).slice(0, 48) || "sticker";
    const fileName = `${timestamp}-${safeUser}-${input.index + 1}-${safePhrase}.webp`;
    const filePath = path.join(this.options.outputDir, fileName);

    await fs.writeFile(filePath, input.webp);

    return {
      phrase: input.phrase,
      prompt: input.prompt,
      fileName,
      filePath,
      url: `${this.options.publicFilesUrl}/${encodeURIComponent(fileName)}`
    };
  }

  async saveManifest(userId: string, stickers: StoredSticker[]): Promise<string> {
    await this.ensureOutputDir();

    const fileName = `${Date.now()}-${sanitizeFilePart(userId).slice(0, 24) || "user"}-manifest.json`;
    const filePath = path.join(this.options.outputDir, fileName);
    await fs.writeFile(
      filePath,
      JSON.stringify(
        {
          userId,
          createdAt: new Date().toISOString(),
          stickers
        },
        null,
        2
      )
    );
    return filePath;
  }
}

function sanitizeFilePart(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
