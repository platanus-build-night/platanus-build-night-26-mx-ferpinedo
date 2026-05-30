export function parseStickerPhrases(input: string): string[] {
  return input
    .split(/[,;\n]+/)
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}
