import { readFile } from 'node:fs/promises';
import os from 'node:os';
import sharp from 'sharp';

const bgPath = new URL('../assets/file_00000000a744820ea34b1adb886b6ff2.png', import.meta.url);
let bgCache = null;

const esc = (v = '') => String(v)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const mb = (bytes) => `${(Number(bytes || 0) / 1024 / 1024).toFixed(0)} MB`;

async function backgroundBuffer() {
  if (!bgCache) bgCache = await readFile(bgPath);
  return bgCache;
}

function uptimeText(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export async function buildPingCard(latencyMs = 0) {
  const width = 1280;
  const height = 720;
  const memory = process.memoryUsage();
  const cpu = os.cpus()?.[0] || {};
  const latency = Math.max(0, Math.round(Number(latencyMs) || 0));
  const cpuModel = String(cpu.model || 'indisponível').slice(0, 48);
  const system = `${os.platform()} ${os.arch()} • ${String(os.release()).slice(0, 24)}`;
  const base = await backgroundBuffer();

  const svg = Buffer.from(`
  <svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
    <style>
      .t{font:700 42px sans-serif;fill:#fff}.b{font:800 92px sans-serif;fill:#8dc7ff}
      .h{font:700 26px sans-serif;fill:#fff}.l{font:600 22px sans-serif;fill:#c7d9ef}.v{font:700 22px sans-serif;fill:#fff}
    </style>
    <rect width="1280" height="720" fill="rgba(3,10,22,.62)"/>
    <rect x="58" y="52" width="1164" height="616" rx="30" fill="rgba(4,14,28,.70)" stroke="rgba(177,214,255,.30)"/>
    <text x="96" y="118" class="t">VELOCIDADE DO BOT</text>
    <text x="96" y="235" class="b">${esc(latency)}</text><text x="410" y="232" class="h">ms</text>
    <line x1="96" y1="276" x2="1184" y2="276" stroke="rgba(255,255,255,.22)"/>
    <text x="96" y="330" class="h">ANÁLISE DE LATÊNCIA E UPTIME</text>
    <text x="96" y="374" class="l">Latência:</text><text x="250" y="374" class="v">${esc(latency)} ms</text>
    <text x="96" y="414" class="l">Uptime:</text><text x="250" y="414" class="v">${esc(uptimeText(process.uptime()))}</text>
    <text x="650" y="330" class="h">INFORMAÇÕES DO SISTEMA</text>
    <text x="650" y="374" class="l">Sistema:</text><text x="800" y="374" class="v">${esc(system)}</text>
    <text x="650" y="414" class="l">Node.js:</text><text x="800" y="414" class="v">${esc(process.version)}</text>
    <text x="650" y="454" class="l">RAM:</text><text x="800" y="454" class="v">${esc(mb(memory.rss))} RSS • ${esc(mb(memory.heapUsed))} heap</text>
    <text x="96" y="510" class="h">PROCESSADOR</text>
    <text x="96" y="554" class="l">Modelo:</text><text x="250" y="554" class="v">${esc(cpuModel)}</text>
    <text x="96" y="594" class="l">Frequência:</text><text x="250" y="594" class="v">${esc(cpu.speed || 0)} MHz</text>
    <text x="96" y="646" class="v">Rimuru-bot • status técnico em tempo real</text>
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
