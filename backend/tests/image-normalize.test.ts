import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { AVATAR_IMAGE, COMPANY_LOGO_IMAGE, normalizeImage } from '../src/files/image-normalize.js';
const normalizeAvatar = async (body: Buffer, mime: string) => (await normalizeImage(body, mime, AVATAR_IMAGE))[0];

const image = (width: number, height: number, format: 'png' | 'jpeg' | 'webp' = 'png') =>
  sharp({ create: { width, height, channels: 3, background: '#147b92' } }).toFormat(format).toBuffer();

const solid = (width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

describe('avatar (caracterização do comportamento atual)', () => {
  it('reduz para caber em 512 sem ampliar e gera WebP', async () => {
    const big = await normalizeAvatar(await image(2000, 1000), 'image/png');
    expect([big.width, big.height]).toEqual([512, 256]);
    expect((await sharp(big.body).metadata()).format).toBe('webp');
    const small = await normalizeAvatar(await image(100, 80, 'jpeg'), 'image/jpeg');
    expect([small.width, small.height]).toEqual([100, 80]);
    const webp = await normalizeAvatar(await image(600, 600, 'webp'), 'image/webp');
    expect([webp.width, webp.height]).toEqual([512, 512]);
  });
  it('aplica a orientação EXIF e remove metadados', async () => {
    const input = await sharp({ create: { width: 300, height: 100, channels: 3, background: '#ffffff' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await normalizeAvatar(input, 'image/jpeg');
    expect([out.width, out.height]).toEqual([100, 300]);
    const meta = await sharp(out.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });
  it('recusa entradas inválidas com as mensagens atuais', async () => {
    await expect(normalizeAvatar(Buffer.alloc(0), 'image/png')).rejects.toThrow('Tamanho de imagem inválido');
    await expect(normalizeAvatar(Buffer.alloc(5 * 1024 * 1024 + 1, 1), 'image/png')).rejects.toThrow('Tamanho de imagem inválido');
    await expect(normalizeAvatar(Buffer.from('fake'), 'image/png')).rejects.toThrow('O conteúdo não corresponde a JPEG, PNG ou WebP');
    await expect(normalizeAvatar(await image(10, 10, 'jpeg'), 'image/png')).rejects.toThrow('O conteúdo não corresponde a JPEG, PNG ou WebP');
    // Quadros idênticos são fundidos pelo codificador WebP em um só; por isso as cores diferem.
    const frames = [await solid(10, 10, '#ff0000'), await solid(10, 10, '#0000ff')];
    const animated = await sharp(frames, { join: { animated: true } }).webp().toBuffer();
    await expect(normalizeAvatar(animated, 'image/webp')).rejects.toThrow('Imagem inválida, animada ou acima dos limites');
    const huge = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: '#000000' } }).png().toBuffer();
    await expect(normalizeAvatar(huge, 'image/png')).rejects.toThrow('Imagem inválida, animada ou acima dos limites');
  });
});

describe('foto da empresa', () => {
  it('gera principal até 1080 (inside) e miniatura 128 × 128 (cover)', async () => {
    const [main, thumb] = await normalizeImage(await image(1080, 1080), 'image/png', COMPANY_LOGO_IMAGE);
    expect([main.width, main.height, thumb.width, thumb.height]).toEqual([1080, 1080, 128, 128]);
    const [wideMain, wideThumb] = await normalizeImage(await image(3000, 1000, 'jpeg'), 'image/jpeg', COMPANY_LOGO_IMAGE);
    expect([wideMain.width, wideMain.height]).toEqual([1080, 360]);
    expect([wideThumb.width, wideThumb.height]).toEqual([128, 128]);
    const [smallMain] = await normalizeImage(await image(400, 300), 'image/png', COMPANY_LOGO_IMAGE);
    expect([smallMain.width, smallMain.height]).toEqual([400, 300]);
    for (const out of [main, thumb]) expect((await sharp(out.body).metadata()).format).toBe('webp');
  });
  it('miniatura é cover centralizado: recorta as laterais e mantém o centro', async () => {
    // Três faixas 128 × 128 (vermelho, verde, azul): só um recorte centralizado deixa a miniatura toda verde.
    const strips = await sharp({ create: { width: 384, height: 128, channels: 3, background: '#00ff00' } })
      .composite([
        { input: await solid(128, 128, '#ff0000'), left: 0, top: 0 },
        { input: await solid(128, 128, '#0000ff'), left: 256, top: 0 },
      ]).png().toBuffer();
    const [main, thumb] = await normalizeImage(strips, 'image/png', COMPANY_LOGO_IMAGE);
    expect([main.width, main.height, thumb.width, thumb.height]).toEqual([384, 128, 128, 128]);
    const { data, info } = await sharp(thumb.body).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const [x, y] of [[0, 0], [127, 0], [0, 127], [127, 127], [64, 64]]) {
      const offset = (y * info.width + x) * info.channels;
      const [r, g, b] = [data[offset], data[offset + 1], data[offset + 2]];
      expect(g).toBeGreaterThan(200);
      expect(r).toBeLessThan(60);
      expect(b).toBeLessThan(60);
    }
  });
  it('aceita lado menor igual a 128 e recusa menor que 128 px com mensagem específica', async () => {
    const [exactMain, exactThumb] = await normalizeImage(await image(128, 128), 'image/png', COMPANY_LOGO_IMAGE);
    expect([exactMain.width, exactMain.height, exactThumb.width, exactThumb.height]).toEqual([128, 128, 128, 128]);
    const [tallMain, tallThumb] = await normalizeImage(await image(128, 900), 'image/png', COMPANY_LOGO_IMAGE);
    expect([tallMain.width, tallMain.height, tallThumb.width, tallThumb.height]).toEqual([128, 900, 128, 128]);
    await expect(normalizeImage(await image(500, 127), 'image/png', COMPANY_LOGO_IMAGE)).rejects.toThrow('Imagem menor que 128 × 128 pixels');
  });
  it('aplica o teto de bytes de cada variante com a mensagem genérica', async () => {
    const tiny = { variants: [{ size: 512, fit: 'inside', quality: 80, maxBytes: 10 }] } as const;
    await expect(normalizeImage(await image(600, 600), 'image/png', tiny)).rejects.toThrow('Imagem inválida, animada ou acima dos limites');
  });
  it('aplica orientação e remove EXIF nas duas variantes', async () => {
    const input = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#ffffff' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const [main, thumb] = await normalizeImage(input, 'image/jpeg', COMPANY_LOGO_IMAGE);
    expect([main.width, main.height]).toEqual([200, 400]);
    for (const out of [main, thumb]) { const meta = await sharp(out.body).metadata(); expect(meta.exif).toBeUndefined(); expect(meta.orientation).toBeUndefined(); }
  });
  it('pior caso (ruído) fica abaixo dos tetos de 2 MiB e 128 KiB', async () => {
    const noise = Buffer.alloc(1080 * 1080 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256);
    // PNG de ruído 1080² passa de 5 MiB; JPEG q95 é o maior arquivo realista dentro do limite de entrada.
    const input = await sharp(noise, { raw: { width: 1080, height: 1080, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    expect(input.length).toBeLessThanOrEqual(5 * 1024 * 1024);
    const [main, thumb] = await normalizeImage(input, 'image/jpeg', COMPANY_LOGO_IMAGE);
    expect(main.body.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(thumb.body.length).toBeLessThanOrEqual(128 * 1024);
    console.info({ event: 'logo_worst_case_bytes', input: input.length, main: main.body.length, thumb: thumb.body.length });
  });
});
