# Sticky

Sticky is a WhatsApp-first bot prototype that generates AI sticker packs for businesses and consumers. A user messages the bot with a brand or theme, a style, and three phrases. Sticky generates one square sticker per phrase, converts each image to WhatsApp-ready WebP, and returns download links.

This project intentionally has no landing page, database, authentication, payments, analytics, or user accounts.

## Stack

- TypeScript Node.js backend
- Express webhook server
- In-memory conversation state
- OpenAI image generation when configured
- Local mock image generation when no API key is present
- Sharp WebP sticker conversion
- Kapso WhatsApp text sending service

## Project Structure

```text
src/server.ts                       Server entry point
src/app.ts                          App wiring
src/whatsapp/webhook.ts             WhatsApp/Kapso webhook endpoint
src/conversation/stateManager.ts    In-memory conversation state
src/conversation/stickyBot.ts       Conversation state machine
src/ai/promptGenerator.ts           Sticker prompt generation
src/images/imageGenerationService.ts AI or mock image generation
src/stickers/stickerConversionService.ts WebP sticker conversion
src/storage/fileStorageService.ts   Local file output and public URLs
src/kapso/kapsoWhatsAppService.ts   Kapso WhatsApp send-message service
```

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Webhook URL:

```text
POST http://localhost:3000/webhooks/whatsapp
```

Health check:

```bash
curl http://localhost:3000/health
```

## Local Demo

Run the full demo flow without external APIs:

```bash
npm run smoke
```

Generated `.webp` files are written to `generated/` and served from:

```text
http://localhost:3000/files/<file-name>.webp
```

## Webhook Demo Payloads

Send these one by one with the same `from` value:

```bash
curl -X POST http://localhost:3000/webhooks/whatsapp \
  -H 'Content-Type: application/json' \
  -d '{"from":"demo-user","text":"Hi"}'

curl -X POST http://localhost:3000/webhooks/whatsapp \
  -H 'Content-Type: application/json' \
  -d '{"from":"demo-user","text":"Tacos Don Rafa"}'

curl -X POST http://localhost:3000/webhooks/whatsapp \
  -H 'Content-Type: application/json' \
  -d '{"from":"demo-user","text":"Funny Mexican meme style with cute tacos"}'

curl -X POST http://localhost:3000/webhooks/whatsapp \
  -H 'Content-Type: application/json' \
  -d '{"from":"demo-user","text":"Hoy toca pastor, Sin salsa no hay paraiso, Yo invito tu pagas"}'
```

Expected bot flow:

```text
Bot: What brand or theme do you want stickers for?
Bot: What visual style do you want?
Bot: Send me three sticker phrases separated by commas.
Bot: Generating your stickers.
Bot: Your stickers are ready: <three links>
```

## AI Image Generation

By default, `IMAGE_GENERATION_MODE=auto`. If `OPENAI_API_KEY` is empty, Sticky creates local mock sticker images so the webhook flow still works.

To use real AI image generation:

```env
IMAGE_GENERATION_MODE=openai
OPENAI_API_KEY=sk-...
OPENAI_IMAGE_MODEL=gpt-image-1
```

## Kapso Sending

For local testing, `KAPSO_ENABLED=false` means webhook responses include the bot replies and sticker links without sending real WhatsApp messages.

To send replies through Kapso:

```env
KAPSO_ENABLED=true
KAPSO_API_KEY=...
KAPSO_API_BASE_URL=https://api.kapso.ai
KAPSO_SEND_MESSAGE_PATH=/whatsapp/messages
KAPSO_WHATSAPP_FROM=...
```

If your Kapso workspace uses a different send-message URL, set `KAPSO_SEND_MESSAGE_URL` to the full URL.

Use a tunnel such as ngrok for WhatsApp/Kapso webhooks and public sticker links:

```env
BASE_URL=https://your-tunnel.ngrok-free.app
PUBLIC_FILES_URL=https://your-tunnel.ngrok-free.app/files
```

## Conversation States

- `initial_message_received`
- `waiting_for_brand_or_theme`
- `waiting_for_sticker_style`
- `waiting_for_sticker_phrases`
- `generating_stickers`
- `completed`

Send `restart` or `new` to restart the flow for a user.
