import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
let src = await readFile(indexPath, 'utf8');

const marker = 'PROFILE_LOCK_V1';
if (!src.includes(marker)) {
  const anchor = `  const sock = makeWASocket({\n    auth: state,\n    logger\n  });`;

  if (!src.includes(anchor)) {
    throw new Error('[PROFILE LOCK] makeWASocket anchor not found');
  }

  const block = `${anchor}\n\n  // ${marker}\n  // O bot pode ler o perfil, mas não pode alterar automaticamente nome/foto.\n  const ignoreProfileMutation = async () => undefined;\n  try {\n    if (typeof sock.updateProfileName === 'function') sock.updateProfileName = ignoreProfileMutation;\n    if (typeof sock.updateProfilePicture === 'function') sock.updateProfilePicture = ignoreProfileMutation;\n    if (typeof sock.removeProfilePicture === 'function') sock.removeProfilePicture = ignoreProfileMutation;\n  } catch (error) {\n    console.error('[PROFILE LOCK] Falha ao instalar proteção:', error?.message || error);\n  }\n  console.log('[PROFILE LOCK] Nome e foto do perfil protegidos contra alterações automáticas do bot.');`;

  src = src.replace(anchor, block);
}

// Remove também qualquer atualização automática antiga que tenha sido injetada por branding.
src = src.replace(
  /\n\s*Promise\.resolve\(sock\.updateProfileName\?\.\(config\.botName\)\)\.catch\(\(error\) =>\n\s*console\.error\('\[RIMURU\] Não consegui atualizar o nome do perfil:', error\?\.message \|\| error\)\n\s*\);/u,
  ''
);

await writeFile(indexPath, src, 'utf8');
console.log('[PROFILE LOCK] Proteção de perfil aplicada ao runtime.');
