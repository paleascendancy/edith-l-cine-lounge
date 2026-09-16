import { readFile } from 'node:fs/promises';

const bannerPath = new URL('../assets/file_000000008a38820e8f6348eb61a08540.png', import.meta.url);
let bannerCache = null;

const READ_MORE_TRIGGER = '\u200e'.repeat(4001);

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
  if (!body) return '';

  // Mantém só o cabeçalho visível e força o WhatsApp a oferecer "Ler mais".
  // O preenchimento usa caracteres invisíveis, sem poluir visualmente o painel.
  const [firstLine, ...rest] = body.split('\n');
  if (!rest.length) return body;

  return `${firstLine}\n${READ_MORE_TRIGGER}\n${rest.join('\n')}`;
}

export async function sendRimuruPanel(sock, jid, msg, text) {
  const panelText = expandableCaption(text);
  const image = await bannerBuffer();

  if (image) {
    await sock.sendMessage(
      jid,
      {
        image,
        mimetype: 'image/png',
        caption: panelText
      },
      { quoted: msg }
    );
    return true;
  }

  await sock.sendMessage(jid, { text: panelText }, { quoted: msg });
  return false;
}
