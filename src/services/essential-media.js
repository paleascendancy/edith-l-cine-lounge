import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import webp from 'node-webpmux';
import { scheduleEssentialSave } from './essential-state.js';

const execFileAsync = promisify(execFile);

function unwrap(message) {
  if (!message) return null;
  if (message.ephemeralMessage?.message) return unwrap(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return unwrap(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrap(message.viewOnceMessageV2.message);
  return message;
}

function contextInfo(message) {
  const clean = unwrap(message) || {};
  return clean.extendedTextMessage?.contextInfo ||
    clean.imageMessage?.contextInfo ||
    clean.videoMessage?.contextInfo ||
    clean.audioMessage?.contextInfo ||
    clean.documentMessage?.contextInfo ||
    clean.stickerMessage?.contextInfo || null;
}

function mediaFrom(message, type) {
  const clean = unwrap(message);
  if (!clean) return null;
  const key = `${type}Message`;
  if (clean[key]) return clean[key];
  const quoted = contextInfo(clean)?.quotedMessage;
  return quoted ? mediaFrom(quoted, type) : null;
}

async function download(mediaMessage, type) {
  const stream = await downloadContentFromMessage(mediaMessage, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function sendText(sock, jid, msg, text) {
  await sock.sendMessage(jid, { text }, { quoted: msg });
}

async function tempTransform(prefix, inputBuffer, inputExt, outputExt, args) {
  if (!ffmpegPath) throw new Error('FFMPEG_UNAVAILABLE');
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
  const input = join(dir, `input.${inputExt}`);
  const output = join(dir, `output.${outputExt}`);
  try {
    await writeFile(input, inputBuffer);
    await execFileAsync(ffmpegPath, ['-y', '-i', input, ...args, output], { maxBuffer: 30 * 1024 * 1024 });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function stickerExif(packName, publisher) {
  const metadata = Buffer.from(JSON.stringify({
    'sticker-pack-id': `rimuru-${Date.now()}`,
    'sticker-pack-name': String(packName || 'thzNode').slice(0, 60),
    'sticker-pack-publisher': String(publisher || 'Rimuru-Bot').slice(0, 60),
    emojis: ['']
  }), 'utf8');
  const header = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00
  ]);
  header.writeUInt32LE(metadata.length, 14);
  return Buffer.concat([header, metadata]);
}

async function brandSticker(buffer, packName, publisher) {
  const dir = await mkdtemp(join(tmpdir(), 'rimuru-brand-'));
  const input = join(dir, 'input.webp');
  const output = join(dir, 'output.webp');
  try {
    await writeFile(input, buffer);
    const image = new webp.Image();
    await image.load(input);
    image.exif = stickerExif(packName, publisher);
    await image.save(output);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function escapeXml(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function wrapText(value, max = 20) {
  const words = String(value).trim().split(/\s+/u).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= max) current += ` ${word}`;
    else { lines.push(current); current = word; }
    if (lines.length >= 7) break;
  }
  if (current && lines.length < 8) lines.push(current);
  return lines.slice(0, 8);
}

async function textSticker(text, user, emojiOnly = false) {
  const lines = emojiOnly ? [String(text).slice(0, 12)] : wrapText(text, 22);
  if (!lines.length) throw new Error('TEXT_REQUIRED');
  const fontSize = emojiOnly ? 210 : Math.max(42, Math.min(82, Math.floor(430 / Math.max(1, lines.length))));
  const lineHeight = fontSize * 1.12;
  const total = lines.length * lineHeight;
  const firstY = 256 - total / 2 + fontSize;
  const tspans = lines.map((line, i) => `<tspan x="256" y="${Math.round(firstY + i * lineHeight)}">${escapeXml(line)}</tspan>`).join('');
  const svg = Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="shadow"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-opacity=".65"/></filter></defs>
    <rect width="512" height="512" rx="72" fill="#0b0d12"/>
    <rect x="12" y="12" width="488" height="488" rx="64" fill="none" stroke="#8b2638" stroke-width="8"/>
    <text text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="800" fill="#ffffff" filter="url(#shadow)">${tspans}</text>
  </svg>`);
  const webpBuffer = await sharp(svg).webp({ quality: 100, alphaQuality: 100, effort: 6 }).toBuffer();
  return brandSticker(webpBuffer, user.sticker.pack, user.sticker.publisher);
}

function jpegToPdf(jpeg, width, height) {
  const objects = [];
  const push = (content) => { objects.push(Buffer.isBuffer(content) ? content : Buffer.from(content, 'binary')); return objects.length; };
  const catalog = push('<< /Type /Catalog /Pages 2 0 R >>');
  push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  push(Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, 'binary'),
    jpeg,
    Buffer.from('\nendstream', 'binary')
  ]));
  const content = Buffer.from(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ`, 'binary');
  push(`<< /Length ${content.length} >>\nstream\n${content.toString('binary')}\nendstream`);
  const header = Buffer.from('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n', 'binary');
  const chunks = [header];
  const offsets = [0];
  let offset = header.length;
  objects.forEach((obj, index) => {
    offsets.push(offset);
    const before = Buffer.from(`${index + 1} 0 obj\n`, 'binary');
    const after = Buffer.from('\nendobj\n', 'binary');
    chunks.push(before, obj, after);
    offset += before.length + obj.length + after.length;
  });
  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(Buffer.from(xref, 'binary'));
  return Buffer.concat(chunks);
}

async function staticImageInput(msg) {
  const image = mediaFrom(msg.message, 'image');
  if (image) return download(image, 'image');
  const sticker = mediaFrom(msg.message, 'sticker');
  if (sticker) {
    const buffer = await download(sticker, 'sticker');
    return sharp(buffer, { page: 0, pages: 1 }).png().toBuffer();
  }
  return null;
}

async function requireMedia(sock, jid, msg, types) {
  for (const type of types) {
    const found = mediaFrom(msg.message, type);
    if (found) return { type, message: found };
  }
  await sendText(sock, jid, msg, `⚠️ Responda a ${types.map((type) => type === 'image' ? 'uma imagem' : type === 'video' ? 'um vídeo' : type === 'sticker' ? 'uma figurinha' : `um ${type}`).join(' ou ')} para usar esse comando.`);
  return null;
}

export const ESSENTIAL_MEDIA_COMMANDS = new Set([
  'hd', 'compress', 'audio', 'mp3', 'gif', 'removeaudio', 'melhorar', 'scan', 'pdf',
  'stickerhd', 'stickertexto', 'stickeremoji', 'stickerpack', 'marca', 'stickergif'
]);

export async function handleEssentialMedia(ctx) {
  const { sock, jid, msg, command, args, user } = ctx;

  if (command === 'stickertexto') {
    if (!args.trim()) { await sendText(sock, jid, msg, 'Use *!stickertexto seu texto aqui*.'); return true; }
    const sticker = await textSticker(args, user, false);
    await sock.sendMessage(jid, { sticker }, { quoted: msg });
    return true;
  }

  if (command === 'stickeremoji') {
    if (!args.trim()) { await sendText(sock, jid, msg, 'Use *!stickeremoji 😎*.'); return true; }
    const sticker = await textSticker(args, user, true);
    await sock.sendMessage(jid, { sticker }, { quoted: msg });
    return true;
  }

  if (command === 'stickerpack' || command === 'marca') {
    const value = args.trim().slice(0, 60);
    if (!value) {
      await sendText(sock, jid, msg, `Use *!${command} nome*.\nAtual: *${command === 'stickerpack' ? user.sticker.pack : user.sticker.publisher}*.`);
      return true;
    }
    if (command === 'stickerpack') user.sticker.pack = value;
    else user.sticker.publisher = value;
    scheduleEssentialSave();
    const stickerMsg = mediaFrom(msg.message, 'sticker');
    if (stickerMsg) {
      const original = await download(stickerMsg, 'sticker');
      const branded = await brandSticker(original, user.sticker.pack, user.sticker.publisher);
      await sock.sendMessage(jid, { sticker: branded }, { quoted: msg });
    } else {
      await sendText(sock, jid, msg, `✅ Marca de figurinha atualizada.\nPacote: *${user.sticker.pack}*\nAutor: *${user.sticker.publisher}*`);
    }
    return true;
  }

  if (command === 'hd' || command === 'melhorar') {
    const videoMsg = mediaFrom(msg.message, 'video');
    const image = await staticImageInput(msg);
    if (!image && !videoMsg) { await sendText(sock, jid, msg, '⚠️ Responda a uma imagem, figurinha ou vídeo.'); return true; }
    if (videoMsg) {
      const input = await download(videoMsg, 'video');
      const output = await tempTransform('rimuru-hd', input, 'mp4', 'mp4', [
        '-vf', 'scale=w=min(1920\\,iw*2):h=-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'
      ]);
      await sock.sendMessage(jid, { document: output, mimetype: 'video/mp4', fileName: 'rimuru-hd.mp4', caption: '✨ Vídeo otimizado em alta qualidade.' }, { quoted: msg });
      return true;
    }
    const metadata = await sharp(image).metadata();
    const width = Math.min(2048, Math.max(metadata.width || 512, (metadata.width || 512) * 2));
    const output = await sharp(image).rotate().resize({ width, withoutEnlargement: false, kernel: sharp.kernel.lanczos3 }).sharpen({ sigma: 0.8 }).png({ compressionLevel: 6 }).toBuffer();
    await sock.sendMessage(jid, { document: output, mimetype: 'image/png', fileName: 'rimuru-hd.png', caption: '✨ Imagem otimizada e enviada como arquivo para preservar qualidade.' }, { quoted: msg });
    return true;
  }

  if (command === 'scan') {
    const image = await staticImageInput(msg);
    if (!image) { await sendText(sock, jid, msg, '📄 Responda a uma foto de documento com *!scan*.'); return true; }
    const output = await sharp(image).rotate().grayscale().normalize().sharpen({ sigma: 1.25 }).png({ compressionLevel: 6 }).toBuffer();
    await sock.sendMessage(jid, { document: output, mimetype: 'image/png', fileName: 'scan-rimuru.png', caption: '📄 Documento realçado.' }, { quoted: msg });
    return true;
  }

  if (command === 'pdf') {
    const image = await staticImageInput(msg);
    if (!image) { await sendText(sock, jid, msg, '📄 Responda a uma imagem com *!pdf*.'); return true; }
    const normalized = await sharp(image).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 94 }).toBuffer({ resolveWithObject: true });
    const pdf = jpegToPdf(normalized.data, normalized.info.width, normalized.info.height);
    await sock.sendMessage(jid, { document: pdf, mimetype: 'application/pdf', fileName: 'rimuru.pdf' }, { quoted: msg });
    return true;
  }

  if (command === 'compress') {
    const media = await requireMedia(sock, jid, msg, ['image', 'video']);
    if (!media) return true;
    const input = await download(media.message, media.type);
    if (media.type === 'image') {
      const output = await sharp(input).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 68, effort: 6 }).toBuffer();
      await sock.sendMessage(jid, { document: output, mimetype: 'image/webp', fileName: 'rimuru-comprimida.webp', caption: `🗜️ ${Math.round(input.length / 1024)} KB → ${Math.round(output.length / 1024)} KB` }, { quoted: msg });
    } else {
      const output = await tempTransform('rimuru-compress', input, 'mp4', 'mp4', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart']);
      await sock.sendMessage(jid, { document: output, mimetype: 'video/mp4', fileName: 'rimuru-comprimido.mp4', caption: `🗜️ ${Math.round(input.length / 1024)} KB → ${Math.round(output.length / 1024)} KB` }, { quoted: msg });
    }
    return true;
  }

  if (command === 'audio' || command === 'mp3') {
    const media = await requireMedia(sock, jid, msg, ['video', 'audio']);
    if (!media) {
      if (/^https?:\/\//i.test(args.trim())) await sendText(sock, jid, msg, 'ℹ️ Para links externos, use os downloaders específicos. O *!mp3* local funciona respondendo a vídeo/áudio e não depende de sites terceiros.');
      return true;
    }
    const input = await download(media.message, media.type);
    const ext = media.type === 'video' ? 'mp4' : 'ogg';
    const output = await tempTransform('rimuru-audio', input, ext, 'mp3', ['-vn', '-c:a', 'libmp3lame', '-b:a', '256k']);
    await sock.sendMessage(jid, { audio: output, mimetype: 'audio/mpeg', ptt: false, fileName: 'rimuru-audio.mp3' }, { quoted: msg });
    return true;
  }

  if (command === 'removeaudio') {
    const media = await requireMedia(sock, jid, msg, ['video']);
    if (!media) return true;
    const input = await download(media.message, 'video');
    const output = await tempTransform('rimuru-silent', input, 'mp4', 'mp4', ['-c:v', 'copy', '-an', '-movflags', '+faststart']);
    await sock.sendMessage(jid, { document: output, mimetype: 'video/mp4', fileName: 'rimuru-sem-audio.mp4' }, { quoted: msg });
    return true;
  }

  if (command === 'gif') {
    const media = await requireMedia(sock, jid, msg, ['video']);
    if (!media) return true;
    const input = await download(media.message, 'video');
    const output = await tempTransform('rimuru-gif', input, 'mp4', 'gif', ['-t', '8', '-vf', 'fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=192[p];[s1][p]paletteuse=dither=sierra2_4a', '-loop', '0']);
    await sock.sendMessage(jid, { document: output, mimetype: 'image/gif', fileName: 'rimuru.gif' }, { quoted: msg });
    return true;
  }

  if (command === 'stickerhd') {
    const media = await requireMedia(sock, jid, msg, ['sticker', 'image']);
    if (!media) return true;
    const input = await download(media.message, media.type);
    const output = await sharp(input, media.type === 'sticker' ? { page: 0, pages: 1 } : {}).rotate().resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: sharp.kernel.lanczos3 }).sharpen({ sigma: 0.7 }).webp({ quality: 100, alphaQuality: 100, effort: 6 }).toBuffer();
    const branded = await brandSticker(output, user.sticker.pack, user.sticker.publisher);
    await sock.sendMessage(jid, { sticker: branded }, { quoted: msg });
    return true;
  }

  if (command === 'stickergif') {
    const media = await requireMedia(sock, jid, msg, ['video']);
    if (!media) return true;
    const input = await download(media.message, 'video');
    const output = await tempTransform('rimuru-stickergif', input, 'mp4', 'webp', ['-t', '6', '-vf', 'fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba', '-an', '-c:v', 'libwebp', '-lossless', '0', '-compression_level', '6', '-q:v', '82', '-loop', '0', '-preset', 'picture']);
    const branded = await brandSticker(output, user.sticker.pack, user.sticker.publisher);
    await sock.sendMessage(jid, { sticker: branded }, { quoted: msg });
    return true;
  }

  return false;
}
