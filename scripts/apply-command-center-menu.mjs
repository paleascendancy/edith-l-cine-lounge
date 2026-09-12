import fs from 'node:fs';

const path = 'src/index.js';
let source = fs.readFileSync(path, 'utf8');
let changed = false;

const oldImport = "import { menuText, adminMenuText } from './commands/menu.js';";
const newImport = "import { menuText, adminMenuText, generalMenuText, mediaMenuText, cinemaMenuText } from './commands/menu.js';";

if (source.includes(oldImport)) {
  source = source.replace(oldImport, newImport);
  changed = true;
}

if (!source.includes("case 'geral':")) {
  const marker = `        case 'menu':\n        case 'ajuda':\n          await send(sock, jid, menuText(), msg);\n          break;`;

  const replacement = `${marker}\n\n        case 'geral':\n          await send(sock, jid, generalMenuText(), msg);\n          break;\n\n        case 'midia':\n        case 'mídia':\n          await send(sock, jid, mediaMenuText(), msg);\n          break;\n\n        case 'cinema':\n        case 'cine':\n          await send(sock, jid, cinemaMenuText(), msg);\n          break;`;

  if (!source.includes(marker)) {
    throw new Error('Bloco do !menu não encontrado em src/index.js');
  }

  source = source.replace(marker, replacement);
  changed = true;
}

if (changed) {
  fs.writeFileSync(path, source, 'utf8');
  console.log('[COMMAND-CENTER] Menu principal e submenus integrados.');
} else {
  console.log('[COMMAND-CENTER] Integração já aplicada.');
}
