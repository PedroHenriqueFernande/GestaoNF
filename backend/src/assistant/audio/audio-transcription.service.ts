// backend/src/assistant/audio/audio-transcription.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { whatsappConnections, whatsappInboxEvents, whatsappLinks } from '@gestaonf/database/schema';
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.module.js';
import { MediaRejectedError, MetaMediaClient } from '../../whatsapp/meta-media.client.js';
import { audioFormat, estimateSeconds } from './audio-format.js';
import { oggOpusDurationSeconds } from './ogg-duration.js';
import { NERO_TRANSCRIBER, type NeroTranscriber } from './transcriber.js';

type InboxEvent = typeof whatsappInboxEvents.$inferSelect;
export type AudioRejection = 'TOO_LONG' | 'TOO_LARGE' | 'DAILY_LIMIT' | 'UNSUPPORTED' | 'EMPTY' | 'FAILED';
export type TranscriptionOutcome = { ok: true; text: string } | { ok: false; reason: AudioRejection };

/** Respostas ao usuário para cada recusa, em linguagem simples. */
export const AUDIO_REPLIES: Record<AudioRejection, string> = {
  TOO_LONG: 'Seu áudio é longo demais para eu ouvir (o limite é de 5 minutos). Pode mandar um mais curto ou escrever?',
  TOO_LARGE: 'Seu áudio é grande demais para eu ouvir. Pode mandar um mais curto ou escrever?',
  DAILY_LIMIT: 'Você atingiu o limite de áudios por hoje. Pode escrever sua mensagem?',
  UNSUPPORTED: 'Não consigo ouvir esse formato de áudio. Pode mandar uma mensagem de voz ou escrever?',
  EMPTY: 'Não consegui entender bem o áudio, pode repetir ou escrever?',
  FAILED: 'Não consegui ouvir seu áudio agora. Pode tentar de novo ou escrever?',
};

const MAX_INT = 2_147_483_647;

function positiveNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

