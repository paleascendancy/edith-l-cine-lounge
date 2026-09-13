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
      '📵 *Chamadas não são permitidas.*\\n\\nO 𝑹𝒊𝒎𝒖𝒓𝒖-𝒃𝒐𝒕 não atende chamadas. O bot tentará bloquear este contato automaticamente.'
  ).trim();
  const pendingAntiCallLids = new Map();
  const ANTI_CALL_PENDING_TTL = 30 * 60 * 1000;

  async function resolveAntiCallBlockJid(rawJid) {
    const jid = String(rawJid || '').trim();
    if (!jid) return '';

    if (!jid.includes('@lid')) return jid;

    try {
      const getPNForLID = sock?.signalRepository?.lidMapping?.getPNForLID;
      if (typeof getPNForLID === 'function') {
        const pn = await getPNForLID.call(sock.signalRepository.lidMapping, jid);
        if (pn) return String(pn);
      }
    } catch (error) {
      console.error('[ANTICALL] Falha ao resolver LID para PN:', error?.message || error);
    }

    return '';
  }

  async function tryBlockAntiCallContact(rawJid) {
    const sourceJid = String(rawJid || '').trim();
    if (!sourceJid) return false;

    const blockJid = await resolveAntiCallBlockJid(sourceJid);
    if (!blockJid) {
      if (sourceJid.includes('@lid')) {
        pendingAntiCallLids.set(sourceJid, Date.now() + ANTI_CALL_PENDING_TTL);
        console.log('[ANTICALL] LID ainda sem PN; bloqueio aguardando mapeamento.');
      }
      return false;
    }

    await sock.updateBlockStatus(blockJid, 'block');
    pendingAntiCallLids.delete(sourceJid);
    console.log('[ANTICALL] Chamada privada detectada; contato bloqueado.');
    return true;
  }

  sock.ev.on('lid-mapping.update', async (update = {}) => {
    if (!antiCallEnabled) return;

    const now = Date.now();
    for (const [lid, expiresAt] of pendingAntiCallLids.entries()) {
      if (expiresAt <= now) pendingAntiCallLids.delete(lid);
    }

    const lid = String(update?.lid || update?.jid || '').trim();
    const pn = String(update?.pn || update?.phoneNumber || '').trim();
    if (!lid || !pn || !pendingAntiCallLids.has(lid)) return;

    try {
      await sock.updateBlockStatus(pn, 'block');
      pendingAntiCallLids.delete(lid);
      console.log('[ANTICALL] Contato bloqueado após resolução LID → PN.');
    } catch (error) {
      console.error('[ANTICALL] Falha ao bloquear após mapeamento:', error?.message || error);
    }
  });

  sock.ev.on('call', async (calls = []) => {
    if (!antiCallEnabled) return;

    const callList = Array.isArray(calls) ? calls : [calls];

    for (const call of callList) {
      if (call?.status !== 'offer') continue;
      if (call?.isGroup === true) continue;

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
        await tryBlockAntiCallContact(callerJid);
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
