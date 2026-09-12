import { readFile } from 'node:fs/promises';
import os from 'node:os';
import sharp from 'sharp';

const bgPath = new URL('../assets/file_00000000a744820ea34b1adb886b6ff2.png', import.meta.url);
let bgCache = null;

const mb = (bytes) => `${(Number(bytes || 0) / 1024 / 1024).toFixed(0)} MB`;

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
  const s = total % 60;
  return `${d}D ${String(h).padStart(2, '0')}H ${String(m).padStart(2, '0')}M ${String(s).padStart(2, '0')}S`;
}

export async function buildPingCard(latencyMs = 0) {
  const width = 1280;
  const height = 720;
  const memory = process.memoryUsage();
  const cpu = os.cpus()?.[0] || {};
  const latency = Math.max(0, Math.round(Number(latencyMs) || 0));
  const base = await backgroundBuffer();

  const rows = [
    ['LATENCIA', `${latency} MS`],
    ['UPTIME', uptimeText(process.uptime())],
    ['SISTEMA', `${os.platform()} ${os.arch()}`],
    ['NODE', process.version],
    ['RAM', `${mb(memory.rss)} RSS / ${mb(memory.heapUsed)} HEAP`],
    ['CPU', short(cpu.model || 'INDISPONIVEL', 39)],
    ['FREQ', `${Number(cpu.speed || 0)} MHZ`]
  ];

  let rowSvg = '';
  rows.forEach(([label, value], index) => {
    const y = 330 + (index * 45);
    rowSvg += bitmapText(label, 100, y, 3, '#8dc7ff', 12);
    rowSvg += bitmapText(value, 335, y, 3, '#ffffff', 46);
  });

  const svg = Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="rgba(3,10,22,.58)"/>
    <rect x="58" y="52" width="1164" height="616" rx="30" fill="rgba(4,14,28,.70)" stroke="rgba(177,214,255,.34)" stroke-width="2"/>
    ${bitmapText('RIMURU-BOT STATUS', 96, 82, 5, '#ffffff', 24)}
    ${bitmapText('VELOCIDADE DO BOT', 96, 146, 3, '#b9dcff', 24)}
    ${bitmapText(String(latency), 96, 192, 10, '#8dc7ff', 8)}
    ${bitmapText('MS', 390, 231, 4, '#ffffff', 2)}
    <line x1="96" y1="292" x2="1184" y2="292" stroke="rgba(255,255,255,.25)" stroke-width="2"/>
    ${rowSvg}
  </svg>`);

  return sharp(base)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .modulate({ brightness: 0.48, saturation: 0.82 })
    .composite([{ input: svg }])
    .png()
    .toBuffer();
}

export async function sendPingCard(sock, jid, msg, latencyMs = 0) {
  const latency = Math.max(0, Math.round(Number(latencyMs) || 0));

  try {
    console.log(`[PING] Executando !ping em ${jid}. Latência calculada: ${latency} ms.`);
    const image = await buildPingCard(latency);
    await sock.sendMessage(jid, {
      image,
      mimetype: 'image/png',
      caption: `⚡ *Velocidade:* ${latency} ms\n🤖 *Rimuru-bot* está online.`
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
