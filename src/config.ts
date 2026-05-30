import "dotenv/config";
import path from "node:path";

export type ImageGenerationMode = "auto" | "openai" | "mock";

export interface AppConfig {
  port: number;
  baseUrl: string;
  publicFilesUrl: string;
  storageDir: string;
  imageGenerationMode: ImageGenerationMode;
  openAiApiKey?: string;
  openAiImageModel: string;
  kapsoEnabled: boolean;
  kapsoApiKey?: string;
  kapsoApiBaseUrl: string;
  kapsoSendMessagePath: string;
  kapsoSendMessageUrl?: string;
  kapsoWhatsAppFrom?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 3000);
  const baseUrl = trimTrailingSlash(env.BASE_URL || `http://localhost:${port}`);
  const publicFilesUrl = trimTrailingSlash(env.PUBLIC_FILES_URL || `${baseUrl}/files`);
  const storageDir = path.resolve(process.cwd(), env.STORAGE_DIR || "generated");
  const imageGenerationMode = parseImageGenerationMode(env.IMAGE_GENERATION_MODE);

  return {
    port,
    baseUrl,
    publicFilesUrl,
    storageDir,
    imageGenerationMode,
    openAiApiKey: emptyToUndefined(env.OPENAI_API_KEY),
    openAiImageModel: env.OPENAI_IMAGE_MODEL || "gpt-image-1",
    kapsoEnabled: env.KAPSO_ENABLED === "true",
    kapsoApiKey: emptyToUndefined(env.KAPSO_API_KEY),
    kapsoApiBaseUrl: trimTrailingSlash(env.KAPSO_API_BASE_URL || "https://api.kapso.ai"),
    kapsoSendMessagePath: env.KAPSO_SEND_MESSAGE_PATH || "/whatsapp/messages",
    kapsoSendMessageUrl: emptyToUndefined(env.KAPSO_SEND_MESSAGE_URL),
    kapsoWhatsAppFrom: emptyToUndefined(env.KAPSO_WHATSAPP_FROM)
  };
}

function parseImageGenerationMode(value: string | undefined): ImageGenerationMode {
  if (value === "openai" || value === "mock" || value === "auto") {
    return value;
  }

  return "auto";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}
