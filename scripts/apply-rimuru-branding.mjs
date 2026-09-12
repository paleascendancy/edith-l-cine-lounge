import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const BRAND = '𝑹𝒊𝒎𝒖𝒓𝒖-𝒃𝒐𝒕';
const indexPath = new URL('../src/index.js', import.meta.url);
const ownerPath = new URL('../src/owner.js', import.meta.url);
const vipPath = new URL('../src/vip.js', import.meta.url);

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

// Renomeia textos antigos sem alterar nomes de comandos em minúsculas como !edith.
for (const file of await walk(new URL('../src', import.meta.url).pathname)) {
  let source = await readFile(file, 'utf-8');
  const before = source;
  source = source
    .replaceAll('EDITH l', BRAND)
    .replaceAll('Edith l', BRAND)
    .replaceAll('EDITH VIP', `${BRAND} VIP`)
    .replaceAll('Edith.Bot', BRAND)
    .replaceAll('Edith', BRAND);
  if (source !== before) await writeFile(file, source, 'utf-8');
}

let src = await readFile(indexPath, 'utf-8');

if (!src.includes('RIMURU_BRANDING_V1')) {
  const sendAnchor = `async function send(sock, jid, text, msg) {\n  await sock.sendMessage(jid, { text }, { quoted: msg });\n}`;
  const helper = `async function send(sock, jid, text, msg) {\n  await sock.sendMessage(jid, { text }, { quoted: msg });\n}\n\nconst RIMURU_BRANDING_V1 = true;\nlet rimuruBackgroundCache = null;\nlet rimuruBackgroundCachedAt = 0;\n\nasync function rimuruBackground(sock) {\n  const now = Date.now();\n  if (rimuruBackgroundCache && now - rimuruBackgroundCachedAt < 30 * 60 * 1000) {\n    return rimuruBackgroundCache;\n  }\n\n  let base = null;\n  try {\n    const profileUrl = await sock.profilePictureUrl(sock.user?.id, 'image');\n    if (profileUrl) {\n      const response = await fetch(profileUrl);\n      if (response.ok) base = Buffer.from(await response.arrayBuffer());\n    }\n  } catch {}\n\n  const overlay = Buffer.from(\n    \`<svg width="1200" height="675" xmlns="http://www.w3.org/2000/svg">\n      <defs>\n        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">\n          <stop offset="0" stop-color="#050a12" stop-opacity="0.35"/>\n          <stop offset="1" stop-color="#12263d" stop-opacity="0.75"/>\n        </linearGradient>\n      </defs>\n      <rect width="1200" height="675" fill="url(#g)"/>\n      <rect x="50" y="50" width="1100" height="575" rx="44" fill="#071019" fill-opacity="0.35" stroke="#d9f6ff" stroke-opacity="0.18" stroke-width="2"/>\n      <text x="600" y="570" text-anchor="middle" fill="white" font-size="50" font-family="sans-serif" font-weight="700">RIMURU-BOT</text>\n      <text x="600" y="615" text-anchor="middle" fill="#d6f4ff" font-size="24" font-family="sans-serif">CINE LOUNGE CLUB</text>\n    </svg>\`
  );\n\n  try {\n    const image = base\n      ? sharp(base).resize(1200, 675, { fit: 'cover' }).blur(1.3).modulate({ brightness: 0.58, saturation: 1.05 })\n      : sharp({ create: { width: 1200, height: 675, channels: 4, background: '#102235' } });\n\n    rimuruBackgroundCache = await image\n      .composite([{ input: overlay, top: 0, left: 0 }])\n      .jpeg({ quality: 84 })\n      .toBuffer();\n    rimuruBackgroundCachedAt = now;\n    return rimuruBackgroundCache;\n  } catch {\n    return null;\n  }\n}\n\nasync function sendRimuruCard(sock, jid, text, msg) {\n  try {\n    const image = await rimuruBackground(sock);\n    if (image) {\n      await sock.sendMessage(jid, { image, caption: text }, { quoted: msg });\n      return;\n    }\n  } catch (error) {\n    console.error('[RIMURU] Falha ao criar card visual:', error?.message || error);\n  }\n  await send(sock, jid, text, msg);\n}`;

  if (!src.includes(sendAnchor)) {
    console.error('[RIMURU] Não encontrei a função send para aplicar o tema.');
    process.exit(1);
  }
  src = src.replace(sendAnchor, helper);

  // Todos os painéis *MenuText passam a ser enviados com a foto/tema visual.
  src = src.replace(
    /await send\(sock, jid, ([A-Za-z][A-Za-z0-9]*MenuText\([^;]*\)), msg\);/g,
    'await sendRimuruCard(sock, jid, $1, msg);'
  );

  // !ping com card visual.
  src = src.replace(
    /(case 'ping': \{[\s\S]*?)(await send\()(sock,\s*jid,)/u,
    '$1await sendRimuruCard($3'
  );

  // !status com card visual.
  src = src.replace(
    /(async function sendStatus\([\s\S]*?)(await send\()(sock,\s*jid,)/u,
    '$1await sendRimuruCard($3'
  );

  // Atualiza também o nome público do perfil do WhatsApp quando a conexão abre.
  const openAnchor = `    if (connection === 'open') {\n      pairingCodeRequested = false;`;
  const openPatch = `    if (connection === 'open') {\n      pairingCodeRequested = false;\n      Promise.resolve(sock.updateProfileName?.(config.botName)).catch((error) =>\n        console.error('[RIMURU] Não consegui atualizar o nome do perfil:', error?.message || error)\n      );`;
  if (src.includes(openAnchor)) src = src.replace(openAnchor, openPatch);

  await writeFile(indexPath, src, 'utf-8');
}

// !dono recebe foto do perfil do bot junto do painel.
let owner = await readFile(ownerPath, 'utf-8');
if (!owner.includes('RIMURU_OWNER_MENU_PHOTO_V1')) {
  const before = `  if (commandName === 'dono') {\n    await send(sock, jid, ownerMenu(sock), msg);\n    return true;\n  }`;
  const after = `  if (commandName === 'dono') {\n    const RIMURU_OWNER_MENU_PHOTO_V1 = true;\n    try {\n      const profileUrl = await sock.profilePictureUrl(sock.user?.id, 'image');\n      if (profileUrl) {\n        await sock.sendMessage(jid, { image: { url: profileUrl }, caption: ownerMenu(sock) }, { quoted: msg });\n        return true;\n      }\n    } catch {}\n    await send(sock, jid, ownerMenu(sock), msg);\n    return true;\n  }`;
  if (owner.includes(before)) {
    owner = owner.replace(before, after);
    await writeFile(ownerPath, owner, 'utf-8');
  }
}

// !vip / !planovip recebem foto do perfil junto do painel do plano.
let vip = await readFile(vipPath, 'utf-8');
if (!vip.includes('RIMURU_VIP_MENU_PHOTO_V1')) {
  const sendFn = `async function send(sock, jid, msg, text) {\n  await sock.sendMessage(jid, { text }, { quoted: msg });\n}`;
  const sendFnPatched = `async function send(sock, jid, msg, text) {\n  await sock.sendMessage(jid, { text }, { quoted: msg });\n}\n\nconst RIMURU_VIP_MENU_PHOTO_V1 = true;\nasync function sendVipPanel(sock, jid, msg, text) {\n  try {\n    const profileUrl = await sock.profilePictureUrl(sock.user?.id, 'image');\n    if (profileUrl) {\n      await sock.sendMessage(jid, { image: { url: profileUrl }, caption: text }, { quoted: msg });\n      return;\n    }\n  } catch {}\n  await send(sock, jid, msg, text);\n}`;
  if (vip.includes(sendFn)) vip = vip.replace(sendFn, sendFnPatched);
  vip = vip.replace('    await send(sock, jid, msg, planText(entry));', '    await sendVipPanel(sock, jid, msg, planText(entry));');
  await writeFile(vipPath, vip, 'utf-8');
}

console.log('[RIMURU] Nome, perfil e cards visuais aplicados.');
