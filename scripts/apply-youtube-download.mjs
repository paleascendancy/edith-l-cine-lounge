import fs from 'node:fs';

const file = 'src/services/direct-sources.js';
let src = fs.readFileSync(file, 'utf8');

if (!src.includes("from './youtube-download.js'")) {
  src = `import { downloadAndSendYouTubeVideo } from './youtube-download.js';\n\n${src}`;
}

const oldSend = "  await sendImage(sock, jid, msg, video.snippet?.thumbnails?.high?.url || video.snippet?.thumbnails?.medium?.url, caption);";
const newSend = `  await sendText(sock, jid, msg, '⬇️ Baixando o vídeo para enviar no WhatsApp...');\n  try {\n    await downloadAndSendYouTubeVideo(sock, jid, msg, canonical, title);\n  } catch (error) {\n    console.error('[YOUTUBE-DL] Falha:', error?.message || error);\n    if (error?.message === 'VIDEO_TOO_LARGE') {\n      await sendText(sock, jid, msg, '⚠️ Esse vídeo ficou grande demais para o limite configurado do bot.');\n    } else {\n      await sendText(sock, jid, msg, '❌ Não consegui baixar esse vídeo. Ele pode estar restrito, indisponível ou sem um formato compatível.');\n    }\n  }`;

if (src.includes(oldSend)) {
  src = src.replace(oldSend, newSend);
}

fs.writeFileSync(file, src);
console.log('[YOUTUBE-DL] Comando !youtube configurado para enviar vídeo.');
