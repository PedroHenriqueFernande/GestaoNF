import sharp from 'sharp';
import { z } from 'zod';
import { InvalidStoredContent } from './r2-storage.service.js';

export const IMAGE_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageUploadMime = typeof IMAGE_UPLOAD_TYPES[number];
export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_PIXELS = 20_000_000;

export const beginImageUploadSchema = z.strictObject({
  mimeType: z.enum(IMAGE_UPLOAD_TYPES),
  sizeBytes: z.number().int().min(1).max(IMAGE_UPLOAD_MAX_BYTES),
});
export type BeginImageUpload = z.infer<typeof beginImageUploadSchema>;

export type ImageVariant = { size: number; fit: 'inside' | 'cover'; quality: number; maxBytes: number };
export type ImageProfile = { minSide?: number; variants: readonly ImageVariant[] };

// Avatar de usuário: comportamento fixado pelos testes de caracterização (Meu perfil).
export const AVATAR_IMAGE: ImageProfile = { variants: [{ size: 512, fit: 'inside', quality: 80, maxBytes: 1024 * 1024 }] };
// Foto da empresa: principal guardada para usos futuros + miniatura servida nas telas.
export const COMPANY_LOGO_IMAGE: ImageProfile = {
  minSide: 128,
  variants: [
    { size: 1080, fit: 'inside', quality: 80, maxBytes: 2 * 1024 * 1024 },
    { size: 128, fit: 'cover', quality: 80, maxBytes: 128 * 1024 },
  ],
};

const FORMATS: Record<string, 'jpeg' | 'png' | 'webp'> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };

function hasSignature(body: Buffer, format: 'jpeg' | 'png' | 'webp' | undefined) {
  if (format === 'jpeg') return body.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (format === 'png') return body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (format === 'webp') return body.subarray(0, 4).toString() === 'RIFF' && body.subarray(8, 12).toString() === 'WEBP';
  return false;
}

/** Valida a imagem uma vez e gera cada variante como WebP sem metadados, na ordem de `profile.variants`. */
export async function normalizeImage(body: Buffer, mime: string, profile: ImageProfile) {
  if (!body.length || body.length > IMAGE_UPLOAD_MAX_BYTES) throw new InvalidStoredContent('Tamanho de imagem inválido');
  const format = FORMATS[mime];
  if (!hasSignature(body, format)) throw new InvalidStoredContent('O conteúdo não corresponde a JPEG, PNG ou WebP');
  const options = { limitInputPixels: IMAGE_MAX_PIXELS, failOn: 'warning' as const, animated: false };
  let width: number, height: number;
  try {
    const meta = await sharp(body, options).timeout({ seconds: 15 }).metadata();
    if (meta.format !== format || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height || meta.width * meta.height > IMAGE_MAX_PIXELS) throw new Error('Formato ou dimensões inválidos');
    width = meta.width; height = meta.height;
  } catch { throw new InvalidStoredContent('Imagem inválida, animada ou acima dos limites'); }
  // O lado menor não muda com a rotação EXIF; por isso pode ser conferido antes de decodificar.
  if (profile.minSide && Math.min(width, height) < profile.minSide) throw new InvalidStoredContent(`Imagem menor que ${profile.minSide} × ${profile.minSide} pixels`);
  try {
    const variants: { body: Buffer; width: number; height: number }[] = [];
    for (const variant of profile.variants) {
      const output = await sharp(body, options).rotate()
        .resize(variant.size, variant.size, { fit: variant.fit, position: 'centre', withoutEnlargement: true })
        .webp({ quality: variant.quality }).timeout({ seconds: 15 }).toBuffer({ resolveWithObject: true });
      if (!output.data.length || output.data.length > variant.maxBytes) throw new Error('Saída acima do limite');
      variants.push({ body: output.data, width: output.info.width, height: output.info.height });
    }
    return variants;
  } catch { throw new InvalidStoredContent('Imagem inválida, animada ou acima dos limites'); }
}
