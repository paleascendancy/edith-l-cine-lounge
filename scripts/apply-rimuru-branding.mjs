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

let src = await readFile(indexPath, 'utf-8');
if (!src.includes("from './menu-panel.js'")) {
  src = src.replace(
    "import { menuText, adminMenuText } from './commands/menu.js';",
    "import { menuText, adminMenuText } from './commands/menu.js';\nimport { sendRimuruPanel } from './menu-panel.js';"
  );
}

// Menu principal e painel ADM precisam usar o mesmo banner.
src = src.replace(
  'await send(sock, jid, menuText(), msg);',
  'await sendRimuruPanel(sock, jid, msg, menuText());'
);
src = src.replace(
  'await send(sock, jid, adminMenuText(), msg);',
  'await sendRimuruPanel(sock, jid, msg, adminMenuText());'
);

src = src.replace(
  /(case 'ping': \{[\s\S]*?)(await send\()(sock,\s*jid,)/u,
  '$1await sendRimuruPanel($3msg, '
);

src = src.replace(
  /(async function sendStatus\([\s\S]*?)(await send\()(sock,\s*jid,)/u,
  '$1await sendRimuruPanel($3msg, '
);

const openAnchor = `    if (connection === 'open') {\n      pairingCodeRequested = false;`;
const openPatch = `    if (connection === 'open') {\n      pairingCodeRequested = false;\n      Promise.resolve(sock.updateProfileName?.(config.botName)).catch((error) =>\n        console.error('[RIMURU] Não consegui atualizar o nome do perfil:', error?.message || error)\n      );`;
if (src.includes(openAnchor) && !src.includes('updateProfileName?.(config.botName)')) {
  src = src.replace(openAnchor, openPatch);
}
await writeFile(indexPath, src, 'utf-8');

let owner = await readFile(ownerPath, 'utf-8');
if (!owner.includes("from './menu-panel.js'")) {
  owner = `import { sendRimuruPanel } from './menu-panel.js';\n${owner}`;
}
owner = owner.replace(
  `  if (commandName === 'dono') {\n    await send(sock, jid, ownerMenu(sock), msg);\n    return true;\n  }`,
  `  if (commandName === 'dono') {\n    await sendRimuruPanel(sock, jid, msg, ownerMenu(sock));\n    return true;\n  }`
);
await writeFile(ownerPath, owner, 'utf-8');

let vip = await readFile(vipPath, 'utf-8');
if (!vip.includes("from './menu-panel.js'")) {
  vip = `import { sendRimuruPanel } from './menu-panel.js';\n${vip}`;
}
vip = vip.replace(
  '    await send(sock, jid, msg, planText(entry));',
  '    await sendRimuruPanel(sock, jid, msg, planText(entry));'
);
await writeFile(vipPath, vip, 'utf-8');

let nagatoro = await readFile(nagatoroPath, 'utf-8');
if (!nagatoro.includes("from '../menu-panel.js'")) {
  nagatoro = `import { sendRimuruPanel } from '../menu-panel.js';\n${nagatoro}`;
}
nagatoro = nagatoro.replace(
  '    await sendText(sock, jid, msg, API_MENU);',
  '    await sendRimuruPanel(sock, jid, msg, API_MENU);'
);
await writeFile(nagatoroPath, nagatoro, 'utf-8');

console.log('[RIMURU] Banner aplicado em menu, adm, dono, vip, menuapi, ping e status.');
