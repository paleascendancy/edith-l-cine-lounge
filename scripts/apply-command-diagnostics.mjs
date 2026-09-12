import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
const ownerPath = new URL('../src/owner.js', import.meta.url);
const directPath = new URL('../src/services/direct-sources.js', import.meta.url);
const nagatoroPath = new URL('../src/services/nagatoro.js', import.meta.url);
const tmdbPath = new URL('../src/services/tmdb.js', import.meta.url);

function replaceRequired(source, label, before, after) {
  if (!source.includes(before)) {
    console.error(`[DIAG] Could not locate ${label}.`);
    process.exit(1);
  }
  return source.replace(before, after);
}

// 1) Diagnóstico de prefixo errado e grupo não autorizado.
let indexSource = await readFile(indexPath, 'utf-8');

if (!indexSource.includes('COMMAND_DIAGNOSTICS_V1')) {
  const ownerImport = "import { initOwnerControl, isGroupAllowed, handleOwnerCommand, getCommandPrefix, isBotOwner } from './owner.js';";
  indexSource = replaceRequired(
    indexSource,
    'owner import for diagnostics',
    ownerImport,
    `${ownerImport}\nimport { explainKnownCommandIssue } from './command-diagnostics.js';\nconst COMMAND_DIAGNOSTICS_V1 = true;`
  );

  const ownerDispatch = `      if (text && await handleOwnerCommand(sock, jid, msg, text)) {
        continue;
      }

      if (!jid.endsWith('@g.us') && text) {`;

  const diagnosedDispatch = `      if (text && await handleOwnerCommand(sock, jid, msg, text)) {
        continue;
      }

      if (
        text &&
        await explainKnownCommandIssue(sock, jid, msg, text, {
          prefix: config.prefix,
          isGroupAllowed
        })
      ) {
        continue;
      }

      if (!jid.endsWith('@g.us') && text) {`;

  indexSource = replaceRequired(
    indexSource,
    'command diagnostic dispatch',
    ownerDispatch,
    diagnosedDispatch
  );

  await writeFile(indexPath, indexSource, 'utf-8');
}

// 2) Comandos exclusivos do dono deixam de falhar em silêncio.
let ownerSource = await readFile(ownerPath, 'utf-8');
const oldOwnerGate = `  if (!(await isBotOwner(sock, msg))) {
    return true;
  }`;
const newOwnerGate = `  if (!(await isBotOwner(sock, msg))) {
    await send(
      sock,
      jid,
      \`⛔ *COMANDO NÃO EXECUTADO*\\n\\nMotivo: *\${commandName}* é um comando exclusivo do dono da Edith.\`,
      msg
    );
    return true;
  }`;

if (ownerSource.includes(oldOwnerGate)) {
  ownerSource = ownerSource.replace(oldOwnerGate, newOwnerGate);
  await writeFile(ownerPath, ownerSource, 'utf-8');
}

// 3) Fontes oficiais passam a informar a causa técnica sem expor segredos.
let directSource = await readFile(directPath, 'utf-8');
if (!directSource.includes("commandFailureReason")) {
  directSource = `import { commandFailureReason } from '../command-diagnostics.js';\n\n${directSource}`;
  directSource = replaceRequired(
    directSource,
    'direct source generic error',
    "    await sendText(sock, jid, msg, '❌ Não consegui consultar essa fonte agora. Tente novamente em alguns instantes.');",
    "    const reason = commandFailureReason(error, 'a fonte externa');\n    await sendText(sock, jid, msg, `❌ *COMANDO NÃO EXECUTADO*\\n\\nMotivo: ${reason}.`);"
  );
  await writeFile(directPath, directSource, 'utf-8');
}

// 4) Nagatoro informa timeout, autenticação, limite ou indisponibilidade.
let nagatoroSource = await readFile(nagatoroPath, 'utf-8');
if (!nagatoroSource.includes("commandFailureReason")) {
  nagatoroSource = `import { commandFailureReason } from '../command-diagnostics.js';\n\n${nagatoroSource}`;
  nagatoroSource = replaceRequired(
    nagatoroSource,
    'Nagatoro generic error',
    "    await sendText(sock, jid, msg, '❌ Essa consulta não respondeu agora. Tente novamente em instantes.');",
    "    const reason = commandFailureReason(error, 'a API Nagatoro');\n    await sendText(sock, jid, msg, `❌ *COMANDO NÃO EXECUTADO*\\n\\nMotivo: ${reason}.`);"
  );
  await writeFile(nagatoroPath, nagatoroSource, 'utf-8');
}

// 5) TMDB também explica a causa quando a consulta falha.
let tmdbSource = await readFile(tmdbPath, 'utf-8');
if (!tmdbSource.includes("commandFailureReason")) {
  tmdbSource = `import { commandFailureReason } from '../command-diagnostics.js';\n\n${tmdbSource}`;
  tmdbSource = replaceRequired(
    tmdbSource,
    'TMDB generic error',
    "  console.error('[TMDB]', error?.message || error);\n  return '⚠️ Não consegui consultar o catálogo agora. Tente novamente em alguns instantes.';",
    "  console.error('[TMDB]', error?.message || error);\n  const reason = commandFailureReason(error, 'o TMDB');\n  return `⚠️ *COMANDO NÃO EXECUTADO*\\n\\nMotivo: ${reason}.`;"
  );
  await writeFile(tmdbPath, tmdbSource, 'utf-8');
}

console.log('[DIAG] Command failure diagnostics applied.');
