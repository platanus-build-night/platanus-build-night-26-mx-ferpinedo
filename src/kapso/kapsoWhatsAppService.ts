interface KapsoWhatsAppServiceOptions {
  enabled: boolean;
  apiKey?: string;
  apiBaseUrl: string;
  sendMessagePath: string;
  sendMessageUrl?: string;
  whatsappFrom?: string;
}

export class KapsoWhatsAppService {
  constructor(private readonly options: KapsoWhatsAppServiceOptions) {}

  async sendText(to: string, text: string): Promise<void> {
    if (!this.options.enabled) {
      console.log(`[kapso] skipped outbound text to=${to} because KAPSO_ENABLED=false`);
      return;
    }

    if (!this.options.apiKey) {
      throw new Error("KAPSO_API_KEY is required when KAPSO_ENABLED=true.");
    }

    const response = await fetch(this.sendMessageUrl(), {
      method: "POST",
      headers: {
        "X-API-Key": this.options.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body: text
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Kapso send-message failed: ${response.status} ${await response.text()}`);
    }

    console.log(`[kapso] sent outbound text to=${to} status=${response.status}`);
  }

  async sendStickerLink(to: string, link: string): Promise<void> {
    if (!this.options.enabled) {
      console.log(`[kapso] skipped outbound sticker to=${to} because KAPSO_ENABLED=false`);
      return;
    }

    if (!this.options.apiKey) {
      throw new Error("KAPSO_API_KEY is required when KAPSO_ENABLED=true.");
    }

    const response = await fetch(this.sendMessageUrl(), {
      method: "POST",
      headers: {
        "X-API-Key": this.options.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "sticker",
        sticker: {
          link
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Kapso send-sticker failed: ${response.status} ${await response.text()}`);
    }

    console.log(`[kapso] sent outbound sticker to=${to} status=${response.status}`);
  }

  private sendMessageUrl(): string {
    if (this.options.sendMessageUrl) {
      return this.options.sendMessageUrl;
    }

    const path = this.options.sendMessagePath.startsWith("/") ? this.options.sendMessagePath : `/${this.options.sendMessagePath}`;
    return `${this.options.apiBaseUrl}${path}`;
  }
}
