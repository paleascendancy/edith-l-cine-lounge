import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/vip.js', import.meta.url);
let src = await readFile(path, 'utf8');

if (!src.includes('grantVipDaysV2')) {
  src += `\n\nexport async function grantVipDaysV2(phoneInput, daysInput, operationKey = '') {\n  const phone = normalizePhone(phoneInput);\n  const days = Number(daysInput);\n  if (!phone || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new Error('VIP_INVALID_INPUT');\n  const existing = vips.get(phone);\n  const ops = String(existing?.note || '').startsWith('ops:')\n    ? String(existing.note).slice(4).split(',').filter(Boolean)\n    : [];\n  const opHash = String(operationKey || '').slice(-48);\n  if (opHash && ops.includes(opHash)) return existing;\n  const base = isActive(existing) ? existing.expiresAt : Date.now();\n  const entry = {\n    phone,\n    addedAt: existing?.addedAt || Date.now(),\n    expiresAt: base + days * 24 * 60 * 60 * 1000,\n    note: 'ops:' + [...ops, opHash].filter(Boolean).slice(-20).join(',')\n  };\n  vips.set(phone, entry);\n  await save();\n  return entry;\n}\n`;
  await writeFile(path, src, 'utf8');
  console.log('[V2] Ponte de concessão VIP aplicada.');
} else {
  console.log('[V2] Ponte VIP já aplicada.');
}
