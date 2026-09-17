const MAX_VIDEO_BYTES = 45 * 1024 * 1024;

function isHttpUrl(value = '') {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function sendDirectVideo(sock, jid, msg, input = '') {
  const url = String(input).trim();
  if (!url) {
    await sock.sendMessage(jid, { text: 'Use: *!video link-direto.mp4*\n\nUse apenas arquivos que você possui ou tem autorização para distribuir.' }, { quoted: msg });
    return;
  }

  if (!isHttpUrl(url)) {
    await sock.sendMessage(jid, { text: '⚠️ Envie um link HTTP/HTTPS direto para um arquivo de vídeo.' }, { quoted: msg });
    return;
  }

  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(60000),
    headers: { accept: 'video/*,application/octet-stream;q=0.8' }
  });

  if (!response.ok) throw new Error(`VIDEO_HTTP_${response.status}`);

  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const contentLength = Number(response.headers.get('content-length') || 0);

  if (contentLength > MAX_VIDEO_BYTES) throw new Error('VIDEO_TOO_LARGE');
  if (contentType && !contentType.startsWith('video/') && contentType !== 'application/octet-stream') {
    throw new Error('NOT_DIRECT_VIDEO');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('EMPTY_VIDEO');

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_VIDEO_BYTES) {
      await reader.cancel();
      throw new Error('VIDEO_TOO_LARGE');
    }
    chunks.push(Buffer.from(value));
  }

  if (!total) throw new Error('EMPTY_VIDEO');
  const video = Buffer.concat(chunks, total);
  const mimetype = contentType.startsWith('video/') ? contentType : 'video/mp4';

  await sock.sendMessage(jid, {
    video,
    mimetype,
    caption: '🎬 Vídeo enviado pelo Rimuru.'
  }, { quoted: msg });
}
