import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app, services } = createApp(config);

await services.storage.ensureOutputDir();

app.listen(config.port, () => {
  console.log(`Sticky bot listening on ${config.baseUrl}`);
  console.log(`WhatsApp webhook: ${config.baseUrl}/webhooks/whatsapp`);
});
