import sharp from "sharp";
import type { ImageGenerationMode } from "../config.js";
import type { GeneratedImage, StickerPrompt } from "../types.js";

interface ImageGenerationServiceOptions {
  apiKey?: string;
  model: string;
  mode: ImageGenerationMode;
}

interface OpenAIImageResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
}

export class ImageGenerationService {
  constructor(private readonly options: ImageGenerationServiceOptions) {}

  async generate(stickerPrompt: StickerPrompt): Promise<GeneratedImage> {
    if (this.options.mode === "mock") {
      return this.generateMockImage(stickerPrompt);
    }

    if (!this.options.apiKey) {
      if (this.options.mode === "openai") {
        throw new Error("OPENAI_API_KEY is required when IMAGE_GENERATION_MODE=openai.");
      }

      return this.generateMockImage(stickerPrompt);
    }

    try {
      return await this.generateOpenAIImage(stickerPrompt);
    } catch (error) {
      if (this.options.mode === "openai") {
        throw error;
      }

      console.warn("OpenAI image generation failed. Falling back to local mock image.", error);
      return this.generateMockImage(stickerPrompt);
    }
  }

  async generateWithReference(stickerPrompt: StickerPrompt, referenceImage: Buffer): Promise<GeneratedImage> {
    if (this.options.mode === "mock") {
      return this.generateMockImage(stickerPrompt);
    }

    if (!this.options.apiKey) {
      if (this.options.mode === "openai") {
        throw new Error("OPENAI_API_KEY is required when IMAGE_GENERATION_MODE=openai.");
      }

      return this.generateMockImage(stickerPrompt);
    }

    try {
      return await this.generateOpenAIImageEdit(stickerPrompt, referenceImage);
    } catch (error) {
      if (this.options.mode === "openai") {
        throw error;
      }

      console.warn("OpenAI image edit failed. Falling back to local mock image.", error);
      return this.generateMockImage(stickerPrompt);
    }
  }

  private async generateOpenAIImage(stickerPrompt: StickerPrompt): Promise<GeneratedImage> {
    const body: Record<string, unknown> = {
      model: this.options.model,
      prompt: stickerPrompt.prompt,
      size: "1024x1024",
      n: 1
    };

    if (this.options.model.includes("gpt-image")) {
      body.background = "transparent";
    }

    if (this.options.model.startsWith("dall-e")) {
      body.response_format = "b64_json";
    }

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`OpenAI image generation failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as OpenAIImageResponse;
    const image = payload.data?.[0];
    if (!image) {
      throw new Error("OpenAI image generation returned no image.");
    }

    if (image.b64_json) {
      return {
        phrase: stickerPrompt.phrase,
        prompt: stickerPrompt.prompt,
        buffer: Buffer.from(image.b64_json, "base64"),
        mimeType: "image/png"
      };
    }

    if (image.url) {
      const imageResponse = await fetch(image.url);
      if (!imageResponse.ok) {
        throw new Error(`OpenAI image download failed: ${imageResponse.status} ${await imageResponse.text()}`);
      }

      return {
        phrase: stickerPrompt.phrase,
        prompt: stickerPrompt.prompt,
        buffer: Buffer.from(await imageResponse.arrayBuffer()),
        mimeType: imageResponse.headers.get("content-type") || "image/png"
      };
    }

    throw new Error("OpenAI image generation returned an unsupported response.");
  }

  private async generateOpenAIImageEdit(stickerPrompt: StickerPrompt, referenceImage: Buffer): Promise<GeneratedImage> {
    const referencePng = await sharp(referenceImage, { animated: false })
      .resize(1024, 1024, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();

    const body = new FormData();
    body.append("model", this.options.model);
    body.append("prompt", stickerPrompt.prompt);
    body.append("size", "1024x1024");
    body.append("n", "1");
    if (this.options.model.includes("gpt-image")) {
      body.append("background", "transparent");
    }
    const referenceArrayBuffer = referencePng.buffer.slice(
      referencePng.byteOffset,
      referencePng.byteOffset + referencePng.byteLength
    ) as ArrayBuffer;
    body.append("image", new Blob([referenceArrayBuffer], { type: "image/png" }), "reference.png");

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`
      },
      body
    });

    if (!response.ok) {
      throw new Error(`OpenAI image edit failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as OpenAIImageResponse;
    const image = payload.data?.[0];
    if (!image) {
      throw new Error("OpenAI image edit returned no image.");
    }

    if (image.b64_json) {
      return {
        phrase: stickerPrompt.phrase,
        prompt: stickerPrompt.prompt,
        buffer: Buffer.from(image.b64_json, "base64"),
        mimeType: "image/png"
      };
    }

    if (image.url) {
      const imageResponse = await fetch(image.url);
      if (!imageResponse.ok) {
        throw new Error(`OpenAI edited image download failed: ${imageResponse.status} ${await imageResponse.text()}`);
      }

      return {
        phrase: stickerPrompt.phrase,
        prompt: stickerPrompt.prompt,
        buffer: Buffer.from(await imageResponse.arrayBuffer()),
        mimeType: imageResponse.headers.get("content-type") || "image/png"
      };
    }

    throw new Error("OpenAI image edit returned an unsupported response.");
  }

  private async generateMockImage(stickerPrompt: StickerPrompt): Promise<GeneratedImage> {
    const svg = this.buildMockStickerSvg(stickerPrompt.phrase);
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();

    return {
      phrase: stickerPrompt.phrase,
      prompt: stickerPrompt.prompt,
      buffer,
      mimeType: "image/png"
    };
  }

  private buildMockStickerSvg(phrase: string): string {
    const lines = wrapText(phrase, 15).slice(0, 4);
    const startY = 448 - (lines.length - 1) * 58;
    const text = lines
      .map((line, index) => `<text x="512" y="${startY + index * 116}" text-anchor="middle" class="phrase">${escapeXml(line)}</text>`)
      .join("");

    return `
      <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000000" flood-opacity="0.20"/>
          </filter>
        </defs>
        <style>
          .bubble { fill: #fff8dc; stroke: #111111; stroke-width: 18; }
          .accent { fill: #35d366; stroke: #111111; stroke-width: 14; }
          .phrase { font-family: Arial, Helvetica, sans-serif; font-size: 92px; font-weight: 900; fill: #111111; paint-order: stroke; stroke: #ffffff; stroke-width: 18; stroke-linejoin: round; }
          .tag { font-family: Arial, Helvetica, sans-serif; font-size: 42px; font-weight: 800; fill: #111111; }
        </style>
        <g filter="url(#shadow)">
          <path class="bubble" d="M150 195 Q150 128 218 128 H806 Q874 128 874 195 V756 Q874 824 806 824 H488 L350 928 L374 824 H218 Q150 824 150 756 Z"/>
          <circle class="accent" cx="774" cy="254" r="84"/>
          <text x="774" y="279" text-anchor="middle" class="tag">AI</text>
          ${text}
        </g>
      </svg>`;
  }
}

function wrapText(input: string, maxCharacters: number): string[] {
  const words = input.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharacters && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [input];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
