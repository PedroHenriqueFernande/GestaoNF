// backend/src/assistant/audio/audio-format.ts
/** Formatos aceitos pela transcrição da OpenAI (flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm). */
type FormatInfo = { extension: string; bytesPerSecond: number };

// bytesPerSecond é conservador (taxa baixa) para não subestimar a duração quando não há como lê-la.
const FORMATS: Record<string, FormatInfo> = {
  'audio/ogg': { extension: 'ogg', bytesPerSecond: 2_000 },
  'audio/opus': { extension: 'ogg', bytesPerSecond: 2_000 },
  'audio/webm': { extension: 'webm', bytesPerSecond: 2_000 },
  'audio/mpeg': { extension: 'mp3', bytesPerSecond: 8_000 },
  'audio/mp3': { extension: 'mp3', bytesPerSecond: 8_000 },
  'audio/mp4': { extension: 'm4a', bytesPerSecond: 8_000 },
  'audio/m4a': { extension: 'm4a', bytesPerSecond: 8_000 },
  'audio/x-m4a': { extension: 'm4a', bytesPerSecond: 8_000 },
  'audio/wav': { extension: 'wav', bytesPerSecond: 16_000 },
  'audio/x-wav': { extension: 'wav', bytesPerSecond: 16_000 },
  'audio/flac': { extension: 'flac', bytesPerSecond: 16_000 },
};

export type AudioFormat = FormatInfo & { mime: string };

export function audioFormat(mimeType: string | null | undefined): AudioFormat | null {
  const mime = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  const info = FORMATS[mime];
  return info ? { mime, ...info } : null;
}

export function estimateSeconds(format: AudioFormat, bytes: number) {
  return Math.ceil(bytes / format.bytesPerSecond);
}
