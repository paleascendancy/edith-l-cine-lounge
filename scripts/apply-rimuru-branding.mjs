import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const BRAND = '𝑹𝒊𝒎𝒖𝒓𝒖-𝒃𝒐𝒕';
const indexPath = new URL('../src/index.js', import.meta.url);
const ownerPath = new URL('../src/owner.js', import.meta.url);
const vipPath = new URL('../src/vip.js', import.meta.url);
const nagatoroPath = new URL('../src/services/nagatoro.js', import.meta.url);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

for (const file of await walk(new URL('../src', import.meta.url).pathname)) {
  let source = await readFile(file, 'utf-8');
  const before = source;
  source = source
    .replaceAll('EDITH l', BRAND)
    .replaceAll('Edith l', BRAND)
    .replaceAll('EDITH VIP', `${BRAND} VIP`)
    .replaceAll('Edith.Bot', BRAND)
    .replaceAll('Versão Edith', `Versão ${BRAND}`)
    .replaceAll('A Edith', `O ${BRAND}`)
    .replaceAll('a Edith', `o ${BRAND}`)
    .replaceAll('da Edith', `do ${BRAND}`)
    .replaceAll('pela Edith', `pelo ${BRAND}`)
    .replaceAll('Edith está online', `${BRAND} está online`);
  if (source !== before) await writeFile(file, source, 'utf-8');
}

const captionHelper = `function rimuruExpandableCaption(text) {\n  const body = String(text || '');\n  const padSize = Math.max(0, 1500 - body.length);\n  return body + '\\n' + '\\u200B'.repeat(padSize);\n}\n\nfunction rimuruMenuBanner() {\n  const encoded = String(process.env.MENU_BANNER_B64 || '').trim();\n  if (!encoded) return null;\n  try {\n    const buffer = Buffer.from(encoded, 'base64');\n    return buffer.length ? buffer : null;\n  } catch {\n    return null;\n  }\n}`;

