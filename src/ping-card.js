import { readFile } from 'node:fs/promises';
import os from 'node:os';
import sharp from 'sharp';

const bgPath = new URL('../assets/file_00000000a744820ea34b1adb886b6ff2.png', import.meta.url);
let bgCache = null;

const FONT = {
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  'A': ['01110','10001','10001','11111','10001','10001','10001'],
  'B': ['11110','10001','10001','11110','10001','10001','11110'],
  'C': ['01111','10000','10000','10000','10000','10000','01111'],
  'D': ['11110','10001','10001','10001','10001','10001','11110'],
  'E': ['11111','10000','10000','11110','10000','10000','11111'],
  'F': ['11111','10000','10000','11110','10000','10000','10000'],
  'G': ['01111','10000','10000','10111','10001','10001','01111'],
  'H': ['10001','10001','10001','11111','10001','10001','10001'],
  'I': ['11111','00100','00100','00100','00100','00100','11111'],
  'J': ['00111','00010','00010','00010','10010','10010','01100'],
  'K': ['10001','10010','10100','11000','10100','10010','10001'],
  'L': ['10000','10000','10000','10000','10000','10000','11111'],
  'M': ['10001','11011','10101','10101','10001','10001','10001'],
  'N': ['10001','11001','10101','10011','10001','10001','10001'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'],
  'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'Q': ['01110','10001','10001','10001','10101','10010','01101'],
  'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'S': ['01111','10000','10000','01110','00001','00001','11110'],
  'T': ['11111','00100','00100','00100','00100','00100','00100'],
  'U': ['10001','10001','10001','10001','10001','10001','01110'],
  'V': ['10001','10001','10001','10001','10001','01010','00100'],
  'W': ['10001','10001','10001','10101','10101','11011','10001'],
  'X': ['10001','10001','01010','00100','01010','10001','10001'],
  'Y': ['10001','10001','01010','00100','00100','00100','00100'],
  'Z': ['11111','00001','00010','00100','01000','10000','11111'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
  ':': ['00000','00100','00100','00000','00100','00100','00000'],
  '.': ['00000','00000','00000','00000','00000','00110','00110'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '/': ['00001','00010','00010','00100','01000','01000','10000'],
  '%': ['11001','11010','00100','01000','10110','00110','00000'],
  '(': ['00010','00100','01000','01000','01000','00100','00010'],
  ')': ['01000','00100','00010','00010','00010','00100','01000'],
  '+': ['00000','00100','00100','11111','00100','00100','00000']
};

async function backgroundBuffer() {
  if (!bgCache) bgCache = await readFile(bgPath);
  return bgCache;
}

function cleanText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 .:\/%()+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function short(value, max = 42) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}-` : text;
}

function bitmapText(value, x, y, scale = 3, color = '#ffffff', maxChars = 60) {
  const text = cleanText(value).slice(0, maxChars);
  const gap = scale;
  const advance = (5 * scale) + gap;
  let out = '';

  for (let index = 0; index < text.length; index += 1) {
    const pattern = FONT[text[index]] || FONT[' '];
    const ox = x + (index * advance);
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        if (pattern[row][col] !== '1') continue;
        out += `<rect x="${ox + (col * scale)}" y="${y + (row * scale)}" width="${scale}" height="${scale}" rx="${Math.max(0, scale * 0.16)}" fill="${color}"/>`;
      }
    }
  }

  return out;
}

function uptimeText(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${d}D ${String(h).padStart(2, '0')}H ${String(m).padStart(2, '0')}M`;
}

function gb(bytes) {
  return (Number(bytes || 0) / 1024 / 1024 / 1024).toFixed(1);
}

function latencyQuality(ms) {
  if (ms <= 120) return 'EXCELENTE';
  if (ms <= 300) return 'BOA';
  if (ms <= 700) return 'MEDIA';
  return 'ALTA';
}

function panel(x, y, width, height, opacity = 0.68) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="28" fill="rgba(4,14,30,${opacity})" stroke="rgba(154,207,255,.26)" stroke-width="2"/>`;
}

export async function buildPingCard(latencyMs = 0) {
  const width = 1080;
  const height = 1080;
  const latency = Math.max(0, Math.round(Number(latencyMs) || 0));
  const cpu = os.cpus()?.[0] || {};
  const cores = Math.max(1, os.cpus()?.length || 1);
  const totalMem = os.totalmem();
  const usedMem = Math.max(0, totalMem - os.freemem());
  const base = await backgroundBuffer();
  const quality = latencyQuality(latency);
  const cpuModel = short(cpu.model || 'INDISPONIVEL', 34);

  const svg = Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="rgba(2,8,20,.52)"/>
    <rect x="0" y="0" width="1080" height="1080" fill="rgba(3,12,28,.18)"/>

    ${panel(45, 45, 990, 990, 0.54)}

    ${bitmapText('RIMURU-BOT', 78, 76, 6, '#ffffff', 12)}
    ${bitmapText('STATUS DO SISTEMA', 80, 136, 3, '#94cfff', 22)}
    <circle cx="844" cy="101" r="9" fill="#86e6bd"/>
    ${bitmapText('ONLINE', 870, 83, 3, '#dff8ee', 8)}

    ${panel(72, 196, 936, 244, 0.72)}
    ${bitmapText('PING', 106, 228, 3, '#94cfff', 8)}
    ${bitmapText(String(latency), 100, 282, 13, '#ffffff', 8)}
    ${bitmapText('MS', 420, 337, 5, '#94cfff', 2)}
    ${bitmapText('LATENCIA', 675, 255, 3, '#a9bcd1', 10)}
    ${bitmapText(quality, 675, 306, 5, '#ffffff', 10)}
    <line x1="675" y1="365" x2="950" y2="365" stroke="rgba(148,207,255,.32)" stroke-width="4" stroke-linecap="round"/>

    ${panel(72, 470, 448, 168, 0.66)}
    ${bitmapText('UPTIME', 104, 504, 3, '#94cfff', 10)}
    ${bitmapText(uptimeText(process.uptime()), 104, 558, 4, '#ffffff', 18)}

    ${panel(560, 470, 448, 168, 0.66)}
    ${bitmapText('MEMORIA', 592, 504, 3, '#94cfff', 10)}
    ${bitmapText(`${gb(usedMem)} / ${gb(totalMem)} GB`, 592, 558, 4, '#ffffff', 18)}

    ${panel(72, 666, 448, 168, 0.66)}
    ${bitmapText('SISTEMA', 104, 700, 3, '#94cfff', 10)}
    ${bitmapText(`${os.platform()} ${os.arch()}`, 104, 754, 4, '#ffffff', 18)}

    ${panel(560, 666, 448, 168, 0.66)}
    ${bitmapText('NODE.JS', 592, 700, 3, '#94cfff', 10)}
    ${bitmapText(process.version, 592, 754, 4, '#ffffff', 18)}

    ${panel(72, 862, 936, 140, 0.66)}
    ${bitmapText('PROCESSADOR', 104, 892, 3, '#94cfff', 14)}
    ${bitmapText(cpuModel, 104, 938, 3, '#ffffff', 38)}
    ${bitmapText(`${cores} CORES`, 790, 938, 3, '#94cfff', 12)}
  </svg>`);

  return sharp(base)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .modulate({ brightness: 0.42, saturation: 0.78 })
    .composite([{ input: svg }])
    .png({ compressionLevel: 8 })
    .toBuffer();
}

export async function sendPingCard(sock, jid, msg, latencyMs = 0) {
  const latency = Math.max(0, Math.round(Number(latencyMs) || 0));
  const quality = latencyQuality(latency);

  try {
    console.log(`[PING] Executando !ping em ${jid}. Latência calculada: ${latency} ms.`);
    const image = await buildPingCard(latency);
    await sock.sendMessage(jid, {
      image,
      mimetype: 'image/png',
      caption: `🏓 *${latency} ms* • ${quality}\n🤖 *Rimuru-bot* está online.`
    }, { quoted: msg });
    console.log('[PING] Card enviado com sucesso.');
  } catch (error) {
    console.error('[PING] Falha ao gerar/enviar card:', error?.stack || error?.message || error);
    await sock.sendMessage(jid, {
      text: `🏓 *Pong!*\n⚡ *Velocidade:* ${latency} ms\n🤖 *Rimuru-bot* está online.`
    }, { quoted: msg });
    console.log('[PING] Fallback em texto enviado.');
  }
}
