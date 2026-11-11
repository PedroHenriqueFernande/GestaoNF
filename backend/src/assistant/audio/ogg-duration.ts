// backend/src/assistant/audio/ogg-duration.ts
/**
 * Duração de um OGG/Opus em segundos: granule position da última página do mesmo fluxo (sempre a 48 kHz no Opus)
 * menos o pre-skip do cabeçalho OpusHead, que precisa estar na primeira página.
 * Devolve null se o conteúdo não for OGG/Opus legível ou se for Ogg encadeado (mais de uma página BOS).
 * A duração é só uma declaração do arquivo: quem usa deve aplicar também um piso por tamanho.
 */
export function oggOpusDurationSeconds(bytes: Uint8Array): number | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let serial: number | null = null;
  let preSkip = 0;
  let bosPages = 0;
  let granule: bigint | null = null;
  while (offset + 27 <= buffer.length && buffer.toString('latin1', offset, offset + 4) === 'OggS') {
    const segments = buffer[offset + 26];
    const payload = offset + 27 + segments;
    if (payload > buffer.length) break;
    if ((buffer[offset + 5] & 0x02) !== 0 && ++bosPages > 1) return null;
    const pageSerial = buffer.readUInt32LE(offset + 14);
    if (serial === null) {
      if (buffer.toString('latin1', payload, payload + 8) !== 'OpusHead' || payload + 12 > buffer.length) return null;
      serial = pageSerial;
      preSkip = buffer.readUInt16LE(payload + 10);
    }
    const value = buffer.readBigInt64LE(offset + 6);
    if (pageSerial === serial && value >= 0n) granule = value;
    let size = 0;
    for (let i = 0; i < segments; i++) size += buffer[offset + 27 + i];
    offset = payload + size;
  }
  if (serial === null || granule === null) return null;
  return Math.max(0, Number(granule) - preSkip) / 48_000;
}
