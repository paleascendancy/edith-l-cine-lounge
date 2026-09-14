import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
let src = await readFile(indexPath, 'utf8');

const marker = 'PROFILE_LOCK_V2';

// Remove qualquer atualização automática antiga injetada pelo branding.
src = src.replace(
  /\n\s*Promise\.resolve\(sock\.updateProfileName\?\.\(config\.botName\)\)\.catch\(\(error\) =>\n\s*console\.error\('\[RIMURU\] Não consegui atualizar o nome do perfil:', error\?\.message \|\| error\)\n\s*\);/u,
  ''
);

if (!src.includes(marker)) {
  if (src.includes('import makeWASocket, {')) {
    src = src.replace('import makeWASocket, {', 'import makeWASocketBase, {');
  }

  if (!src.includes('import makeWASocketBase, {')) {
    console.warn('[PROFILE LOCK] Import do Baileys não reconhecido; mantendo apenas remoção das mutações automáticas conhecidas.');
  } else {
    const loggerAnchor = "const logger = pino({ level: 'silent' });";
    if (src.includes(loggerAnchor)) {
      const wrapper = `// ${marker}\nfunction makeWASocket(options) {\n  const sock = makeWASocketBase(options);\n  const ignoreProfileMutation = async () => undefined;\n\n  try {\n    if (typeof sock.updateProfileName === 'function') sock.updateProfileName = ignoreProfileMutation;\n    if (typeof sock.updateProfilePicture === 'function') sock.updateProfilePicture = ignoreProfileMutation;\n    if (typeof sock.removeProfilePicture === 'function') sock.removeProfilePicture = ignoreProfileMutation;\n  } catch (error) {\n    console.error('[PROFILE LOCK] Falha ao instalar proteção:', error?.message || error);\n  }\n\n  return sock;\n}\n\n${loggerAnchor}`;
      src = src.replace(loggerAnchor, wrapper);
    } else {
      console.warn('[PROFILE LOCK] Logger anchor não encontrado; mantendo apenas remoção das mutações automáticas conhecidas.');
    }
  }
}

await writeFile(indexPath, src, 'utf8');
console.log('[PROFILE LOCK] Nome e foto preservados; alterações automáticas do bot foram bloqueadas.');
