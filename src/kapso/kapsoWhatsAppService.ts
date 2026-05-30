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
      return;
    }

    if (!this.options.apiKey) {
      throw new Error("KAPSO_API_KEY is required when KAPSO_ENABLED=true.");
    }

    const response = await fetch(this.sendMessageUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        channel: "whatsapp",
        to,
        from: this.options.whatsappFrom,
        type: "text",
        text
      })
    });

    if (!response.ok) {
      throw new Error(`Kapso send-message failed: ${response.status} ${await response.text()}`);
    }
  }

  private sendMessageUrl(): string {
    if (this.options.sendMessageUrl) {
      return this.options.sendMessageUrl;
    }

    const path = this.options.sendMessagePath.startsWith("/") ? this.options.sendMessagePath : `/${this.options.sendMessagePath}`;
    return `${this.options.apiBaseUrl}${path}`;
  }
}
