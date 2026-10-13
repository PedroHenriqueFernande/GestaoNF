import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { MAX_IMAGE_PIXELS, maxFileBytes, type FileMime } from './files.config.js';
import { InvalidStoredContent } from './r2-storage.service.js';

export async function validateFileContent(body: Buffer, mime: FileMime) {
  if (!body.length || body.length > maxFileBytes(mime)) throw new InvalidStoredContent('Tamanho do arquivo inválido');
  if (mime === 'application/pdf') {
    if (!body.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new InvalidStoredContent('O conteúdo não corresponde a um PDF');
    try {
      const document = await PDFDocument.load(body, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
      const pageCount = document.getPageCount();
      if (!pageCount || pageCount > 2000) throw new Error('Páginas inválidas');
      // PDFs retain original bytes (including signatures) and are always downloaded as attachments.
      return { body, width: null, height: null, pageCount };
    } catch { throw new InvalidStoredContent('PDF inválido, protegido por senha ou acima de 2.000 páginas'); }
  }
  const format = { 'image/jpeg': 'jpeg', 'image/png': 'png' }[mime] as 'jpeg' | 'png';
  try {
    const signature = mime === 'image/png' ? Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) : Buffer.from([255, 216, 255]);
    if (!body.subarray(0, signature.length).equals(signature)) throw new Error('Assinatura inválida');
    const options = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' as const, animated: false };
    const metadata = await sharp(body, options).metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1) throw new Error('Formato inválido');
    // Decode and encode a single image; remove EXIF/GPS and trailing or embedded non-image data.
    const result = await sharp(body, options).rotate().toFormat(format).timeout({ seconds: 15 }).toBuffer({ resolveWithObject: true });
    if (result.data.length > maxFileBytes(mime)) throw new Error('Imagem acima do limite após processamento');
    return { body: result.data, width: result.info.width, height: result.info.height, pageCount: null };
  } catch { throw new InvalidStoredContent('Imagem inválida, animada ou acima de 40 milhões de pixels'); }
}
