import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
const diagnosticsPath = new URL('../src/command-diagnostics.js', import.meta.url);
let src = await readFile(indexPath, 'utf-8');

if (src.includes('VIP_ACCESS_V1')) {
  console.log('[VIP] VIP access patch already applied.');
  process.exit(0);
}

function replaceRequired(label, before, after) {
  if (!src.includes(before)) {
    console.error(`[VIP] Could not locate ${label}.`);
    process.exit(1);
  }
  src = src.replace(before, after);
}

replaceRequired(
  'diagnostics import',
  "import { explainKnownCommandIssue } from './command-diagnostics.js';",
  "import { explainKnownCommandIssue, isKnownCommandName } from './command-diagnostics.js';\nimport { initVipAccess, isVipUser, handleVipCommand } from './vip.js';\nconst VIP_ACCESS_V1 = true;"
);

replaceRequired(
  'VIP initialization',
  "    initOwnerControl(authDir),\n    initStreamingMonitor(authDir),",
  "    initOwnerControl(authDir),\n    initVipAccess(authDir),\n    initStreamingMonitor(authDir),"
);

replaceRequired(
  'owner/VIP message identity',
  `      const text = getText(msg.message);

      if (text && await handleOwnerCommand(sock, jid, msg, text)) {
        continue;
      }`,
  `      const text = getText(msg.message);
      const messageOwner = await isBotOwner(sock, msg);
      const messageVip = messageOwner ? false : await isVipUser(sock, msg);

      if (text && await handleOwnerCommand(sock, jid, msg, text)) {
        continue;
      }

      if (text && await handleVipCommand(sock, jid, msg, text, { isOwner: messageOwner })) {
        continue;
      }`
);

replaceRequired(
  'owner bypass in diagnostics',
  `      if (
        text &&
        await explainKnownCommandIssue(sock, jid, msg, text, {`,
  `      if (
        text &&
        !messageOwner &&
        await explainKnownCommandIssue(sock, jid, msg, text, {`
);

replaceRequired(
  'private VIP gate and owner group bypass',
  `        ) {
          await send(sock, jid, adminMenuText(), msg);
          continue;
        }
      }

      if (jid.endsWith('@g.us') && !isGroupAllowed(jid)) {
        continue;
      }`,
  `        ) {
          await send(sock, jid, adminMenuText(), msg);
          continue;
        }

        if (privatePrefix && !messageOwner && !messageVip) {
          const privateCommand = parseCommand(text).command;
          if (isKnownCommandName(privateCommand)) {
            await send(
              sock,
              jid,
              '💎 *ACESSO VIP NECESSÁRIO*\\n\\nMotivo: os comandos da Edith no PV são exclusivos para donos e VIPs ativos.\\nUse *' + config.prefix + 'vip* para ver o plano.',
              msg
            );
            continue;
          }
        }
      }

      if (jid.endsWith('@g.us') && !messageOwner && !isGroupAllowed(jid)) {
        continue;
      }`
);

replaceRequired(
  'owner bypass for group admin checks',
  "  if (!info.senderInfo?.admin) {\n    await send(sock, jid, '⛔ Apenas administradores podem usar esse comando.', msg);",
  "  if (!info.senderInfo?.admin && !(await isBotOwner(sock, msg))) {\n    await send(sock, jid, '⛔ Apenas administradores ou o dono da Edith podem usar esse comando.', msg);"
);

replaceRequired(
  'owner bypass for ban',
  "    if (!senderInfo?.admin) {\n      await send(sock, jid, '⛔ Apenas administradores do grupo podem usar *!ban*.', msg);",
  "    if (!senderInfo?.admin && !(await isBotOwner(sock, msg))) {\n      await send(sock, jid, '⛔ Apenas administradores do grupo ou o dono da Edith podem usar *!ban*.', msg);"
);

await writeFile(indexPath, src, 'utf-8');

let diagnostics = await readFile(diagnosticsPath, 'utf-8');
if (!diagnostics.includes("'addvip'")) {
  const before = "  'grupos', 'donos', 'botnumero', 'prefixo',";
  const after = "  'grupos', 'donos', 'botnumero', 'prefixo', 'vip', 'vipstatus', 'planovip',\n  'addvip', 'remvip', 'renovarvip', 'vips',";
  if (!diagnostics.includes(before)) {
    console.error('[VIP] Could not update known VIP commands.');
    process.exit(1);
  }
  diagnostics = diagnostics.replace(before, after);
  await writeFile(diagnosticsPath, diagnostics, 'utf-8');
}

console.log('[VIP] Owner bypass and persistent VIP private access applied.');
