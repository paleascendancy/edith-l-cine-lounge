import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/owner.js', import.meta.url);
let src = await readFile(path, 'utf-8');

if (src.includes('OWNER_PRIVATE_LID_FIX_V1')) {
  console.log('[DONO] Private-chat LID owner fix already applied.');
  process.exit(0);
}

const before = `export async function isBotOwner(sock, msg) {
  if (msg?.key?.fromMe) return true;

  const numbers = await senderNumbers(sock, msg);
  const botNumber = normalizeOwnerNumber(sock?.user?.id);

  if (botNumber && numbers.has(botNumber)) return true;

  for (const number of numbers) {
    if (ownerNumbers.has(number)) return true;
  }

  return false;
}`;

const after = `const OWNER_PRIVATE_LID_FIX_V1 = true;

async function ownerLidMatches(sock, msg) {
  const candidates = [
    msg?.key?.participant,
    msg?.key?.participantAlt,
    msg?.key?.remoteJid,
    msg?.key?.senderLid,
    msg?.key?.participantLid
  ].filter((value) => String(value || '').endsWith('@lid'));

  if (!candidates.length) return false;

  for (const ownerNumber of ownerNumbers) {
    const pn = ownerNumber + '@s.whatsapp.net';
    try {
      const lid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(pn);
      if (lid && candidates.includes(String(lid))) return true;
    } catch {}
  }

  return false;
}

export async function isBotOwner(sock, msg) {
  if (msg?.key?.fromMe) return true;

  const numbers = await senderNumbers(sock, msg);
  const botNumber = normalizeOwnerNumber(sock?.user?.id);

  if (botNumber && numbers.has(botNumber)) return true;

  for (const number of numbers) {
    if (ownerNumbers.has(number)) return true;
  }

  // Em conversas privadas recentes o WhatsApp pode entregar apenas o LID.
  // Quando o LID -> telefone ainda não estiver disponível, fazemos o caminho
  // inverso dos números donos cadastrados e comparamos o LID diretamente.
  if (await ownerLidMatches(sock, msg)) return true;

  return false;
}`;

if (!src.includes(before)) {
  console.error('[DONO] Could not locate isBotOwner for private LID fix.');
  process.exit(1);
}

src = src.replace(before, after);
await writeFile(path, src, 'utf-8');
console.log('[DONO] Private-chat LID owner recognition applied.');
