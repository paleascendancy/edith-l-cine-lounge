import { readFile } from 'node:fs/promises';

const bannerPath = new URL('../assets/file_000000008a38820e8f6348eb61a08540.png', import.meta.url);
let bannerCache = null;

async function bannerBuffer() {
  if (bannerCache) return bannerCache;

  try {
    const image = await readFile(bannerPath);

    if (image.length > 1000) {
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

  // Não adiciona linhas vazias artificiais. O WhatsApp recolhe menus longos
  // automaticamente e exibe "Ler mais" quando necessário.
  return body;
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
