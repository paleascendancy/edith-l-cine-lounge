import { readFile } from 'node:fs/promises';

const bannerPath = new URL('../assets/rimuru-menu-banner-v2.b64', import.meta.url);
let bannerCache = null;

async function bannerBuffer() {
  if (bannerCache) return bannerCache;

  try {
    const encoded = (await readFile(bannerPath, 'utf-8')).replace(/\s+/g, '');
    const image = Buffer.from(encoded, 'base64');

    if (
      image.length > 1000 &&
      image[0] === 0xff &&
      image[1] === 0xd8 &&
      image[2] === 0xff &&
      image[image.length - 2] === 0xff &&
      image[image.length - 1] === 0xd9
    ) {
      bannerCache = image;
      console.log(`[RIMURU] Banner carregado: ${image.length} bytes.`);
      return bannerCache;
    }

    console.error(`[RIMURU] Banner inválido: ${image.length} bytes.`);
  } catch (error) {
    console.error('[RIMURU] Falha ao carregar banner:', error?.message || error);
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
        mimetype: 'image/jpeg',
        caption: expandableCaption(text)
      },
      { quoted: msg }
    );
    return true;
  }

  await sock.sendMessage(jid, { text: String(text || '') }, { quoted: msg });
  return false;
}
