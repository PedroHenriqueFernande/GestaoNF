import sharp from 'sharp';
import { InvalidStoredContent } from '../files/r2-storage.service.js';

export async function normalizeAvatar(body: Buffer, mime: string) {
  if (!body.length || body.length > 5 * 1024 * 1024) throw new InvalidStoredContent('Tamanho de imagem inválido');
  const format = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }[mime] as 'jpeg' | 'png' | 'webp' | undefined;
  const signature = format === 'jpeg' ? body.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    : format === 'png' ? body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : format === 'webp' ? body.subarray(0, 4).toString() === 'RIFF' && body.subarray(8, 12).toString() === 'WEBP' : false;
  if (!signature) throw new InvalidStoredContent('O conteúdo não corresponde a JPEG, PNG ou WebP');
  try {
    const options = { limitInputPixels: 20_000_000, failOn: 'warning' as const, animated: false };
    const meta = await sharp(body, options).timeout({ seconds: 15 }).metadata();
    if (meta.format !== format || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height || meta.width * meta.height > 20_000_000) throw new Error('Formato ou dimensões inválidos');
    const output = await sharp(body, options).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).timeout({ seconds: 15 }).toBuffer({ resolveWithObject: true });
    if (!output.data.length || output.data.length > 1024 * 1024) throw new Error('Saída acima de 1 MiB');
    return { body: output.data, width: output.info.width, height: output.info.height };
  } catch { throw new InvalidStoredContent('Imagem inválida, animada ou acima dos limites'); }
}
