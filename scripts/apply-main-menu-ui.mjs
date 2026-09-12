import { readFile, writeFile } from 'node:fs/promises';

const runtimePath = new URL('../src/v2/runtime.ts', import.meta.url);
let src = await readFile(runtimePath, 'utf8');

const importAnchor = "import { commandByName, visibleCommands, type CommandCategory } from './registry.js';";
if (!src.includes("from './main-menu.js'")) {
  if (!src.includes(importAnchor)) throw new Error('[MENU V2] import anchor not found');
  src = src.replace(importAnchor, `${importAnchor}\nimport { sendMainMenu, sendFilmSeriesMenu } from './main-menu.js';`);
} else {
  src = src.replace(
    /import \{[^\n]*sendMainMenu[^\n]*\} from '\.\/main-menu\.js';/u,
    "import { sendMainMenu, sendFilmSeriesMenu } from './main-menu.js';"
  );
}

const oldMenuBlock = `  if (parsed.command === 'menu' || parsed.command === 'ajuda') {\n    await send(ctx.sock, ctx.jid, ctx.msg, menuText(ctx.prefix, { isOwner: ctx.isOwner, isAdmin, isVip: ctx.isVip, isGroup }, parsed.args)); return true;\n  }`;
const newMenuBlock = `  if (parsed.command === 'menu' || parsed.command === 'ajuda') {\n    await sendMainMenu(ctx.sock, ctx.jid, ctx.msg, ctx.prefix);\n    return true;\n  }`;

if (src.includes(oldMenuBlock)) {
  src = src.replace(oldMenuBlock, newMenuBlock);
} else if (!src.includes('await sendMainMenu(ctx.sock, ctx.jid, ctx.msg, ctx.prefix);')) {
  throw new Error('[MENU V2] command block anchor not found');
}

if (!src.includes("parsed.command === 'filmes-series'")) {
  const anchor = `  if (!isGroup && !ctx.isOwner && !ctx.isVip && !['privacidade', 'meusdados', 'apagardados', 'notificacoes'].includes(def.name)) {`;
  if (!src.includes(anchor)) throw new Error('[MENU V2] private access anchor not found');
  const block = `  if (parsed.command === 'filmes-series' || parsed.command === 'filmeseries') {\n    await sendFilmSeriesMenu(ctx.sock, ctx.jid, ctx.msg, ctx.prefix);\n    return true;\n  }\n\n`;
  src = src.replace(anchor, block + anchor);
}

await writeFile(runtimePath, src, 'utf8');
console.log('[MENU V2] Menu principal e painel !filmes-series aplicados.');
