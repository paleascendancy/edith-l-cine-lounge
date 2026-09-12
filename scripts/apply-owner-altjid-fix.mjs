import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/owner.js', import.meta.url);
let src = await readFile(path, 'utf-8');

if (src.includes('OWNER_ALT_JID_FIX_V1')) {
  console.log('[DONO] Alt-JID/PN owner recognition already applied.');
  process.exit(0);
}

const before = `async function senderNumbers(sock, msg) {
  const candidates = [
    msg?.key?.participantPn,
    msg?.key?.participantAlt,
    msg?.key?.participant,
    msg?.key?.remoteJid
  ].filter(Boolean);`;

const after = `const OWNER_ALT_JID_FIX_V1 = true;

async function senderNumbers(sock, msg) {
  const candidates = [
    msg?.key?.participantPn,
    msg?.key?.participantAlt,
    msg?.key?.participant,
    msg?.key?.remoteJidAlt,
    msg?.key?.remoteJid,
    msg?.key?.senderPn,
    msg?.key?.senderAlt,
    msg?.key?.senderJid,
    msg?.key?.authorPn,
    msg?.key?.author
  ].filter(Boolean);`;

if (!src.includes(before)) {
  console.error('[DONO] Could not locate senderNumbers for Alt-JID fix.');
  process.exit(1);
}

src = src.replace(before, after);
await writeFile(path, src, 'utf-8');
console.log('[DONO] Alt-JID/PN owner recognition applied.');
