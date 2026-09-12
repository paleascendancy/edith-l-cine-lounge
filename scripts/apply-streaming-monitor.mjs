import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/index.js', import.meta.url);
let src = await readFile(path, 'utf-8');

if (src.includes('STREAMING_MONITOR_V1')) {
  console.log('[STREAMING] Streaming monitor patch already applied.');
  process.exit(0);
}

const original = src;

function replaceRequired(label, before, after) {
  if (!src.includes(before)) {
    console.error(`[STREAMING] Could not locate ${label}.`);
    process.exit(1);
  }

  src = src.replace(before, after);
}

replaceRequired(
  'owner import',
  "import { initOwnerControl, isGroupAllowed, handleOwnerCommand, getCommandPrefix } from './owner.js';",
  "import { initOwnerControl, isGroupAllowed, handleOwnerCommand, getCommandPrefix } from './owner.js';\nimport { initStreamingMonitor, startStreamingMonitor, stopStreamingMonitor, handleStreamingCommand } from './streaming-monitor.js';\nconst STREAMING_MONITOR_V1 = true;"
);

replaceRequired(
  'streaming initialization',
  "    initOwnerControl(authDir),\n    initNoxRpg(authDir)",
  "    initOwnerControl(authDir),\n    initStreamingMonitor(authDir),\n    initNoxRpg(authDir)"
);

replaceRequired(
  'streaming start',
  "      console.log(`${config.botName} conectada ao WhatsApp.`);",
  "      console.log(`${config.botName} conectada ao WhatsApp.`);\n      startStreamingMonitor(sock, isGroupAllowed);"
);

replaceRequired(
  'streaming stop',
  "    if (connection === 'close') {\n      if (joinRequestTimer) {",
  "    if (connection === 'close') {\n      stopStreamingMonitor();\n      if (joinRequestTimer) {"
);

replaceRequired(
  'streaming command switch',
  "        case 'perfil':\n          await showProfile(sock, jid, msg, args);\n          break;",
  "        case 'streaming':\n        case 'lancamentosstreaming':\n          await handleStreamingCommand(sock, jid, msg, args, config.prefix);\n          break;\n\n        case 'perfil':\n          await showProfile(sock, jid, msg, args);\n          break;"
);

if (src === original || !src.includes('STREAMING_MONITOR_V1')) {
  console.error('[STREAMING] Streaming monitor patch could not be applied.');
  process.exit(1);
}

await writeFile(path, src, 'utf-8');
console.log('[STREAMING] Per-group streaming release monitor applied.');
