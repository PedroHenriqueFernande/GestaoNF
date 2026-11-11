// backend/src/assistant/audio/transcriber.ts
import OpenAI, { toFile } from 'openai';

export interface NeroTranscriber {
  readonly name: string;
  /** `seconds` é a duração cobrada pelo provedor, quando ele a informa. */
  transcribe(input: { bytes: Buffer; extension: string; mimeType: string }): Promise<{ text: string; seconds: number | null }>;
}

export const NERO_TRANSCRIBER = Symbol('NERO_TRANSCRIBER');

/** Transcrição pela OpenAI, com os bytes em memória (sem arquivo temporário). */
export class OpenAITranscriber implements NeroTranscriber {
  private client: OpenAI | null = null;
  get name() { return process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-transcribe'; }

  async transcribe(input: { bytes: Buffer; extension: string; mimeType: string }) {
    this.client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });
    const file = await toFile(input.bytes, `audio.${input.extension}`, { type: input.mimeType });
    const result = await this.client.audio.transcriptions.create({ file, model: this.name, language: 'pt' });
    const usage = (result as { usage?: { type?: unknown; seconds?: unknown } }).usage;
    const seconds = usage?.type === 'duration' && typeof usage.seconds === 'number' && Number.isFinite(usage.seconds) && usage.seconds >= 0 ? usage.seconds : null;
    return { text: (result.text ?? '').trim(), seconds };
  }
}
