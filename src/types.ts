export type ConversationState =
  | "initial_message_received"
  | "waiting_for_brand_or_theme"
  | "waiting_for_sticker_style"
  | "waiting_for_sticker_phrases"
  | "generating_stickers"
  | "completed";

export interface ConversationSession {
  userId: string;
  state: ConversationState;
  brandOrTheme?: string;
  style?: string;
  phrases?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface InboundWhatsAppMessage {
  from: string;
  text: string;
  messageId?: string;
  raw?: unknown;
}

export interface StickerPrompt {
  phrase: string;
  prompt: string;
}

export interface GeneratedImage {
  phrase: string;
  prompt: string;
  buffer: Buffer;
  mimeType: string;
}

export interface StoredSticker {
  phrase: string;
  prompt: string;
  fileName: string;
  filePath: string;
  url: string;
}

export interface BotResponse {
  replies: string[];
  stickers: StoredSticker[];
  conversation: ConversationSession;
}