@Injectable()
export class AudioTranscriptionService {
  private readonly logger = new Logger(AudioTranscriptionService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MetaMediaClient) private readonly media: MetaMediaClient,
    @Inject(NERO_TRANSCRIBER) private readonly transcriber: NeroTranscriber,
  ) {}

  /**
   * Segundos de áudio cobrados deste usuário nas últimas 24 horas, somando todos os números vinculados a ele.
   * Contam transcrições concluídas, vazias e falhas depois do download (a chamada paga já foi feita).
   */
  private async usedSeconds(event: InboxEvent) {
    const [link] = await this.database.db.select({ userId: whatsappLinks.userId }).from(whatsappLinks)
      .where(and(eq(whatsappLinks.connectionId, event.connectionId), eq(whatsappLinks.senderId, event.senderId)))
      .orderBy(desc(sql`${whatsappLinks.status} = 'ACTIVE'`)).limit(1);
    const sender = link
      ? sql`(${whatsappInboxEvents.connectionId}, ${whatsappInboxEvents.senderId}) IN (SELECT ${whatsappLinks.connectionId}, ${whatsappLinks.senderId} FROM ${whatsappLinks} WHERE ${whatsappLinks.userId} = ${link.userId})`
      : and(eq(whatsappInboxEvents.connectionId, event.connectionId), eq(whatsappInboxEvents.senderId, event.senderId));
    const [row] = await this.database.db.select({ total: sql<string>`coalesce(sum(${whatsappInboxEvents.mediaSeconds}), 0)` }).from(whatsappInboxEvents)
      .where(and(
        sender,
        or(inArray(whatsappInboxEvents.transcriptionStatus, ['DONE', 'EMPTY']), and(eq(whatsappInboxEvents.transcriptionStatus, 'FAILED'), isNotNull(whatsappInboxEvents.mediaSeconds))),
        gte(whatsappInboxEvents.transcribedAt, new Date(Date.now() - 86_400_000)),
      ));
    return Number(row?.total ?? 0);
  }

  private async reject(event: InboxEvent, reason: AudioRejection, seconds: number | null = null): Promise<TranscriptionOutcome> {
    await this.database.db.update(whatsappInboxEvents).set({ transcriptionStatus: reason === 'FAILED' ? 'FAILED' : reason === 'EMPTY' ? 'EMPTY' : 'REJECTED', mediaSeconds: seconds, transcribedAt: new Date() })
      .where(eq(whatsappInboxEvents.id, event.id));
    return { ok: false, reason };
  }

  async transcribe(event: InboxEvent): Promise<TranscriptionOutcome> {
    if (event.transcriptionStatus === 'DONE' && event.messageText) return { ok: true, text: event.messageText };
    const audio = (event.payload as { audio?: { id?: unknown; mime_type?: unknown; sha256?: unknown } } | null)?.audio;
    if (!audio || typeof audio.id !== 'string') return this.reject(event, 'FAILED');
    const format = audioFormat(typeof audio.mime_type === 'string' ? audio.mime_type : null);
    if (!format) return this.reject(event, 'UNSUPPORTED');
    const dailyLimit = positiveNumber('NERO_AUDIO_DAILY_MINUTES', 30) * 60;
    const used = await this.usedSeconds(event);
    if (used >= dailyLimit) return this.reject(event, 'DAILY_LIMIT');

    const [connection] = await this.database.db.select({ phoneNumberId: whatsappConnections.phoneNumberId }).from(whatsappConnections).where(eq(whatsappConnections.id, event.connectionId)).limit(1);
    if (!connection) return this.reject(event, 'FAILED');
    let bytes: Buffer;
    try {
      ({ bytes } = await this.media.download(audio.id, connection.phoneNumberId, { maxBytes: positiveNumber('NERO_AUDIO_MAX_BYTES', 16 * 1024 * 1024), sha256: typeof audio.sha256 === 'string' ? audio.sha256 : null }));
    } catch (error) {
      if (error instanceof MediaRejectedError && error.reason === 'TOO_LARGE') return this.reject(event, 'TOO_LARGE');
      this.logger.warn({ event: 'nero_audio_download_failed', errorType: error instanceof Error ? error.name : 'Unknown', ...(error instanceof MediaRejectedError ? { reason: error.reason } : {}) });
      return this.reject(event, 'FAILED');
    }

    const measured = format.extension === 'ogg' ? oggOpusDurationSeconds(bytes) : null;
    // A duração do arquivo é só uma declaração: o piso de 8.000 B/s vale mesmo quando ela foi lida.
    let seconds = Math.min(MAX_INT, Math.ceil(Math.max(measured ?? 0, bytes.length / 8_000, measured === null ? estimateSeconds(format, bytes.length) : 0)));
    if (seconds > positiveNumber('NERO_AUDIO_MAX_SECONDS', 300)) return this.reject(event, 'TOO_LONG', seconds);
    if (used + seconds > dailyLimit) return this.reject(event, 'DAILY_LIMIT', seconds);

    let text: string;
    try {
      const result = await this.transcriber.transcribe({ bytes, extension: format.extension, mimeType: format.mime });
      text = result.text;
      if (result.seconds !== null) seconds = Math.min(MAX_INT, Math.max(seconds, Math.ceil(result.seconds)));
    } catch (error) {
      this.logger.warn({ event: 'nero_audio_transcription_failed', errorType: error instanceof Error ? error.name : 'Unknown' });
      return this.reject(event, 'FAILED', seconds);
    }
    if (!text.replace(/[\s.…,!?;:-]/g, '')) return this.reject(event, 'EMPTY', seconds);
    await this.database.db.update(whatsappInboxEvents).set({ messageText: text, transcriptionStatus: 'DONE', mediaSeconds: seconds, transcribedAt: new Date() })
      .where(eq(whatsappInboxEvents.id, event.id));
    return { ok: true, text };
  }
}
