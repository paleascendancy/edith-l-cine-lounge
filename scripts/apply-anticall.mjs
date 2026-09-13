import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
let src = await readFile(indexPath, 'utf8');

if (!src.includes('[ANTICALL] Proteção de chamadas instalada.')) {
  const anchor = "  sock.ev.on('creds.update', saveCreds);\n";

  if (!src.includes(anchor)) {
    throw new Error('[ANTICALL] Anchor de creds.update não encontrado.');
  }

  const block = `

  const antiCallEnabled = !['0', 'false', 'off', 'no'].includes(
    String(process.env.ANTICALL ?? 'true').trim().toLowerCase()
  );
  const antiCallMessage = String(
    process.env.ANTICALL_MESSAGE ||
      '📵 *Chamadas não são permitidas.*\\n\\nO 𝑹𝒊𝒎𝒖𝒓𝒖-𝒃𝒐𝒕 não atende chamadas. Este contato será bloqueado automaticamente.'
  ).trim();

  sock.ev.on('call', async (calls = []) => {
    if (!antiCallEnabled) return;

    const callList = Array.isArray(calls) ? calls : [calls];

    for (const call of callList) {
      if (call?.status !== 'offer') continue;

      const callerJid = String(call?.from || call?.chatId || '');
      if (!callerJid || callerJid.endsWith('@g.us')) continue;

      try {
        if (antiCallMessage) {
          await sock.sendMessage(callerJid, { text: antiCallMessage });
        }
      } catch (error) {
        console.error('[ANTICALL] Falha ao avisar quem ligou:', error?.message || error);
      }

      try {
        // Pequeno intervalo para o aviso sair antes do bloqueio.
        await new Promise((resolve) => setTimeout(resolve, 500));
        await sock.updateBlockStatus(callerJid, 'block');
        console.log('[ANTICALL] Chamada privada detectada; contato bloqueado.');
      } catch (error) {
        console.error('[ANTICALL] Falha ao bloquear quem ligou:', error?.message || error);
      }
    }
  });

  console.log('[ANTICALL] Proteção de chamadas instalada.');`;

  src = src.replace(anchor, `${anchor}${block}\n`);
  await writeFile(indexPath, src, 'utf8');
  console.log('[ANTICALL PATCH] Proteção anti-call aplicada ao Rimuru-Bot.');
} else {
  console.log('[ANTICALL PATCH] Proteção anti-call já estava aplicada.');
}
