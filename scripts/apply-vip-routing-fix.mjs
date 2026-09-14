import { readFile, writeFile } from 'node:fs/promises';

const runtimePath = new URL('../src/v2/runtime.ts', import.meta.url);
const vipPath = new URL('../src/vip.js', import.meta.url);

async function patchRuntime() {
  let source = await readFile(runtimePath, 'utf8');

  const before = `async function handleModeration(ctx: V2Context, command: string, args: string, userId: string, isAdmin: boolean): Promise<boolean> {\n  if (!requireGroup(ctx)) return false;\n  if (!(ctx.isOwner || isAdmin)) { await send(ctx.sock, ctx.jid, ctx.msg, permissionDenied(ctx.prefix)); return true; }`;

  const after = `async function handleModeration(ctx: V2Context, command: string, args: string, userId: string, isAdmin: boolean): Promise<boolean> {\n  const moderationCommands = new Set(['inativos', 'isentar', 'limpargrupo', 'enqueteadm']);\n  if (!moderationCommands.has(command)) return false;\n  if (!requireGroup(ctx)) return false;\n  if (!(ctx.isOwner || isAdmin)) { await send(ctx.sock, ctx.jid, ctx.msg, permissionDenied(ctx.prefix)); return true; }`;

  if (source.includes(after)) return;
  if (!source.includes(before)) {
    throw new Error('Trecho de handleModeration não encontrado; patch abortado para evitar alteração incorreta.');
  }

  source = source.replace(before, after);
  await writeFile(runtimePath, source, 'utf8');
  console.log('[PATCH] Roteamento V2 corrigido: comandos comuns não caem mais na checagem de admin.');
}

async function patchVip() {
  let source = await readFile(vipPath, 'utf8');

  const before = `  const target = contextTarget(msg);\n  if (!target) return '';\n  if (!String(target).endsWith('@lid')) return normalizePhone(String(target).split('@')[0].split(':')[0]);\n  try {\n    const mapped = await sock.signalRepository?.lidMapping?.getPNForLID?.(target);\n    return normalizePhone(String(mapped || '').split('@')[0].split(':')[0]);\n  } catch {\n    return '';\n  }`;

  const after = `  const target = contextTarget(msg);\n  if (!target) return '';\n\n  const targetValue = String(target);\n  if (!targetValue.endsWith('@lid')) {\n    return normalizePhone(targetValue.split('@')[0].split(':')[0]);\n  }\n\n  // Menções em grupos podem chegar como LID. Antes de confiar no mapa global\n  // do Baileys, resolvemos o participante dentro do próprio grupo, onde\n  // normalmente existe o phoneNumber real (+55...). Isso evita gravar o LID\n  // numérico como se fosse o telefone do VIP.\n  try {\n    const groupJid = String(msg?.key?.remoteJid || '');\n    if (groupJid.endsWith('@g.us')) {\n      const metadata = await sock.groupMetadata(groupJid);\n      const participant = metadata?.participants?.find((entry) => {\n        const ids = [entry?.lid, entry?.id].filter(Boolean).map(String);\n        return ids.includes(targetValue);\n      });\n\n      const phoneNumber = normalizePhone(\n        String(participant?.phoneNumber || participant?.pn || '')\n          .split('@')[0]\n          .split(':')[0]\n      );\n      if (phoneNumber) return phoneNumber;\n\n      const participantId = String(participant?.id || '');\n      if (participantId && !participantId.endsWith('@lid')) {\n        const idPhone = normalizePhone(participantId.split('@')[0].split(':')[0]);\n        if (idPhone) return idPhone;\n      }\n    }\n  } catch {}\n\n  try {\n    const mapped = await sock.signalRepository?.lidMapping?.getPNForLID?.(targetValue);\n    return normalizePhone(String(mapped || '').split('@')[0].split(':')[0]);\n  } catch {\n    return '';\n  }`;

  if (source.includes(after)) return;
  if (!source.includes(before)) {
    throw new Error('Trecho de resolveTargetPhone não encontrado; patch abortado para evitar alteração incorreta.');
  }

  source = source.replace(before, after);
  await writeFile(vipPath, source, 'utf8');
  console.log('[PATCH] VIP corrigido: menções @lid são resolvidas pelo telefone real do participante.');
}

await patchRuntime();
await patchVip();
