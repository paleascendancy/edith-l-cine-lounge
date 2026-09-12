import fs from 'node:fs';

const path = 'src/index.js';
let source = fs.readFileSync(path, 'utf8');
let changed = false;

const expandedImport = "import { menuText, adminMenuText, generalMenuText, mediaMenuText, cinemaMenuText } from './commands/menu.js';";
const baseImport = "import { menuText, adminMenuText } from './commands/menu.js';";

if (source.includes(expandedImport)) {
  source = source.replace(expandedImport, baseImport);
  changed = true;
}

const submenuBlock = `

        case 'geral':
          await send(sock, jid, generalMenuText(), msg);
          break;

        case 'midia':
        case 'mídia':
          await send(sock, jid, mediaMenuText(), msg);
          break;

        case 'cinema':
        case 'cine':
          await send(sock, jid, cinemaMenuText(), msg);
          break;`;

if (source.includes(submenuBlock)) {
  source = source.replace(submenuBlock, '');
  changed = true;
}

if (changed) {
  fs.writeFileSync(path, source, 'utf8');
  console.log('[MENU] Menu clássico restaurado; submenus geral/mídia/cinema removidos.');
} else {
  console.log('[MENU] Menu clássico já está aplicado.');
}
