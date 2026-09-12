import { readFile } from 'node:fs/promises';

const bannerPath = new URL('../assets/file_000000008a38820e8f6348eb61a08540.png', import.meta.url);
let bannerCache = null;

async function bannerBuffer() {
  if (bannerCache) return bannerCache;

  try {
    const image = await readFile(bannerPath);

    const isPng =
      image.length > 1000 &&
      image[0] === 0x89 &&
      image[1] === 0x50 &&
      image[2] === 0x4e &&
      image[3] === 0x47;

    if (isPng) {
      bannerCache = image;
      console.log(`[RIMURU] Banner PNG carregado: ${image.length} bytes.`);
      return bannerCache;
    }

    console.error(`[RIMURU] Banner PNG inválido: ${image.length} bytes.`);
  } catch (error) {
    console.error('[RIMURU] Falha ao carregar banner PNG:', error?.message || error);
  }

  return null;
}

export function expandableCaption(text = '') {
  const body = String(text || '').trim();
  const filler = Array.from({ length: 40 }, () => '\u200B').join('\n');
  return `${body}\n${filler}`;
}

export async function sendRimuruPanel(sock, jid, msg, text) {
  const image = await bannerBuffer();

  if (image) {
    await sock.sendMessage(
      jid,
      {
        image,
        mimetype: 'image/png',
        caption: expandableCaption(text)
      },
      { quoted: msg }
    );
    return true;
  }

  await sock.sendMessage(jid, { text: String(text || '') }, { quoted: msg });
  return false;
}
