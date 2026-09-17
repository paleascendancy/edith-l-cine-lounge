import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/services/direct-sources.js', import.meta.url);
let src = await readFile(path, 'utf-8');

if (src.includes('DIRECT_VIDEO_V1')) {
  console.log('[VIDEO] Direct video command already applied.');
  process.exit(0);
}

src = `import { sendDirectVideo } from './direct-video.js';\nconst DIRECT_VIDEO_V1 = true;\n${src}`;

src = src.replace(
  "  'spotify'\n]);",
  "  'spotify',\n  'video'\n]);"
);

src = src.replace(
  "      case 'youtube': await youtubeCommand(sock, jid, msg, args); break;",
  "      case 'youtube': await youtubeCommand(sock, jid, msg, args); break;\n      case 'video':\n        try {\n          await sendDirectVideo(sock, jid, msg, args);\n        } catch (error) {\n          console.error('[VIDEO] Falha:', error?.message || error);\n          const reason = error?.message === 'VIDEO_TOO_LARGE'\n            ? '⚠️ O arquivo ultrapassa o limite de 45 MB do bot.'\n            : error?.message === 'NOT_DIRECT_VIDEO'\n              ? '⚠️ Esse endereço não aponta diretamente para um arquivo de vídeo.'\n              : '❌ Não consegui obter esse vídeo direto. Confira se o arquivo está acessível.';\n          await sendText(sock, jid, msg, reason);\n        }\n        break;"
);

if (!src.includes("'video'\n]);") || !src.includes("case 'video':")) {
  console.error('[VIDEO] Could not apply direct video routing.');
  process.exit(1);
}

await writeFile(path, src, 'utf-8');
console.log('[VIDEO] !video direct-file command applied.');
