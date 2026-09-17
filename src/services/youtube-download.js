import ytdl from '@distube/ytdl-core';

const MAX_VIDEO_BYTES = 45 * 1024 * 1024;

function safeTitle(value = 'youtube-video') {
  return String(value)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9 _.-]/g, '')
    .trim()
    .slice(0, 80) || 'youtube-video';
}

export async function downloadAndSendYouTubeVideo(sock, jid, msg, url, title = 'YouTube') {
  const info = await ytdl.getInfo(url);
  const formats = info.formats
    .filter((format) => format.hasVideo && format.hasAudio && format.container === 'mp4')
    .sort((a, b) => {
      const aHeight = Number(a.height || 0);
      const bHeight = Number(b.height || 0);
      if (aHeight !== bHeight) return bHeight - aHeight;
      return Number(b.bitrate || 0) - Number(a.bitrate || 0);
    });

  const format = formats.find((item) => {
    const size = Number(item.contentLength || 0);
    return size > 0 && size <= MAX_VIDEO_BYTES;
  }) || formats.find((item) => Number(item.height || 0) <= 360);

  if (!format) {
    throw new Error('NO_COMPATIBLE_FORMAT');
  }

  const expectedSize = Number(format.contentLength || 0);
  if (expectedSize > MAX_VIDEO_BYTES) {
    throw new Error('VIDEO_TOO_LARGE');
  }

  const chunks = [];
  let total = 0;
  const stream = ytdl.downloadFromInfo(info, { format });

  for await (const chunk of stream) {
    total += chunk.length;
    if (total > MAX_VIDEO_BYTES) {
      stream.destroy();
      throw new Error('VIDEO_TOO_LARGE');
    }
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);
  await sock.sendMessage(jid, {
    video: buffer,
    mimetype: 'video/mp4',
    fileName: `${safeTitle(title)}.mp4`,
    caption: `▶️ *${title}*\n\nEnviado pelo Rimuru-Bot.`
  }, { quoted: msg });
}
