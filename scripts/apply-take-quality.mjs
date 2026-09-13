import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
let src = await readFile(indexPath, 'utf8');

if (src.includes('TAKE_QUALITY_V2')) {
  console.log('[TAKE QUALITY] Melhoria de qualidade e marca thzNode já aplicada.');
  process.exit(0);
}

const applyMarkPattern = /async function applyStickerMark\(stickerBuffer, mark\) \{[\s\S]*?\n\}\n\nasync function handleTake/;
const handleTakePattern = /async function handleTake\(sock, jid, msg\) \{[\s\S]*?\n\}\n\nasync function loadGroupSettings/;

if (!applyMarkPattern.test(src)) {
  throw new Error('[TAKE QUALITY] Função applyStickerMark não encontrada.');
}

if (!handleTakePattern.test(src)) {
  throw new Error('[TAKE QUALITY] Função handleTake não encontrada.');
}

const improvedStickerCode = `const TAKE_QUALITY_V2 = true;
const TAKE_PACK_NAME = 'thzNode';
const TAKE_PUBLISHER = 'Rimuru-Bot';

async function enhanceStaticSticker(stickerBuffer) {
  try {
    const metadata = await sharp(stickerBuffer, { animated: true }).metadata();
    const pages = Number(metadata?.pages || 1);

    // Figurinha animada: preservar os frames originais evita perda de animação/qualidade.
    if (pages > 1) {
      return stickerBuffer;
    }

    // WhatsApp exibe stickers em até 512x512. Reprocessamos a imagem estática
    // em resolução máxima, com Lanczos e nitidez leve, e WebP de altíssima qualidade.
    return await sharp(stickerBuffer)
      .resize({
        width: 512,
        height: 512,
        fit: 'contain',
        kernel: sharp.kernel.lanczos3,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .sharpen(0.8)
      .webp({
        quality: 100,
        alphaQuality: 100,
        nearLossless: true,
        smartSubsample: false,
        effort: 6
      })
      .toBuffer();
  } catch (error) {
    console.warn('[TAKE QUALITY] Não foi possível aprimorar pixels; usando original:', error?.message || error);
    return stickerBuffer;
  }
}

async function applyStickerMark(stickerBuffer) {
  const tempDir = await mkdtemp(join(tmpdir(), 'rimuru-take-'));
  const inputPath = join(tempDir, 'input.webp');
  const outputPath = join(tempDir, 'output.webp');

  try {
    const enhancedBuffer = await enhanceStaticSticker(stickerBuffer);
    await writeFile(inputPath, enhancedBuffer);

    // webpmux altera somente os metadados EXIF depois do tratamento,
    // evitando uma segunda recompressão da figurinha.
    const image = new webp.Image();
    await image.load(inputPath);
    image.exif = buildStickerExif(TAKE_PACK_NAME, TAKE_PUBLISHER);
    await image.save(outputPath);

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function handleTake`;

src = src.replace(applyMarkPattern, improvedStickerCode);

const newHandleTake = `async function handleTake(sock, jid, msg) {
  const stickerMessage = getStickerMessage(msg.message);

  if (!stickerMessage) {
    await send(
      sock,
      jid,
      '🏷️ Responda a uma figurinha escrevendo apenas *take*.',
      msg
    );
    return;
  }

  try {
    const stickerBuffer = await downloadMessageBuffer(stickerMessage, 'sticker');
    const markedSticker = await applyStickerMark(stickerBuffer);

    await sock.sendMessage(
      jid,
      { sticker: markedSticker },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no take:', error?.message || error);
    await send(
      sock,
      jid,
      '❌ Não consegui processar essa figurinha.',
      msg
    );
  }
}

async function loadGroupSettings`;

src = src.replace(handleTakePattern, newHandleTake);
await writeFile(indexPath, src, 'utf8');

console.log('[TAKE QUALITY] Marca fixa thzNode aplicada; números removidos; qualidade estática elevada para 512px/WebP 100.');