let src = await readFile(indexPath, 'utf-8');
if (!src.includes('RIMURU_BRANDING_V2')) {
  const sendAnchor = `async function send(sock, jid, text, msg) {\n  await sock.sendMessage(jid, { text }, { quoted: msg });\n}`;
  const helper = `${sendAnchor}\n\nconst RIMURU_BRANDING_V2 = true;\n${captionHelper}\n\nasync function sendRimuruCard(sock, jid, text, msg) {\n  try {\n    const image = rimuruMenuBanner();\n    if (image) {\n      await sock.sendMessage(\n        jid,\n        { image, caption: rimuruExpandableCaption(text) },\n        { quoted: msg }\n      );\n      return;\n    }\n  } catch (error) {\n    console.error('[RIMURU] Falha ao enviar painel visual:', error?.message || error);\n  }\n  await send(sock, jid, text, msg);\n}`;

  if (!src.includes(sendAnchor)) {
    console.error('[RIMURU] Não encontrei a função send para aplicar o tema.');
    process.exit(1);
  }

  src = src.replace(sendAnchor, helper);

  src = src.replace(
    /await send\(sock, jid, ([A-Za-z][A-Za-z0-9]*MenuText\([^;]*\)), msg\);/g,
    'await sendRimuruCard(sock, jid, $1, msg);'
  );

  src = src.replace(
    /(case 'ping': \{[\s\S]*?)(await send\()(sock,\s*jid,)/u,
    '$1await sendRimuruCard($3'
  );

  src = src.replace(
    /(async function sendStatus\([\s\S]*?)(await send\()(sock,\s*jid,)/u,
    '$1await sendRimuruCard($3'
  );

  const openAnchor = `    if (connection === 'open') {\n      pairingCodeRequested = false;`;
  const openPatch = `    if (connection === 'open') {\n      pairingCodeRequested = false;\n      Promise.resolve(sock.updateProfileName?.(config.botName)).catch((error) =>\n        console.error('[RIMURU] Não consegui atualizar o nome do perfil:', error?.message || error)\n      );`;
  if (src.includes(openAnchor)) src = src.replace(openAnchor, openPatch);

  await writeFile(indexPath, src, 'utf-8');
}

let owner = await readFile(ownerPath, 'utf-8');
if (!owner.includes('RIMURU_OWNER_MENU_BANNER_V2')) {
  const before = `  if (commandName === 'dono') {\n    await send(sock, jid, ownerMenu(sock), msg);\n    return true;\n  }`;
  const after = `  if (commandName === 'dono') {\n    const RIMURU_OWNER_MENU_BANNER_V2 = true;\n    try {\n      const encoded = String(process.env.MENU_BANNER_B64 || '').trim();\n      if (encoded) {\n        const image = Buffer.from(encoded, 'base64');\n        const body = ownerMenu(sock);\n        const caption = body + '\\n' + '\\u200B'.repeat(Math.max(0, 1500 - body.length));\n        await sock.sendMessage(jid, { image, caption }, { quoted: msg });\n        return true;\n      }\n    } catch {}\n    await send(sock, jid, ownerMenu(sock), msg);\n    return true;\n  }`;
  if (owner.includes(before)) {
    owner = owner.replace(before, after);
    await writeFile(ownerPath, owner, 'utf-8');
  }
}

let vip = await readFile(vipPath, 'utf-8');
if (!vip.includes('RIMURU_VIP_MENU_BANNER_V2')) {
  const sendFn = `async function send(sock, jid, msg, text) {\n  await sock.sendMessage(jid, { text }, { quoted: msg });\n}`;
  const sendFnPatched = `${sendFn}\n\nconst RIMURU_VIP_MENU_BANNER_V2 = true;\nasync function sendVipPanel(sock, jid, msg, text) {\n  try {\n    const encoded = String(process.env.MENU_BANNER_B64 || '').trim();\n    if (encoded) {\n      const image = Buffer.from(encoded, 'base64');\n      const body = String(text || '');\n      const caption = body + '\\n' + '\\u200B'.repeat(Math.max(0, 1500 - body.length));\n      await sock.sendMessage(jid, { image, caption }, { quoted: msg });\n      return;\n    }\n  } catch {}\n  await send(sock, jid, msg, text);\n}`;
  if (vip.includes(sendFn)) vip = vip.replace(sendFn, sendFnPatched);
  vip = vip.replace('    await send(sock, jid, msg, planText(entry));', '    await sendVipPanel(sock, jid, msg, planText(entry));');
  await writeFile(vipPath, vip, 'utf-8');
}

let nagatoro = await readFile(nagatoroPath, 'utf-8');
if (!nagatoro.includes('RIMURU_API_MENU_BANNER_V2')) {
  const sendTextFn = `async function sendText(sock, jid, msg, text) {\n  await sock.sendMessage(jid, { text: trimText(text) }, { quoted: msg });\n}`;
  const sendTextPatched = `${sendTextFn}\n\nconst RIMURU_API_MENU_BANNER_V2 = true;\nasync function sendApiPanel(sock, jid, msg, text) {\n  try {\n    const encoded = String(process.env.MENU_BANNER_B64 || '').trim();\n    if (encoded) {\n      const image = Buffer.from(encoded, 'base64');\n      const body = String(text || '');\n      const caption = body + '\\n' + '\\u200B'.repeat(Math.max(0, 1500 - body.length));\n      await sock.sendMessage(jid, { image, caption }, { quoted: msg });\n      return;\n    }\n  } catch {}\n  await sendText(sock, jid, msg, text);\n}`;
  if (nagatoro.includes(sendTextFn)) nagatoro = nagatoro.replace(sendTextFn, sendTextPatched);
  nagatoro = nagatoro.replace('    await sendText(sock, jid, msg, API_MENU);', '    await sendApiPanel(sock, jid, msg, API_MENU);');
  await writeFile(nagatoroPath, nagatoro, 'utf-8');
}

console.log('[RIMURU] Banner fixo e painéis com Ler mais aplicados.');
