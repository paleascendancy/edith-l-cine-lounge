import { scheduleEssentialSave } from './essential-state.js';

async function send(sock, jid, msg, text) {
  await sock.sendMessage(jid, { text: String(text).slice(0, 14000) }, { quoted: msg });
}

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'indisponível';
}

function tlv(id, value) {
  const clean = String(value ?? '');
  return `${id}${String(clean.length).padStart(2, '0')}${clean}`;
}

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildPixPayload({ key, amount = 0, name = 'RIMURU BOT', city = 'BOA VISTA', txid = 'RIMURU' }) {
  const gui = tlv('00', 'BR.GOV.BCB.PIX');
  const merchant = tlv('26', gui + tlv('01', String(key).trim()));
  const value = Number(amount) > 0 ? tlv('54', Number(amount).toFixed(2)) : '';
  const safeName = normalize(name).toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 25) || 'RIMURU BOT';
  const safeCity = normalize(city).toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 15) || 'BOA VISTA';
  const body = tlv('00', '01') + merchant + tlv('52', '0000') + tlv('53', '986') + value + tlv('58', 'BR') + tlv('59', safeName) + tlv('60', safeCity) + tlv('62', tlv('05', String(txid || '***').slice(0, 25))) + '6304';
  return body + crc16(body);
}

const STATE_DDDS = {
  AC: [68], AL: [82], AP: [96], AM: [92, 97], BA: [71, 73, 74, 75, 77], CE: [85, 88], DF: [61], ES: [27, 28], GO: [61, 62, 64], MA: [98, 99], MT: [65, 66], MS: [67], MG: [31, 32, 33, 34, 35, 37, 38], PA: [91, 93, 94], PB: [83], PR: [41, 42, 43, 44, 45, 46], PE: [81, 87], PI: [86, 89], RJ: [21, 22, 24], RN: [84], RS: [51, 53, 54, 55], RO: [69], RR: [95], SC: [47, 48, 49], SP: [11, 12, 13, 14, 15, 16, 17, 18, 19], SE: [79], TO: [63]
};
const STATE_NAMES = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
const dddCache = new Map();

async function dddInfo(ddd) {
  const key = String(ddd);
  const cached = dddCache.get(key);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.data;
  const response = await fetch(`https://brasilapi.com.br/api/ddd/v1/${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(response.status === 404 ? 'DDD_NOT_FOUND' : `DDD_HTTP_${response.status}`);
  const data = await response.json();
  dddCache.set(key, { at: Date.now(), data });
  return data;
}

async function searchDddByCity(city) {
  const cptec = await fetch(`https://brasilapi.com.br/api/cptec/v1/cidade/${encodeURIComponent(city)}`, { signal: AbortSignal.timeout(15000) });
  if (!cptec.ok) throw new Error('CITY_NOT_FOUND');
  const candidates = await cptec.json();
  const desired = normalize(city);
  const location = (candidates || []).find((item) => normalize(item?.cidade) === desired) || candidates?.[0];
  if (!location?.estado) throw new Error('CITY_NOT_FOUND');
  const ddds = STATE_DDDS[String(location.estado).toUpperCase()] || [];
  for (const ddd of ddds) {
    try {
      const info = await dddInfo(ddd);
      if ((info?.cities || []).some((name) => normalize(name) === desired)) return { ddd, info };
    } catch {}
  }
  throw new Error('CITY_NOT_FOUND');
}

function weatherDescription(code) {
  const table = { 0: 'céu limpo', 1: 'predominantemente limpo', 2: 'parcialmente nublado', 3: 'nublado', 45: 'neblina', 48: 'neblina com geada', 51: 'garoa fraca', 53: 'garoa', 55: 'garoa forte', 61: 'chuva fraca', 63: 'chuva', 65: 'chuva forte', 71: 'neve fraca', 80: 'pancadas de chuva', 81: 'pancadas de chuva', 82: 'pancadas fortes', 95: 'trovoadas' };
  return table[Number(code)] || 'condição variável';
}

export const ESSENTIAL_UTILITY_COMMANDS = new Set(['contagem', 'salvarlink', 'rastreio', 'cep', 'clima', 'cotacao', 'qr', 'encurtar', 'pixqr', 'compararpreco', 'ddd']);

export async function handleEssentialUtility(ctx) {
  const { sock, jid, msg, command, args, user } = ctx;
  try {
    if (command === 'contagem') {
      const raw = String(args || '').trim();
      const match = /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/.exec(raw);
      if (!match) { await send(sock, jid, msg, '📅 Use *!contagem 25/12* ou *!contagem 25/12/2026*.'); return true; }
      const now = new Date();
      let year = match[3] ? Number(match[3]) : now.getFullYear();
      if (year < 100) year += 2000;
      let target = new Date(year, Number(match[2]) - 1, Number(match[1]), 12, 0, 0);
      if (!match[3] && target.getTime() < now.getTime()) target = new Date(year + 1, Number(match[2]) - 1, Number(match[1]), 12, 0, 0);
      if (Number.isNaN(target.getTime())) { await send(sock, jid, msg, '⚠️ Data inválida.'); return true; }
      const days = Math.ceil((target.getTime() - now.getTime()) / 86400000);
      await send(sock, jid, msg, `⏳ Faltam *${days} dia(s)* para *${target.toLocaleDateString('pt-BR')}*.`);
      return true;
    }

    if (command === 'salvarlink') {
      const input = String(args || '').trim();
      if (!input || input.toLowerCase() === 'listar') {
        const lines = user.savedLinks.slice(-20).map((item, index) => `${index + 1}. ${item.url}${item.label ? ` — ${item.label}` : ''}`);
        await send(sock, jid, msg, lines.length ? `🔖 *SEUS LINKS*\n\n${lines.join('\n')}` : '🔖 Você ainda não salvou links.\nUse *!salvarlink URL descrição opcional*.');
        return true;
      }
      const remove = /^remover\s+(\d+)$/i.exec(input);
      if (remove) {
        const index = Number(remove[1]) - 1;
        if (index < 0 || index >= user.savedLinks.length) { await send(sock, jid, msg, '⚠️ Número de link inválido.'); return true; }
        user.savedLinks.splice(index, 1); scheduleEssentialSave();
        await send(sock, jid, msg, '✅ Link removido.'); return true;
      }
      const parts = input.split(/\s+/u);
      const url = parts.shift();
      if (!/^https?:\/\//i.test(url || '')) { await send(sock, jid, msg, '⚠️ Informe um link começando com http:// ou https://.'); return true; }
      user.savedLinks.push({ url, label: parts.join(' ').slice(0, 120), at: Date.now() });
      if (user.savedLinks.length > 100) user.savedLinks = user.savedLinks.slice(-100);
      scheduleEssentialSave();
      await send(sock, jid, msg, '🔖 Link salvo. Use *!salvarlink listar* para consultar.');
      return true;
    }

    if (command === 'cep') {
      const cep = String(args || '').replace(/\D/g, '');
      if (cep.length !== 8) { await send(sock, jid, msg, '📮 Use *!cep 69300000*.'); return true; }
      const response = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('CEP_NOT_FOUND');
      const data = await response.json();
      await send(sock, jid, msg, `📮 *CEP ${cep.slice(0, 5)}-${cep.slice(5)}*\n${data.street || 'Logradouro não informado'}\n${data.neighborhood || 'Bairro não informado'}\n${data.city || ''} - ${data.state || ''}`);
      return true;
    }

    if (command === 'clima') {
      const city = String(args || '').trim();
      if (!city) { await send(sock, jid, msg, '🌦️ Use *!clima Boa Vista*.'); return true; }
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt&format=json`, { signal: AbortSignal.timeout(15000) });
      const geo = await geoRes.json();
      const place = geo?.results?.[0];
      if (!place) throw new Error('CITY_NOT_FOUND');
      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&timezone=auto`, { signal: AbortSignal.timeout(15000) });
      const weather = await weatherRes.json();
      const current = weather?.current;
      if (!current) throw new Error('WEATHER_EMPTY');
      await send(sock, jid, msg, `🌦️ *${place.name}${place.admin1 ? ` - ${place.admin1}` : ''}*\n🌡️ ${current.temperature_2m}°C • sensação ${current.apparent_temperature}°C\n💧 Umidade: ${current.relative_humidity_2m}%\n🌧️ Precipitação: ${current.precipitation} mm\n💨 Vento: ${current.wind_speed_10m} km/h\n☁️ ${weatherDescription(current.weather_code)}`);
      return true;
    }

    if (command === 'cotacao') {
      const currency = String(args || 'USD').trim().split(/\s+/u)[0].toUpperCase().replace(/[^A-Z]/g, '') || 'USD';
      const pair = `${currency}-BRL`;
      const response = await fetch(`https://economia.awesomeapi.com.br/json/last/${encodeURIComponent(pair)}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('CURRENCY_NOT_FOUND');
      const data = await response.json();
      const quote = data[`${currency}BRL`];
      if (!quote) throw new Error('CURRENCY_NOT_FOUND');
      await send(sock, jid, msg, `💱 *${quote.name || pair}*\nCompra: *R$ ${Number(quote.bid).toFixed(4)}*\nMáxima: R$ ${Number(quote.high).toFixed(4)}\nMínima: R$ ${Number(quote.low).toFixed(4)}\nVariação: ${quote.pctChange}%`);
      return true;
    }

    if (command === 'qr') {
      const text = String(args || '').trim();
      if (!text) { await send(sock, jid, msg, '🔳 Use *!qr texto ou link*.'); return true; }
      const url = `https://quickchart.io/qr?size=700&margin=2&text=${encodeURIComponent(text)}`;
      await sock.sendMessage(jid, { image: { url }, caption: '🔳 QR Code gerado pela Rimuru.' }, { quoted: msg });
      return true;
    }

    if (command === 'encurtar') {
      const url = String(args || '').trim();
      if (!/^https?:\/\//i.test(url)) { await send(sock, jid, msg, '🔗 Use *!encurtar https://exemplo.com/link*.'); return true; }
      const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('SHORTENER_FAILED');
      const short = (await response.text()).trim();
      await send(sock, jid, msg, `🔗 *LINK ENCURTADO*\n${short}`);
      return true;
    }

    if (command === 'pixqr') {
      const parts = String(args || '').trim().split(/\s+/u).filter(Boolean);
      const key = parts[0] || '';
      const amount = Number(String(parts[1] || '0').replace(',', '.'));
      if (!key) { await send(sock, jid, msg, '💠 Use *!pixqr chave-pix valor*.\nEx.: *!pixqr email@exemplo.com 10,00*'); return true; }
      const payload = buildPixPayload({ key, amount, name: process.env.PIX_MERCHANT_NAME || 'RIMURU BOT', city: process.env.PIX_MERCHANT_CITY || 'BOA VISTA' });
      const qrUrl = `https://quickchart.io/qr?size=800&margin=2&text=${encodeURIComponent(payload)}`;
      await sock.sendMessage(jid, { image: { url: qrUrl }, caption: `💠 *PIX QR*\nValor: ${amount > 0 ? money(amount) : 'sem valor fixo'}\n\nCopia e cola:\n${payload}` }, { quoted: msg });
      return true;
    }

    if (command === 'compararpreco') {
      const query = String(args || '').trim();
      if (!query) { await send(sock, jid, msg, '🛍️ Use *!compararpreco produto*.'); return true; }
      const response = await fetch(`https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(query)}&limit=8`, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('PRICE_SEARCH_FAILED');
      const data = await response.json();
      const rows = (data?.results || []).slice(0, 8).map((item, i) => `${i + 1}. *${String(item.title || '').slice(0, 80)}*\n   ${money(item.price)}${item.permalink ? `\n   ${item.permalink}` : ''}`);
      await send(sock, jid, msg, rows.length ? `🛍️ *REFERÊNCIAS DE PREÇO*\n\n${rows.join('\n\n')}\n\nPreços podem mudar; confira a oferta antes de comprar.` : '🔎 Não encontrei ofertas para comparar.');
      return true;
    }

    if (command === 'rastreio') {
      const code = String(args || '').trim().toUpperCase();
      if (!code) { await send(sock, jid, msg, '📦 Use *!rastreio CODIGO*.'); return true; }
      const user = String(process.env.LINKETRACK_USER || '').trim();
      const token = String(process.env.LINKETRACK_TOKEN || '').trim();
      if (!user || !token) { await send(sock, jid, msg, '⚙️ O rastreio precisa das credenciais *LINKETRACK_USER* e *LINKETRACK_TOKEN* no servidor.'); return true; }
      const response = await fetch(`https://api.linketrack.com/track/json?user=${encodeURIComponent(user)}&token=${encodeURIComponent(token)}&codigo=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data?.eventos)) throw new Error('TRACKING_FAILED');
      const rows = data.eventos.slice(0, 8).map((event) => `• *${event.status || 'Atualização'}*\n  ${event.data || ''} ${event.hora || ''}${event.local ? `\n  ${event.local}` : ''}`);
      await send(sock, jid, msg, `📦 *RASTREIO ${code}*\n\n${rows.join('\n\n') || 'Sem eventos disponíveis.'}`);
      return true;
    }

    if (command === 'ddd') {
      const input = String(args || '').trim();
      if (!input) { await send(sock, jid, msg, '📞 Use *!ddd 95* ou *!ddd Boa Vista*.'); return true; }
      let ddd;
      let info;
      if (/^\d{2}$/.test(input)) {
        ddd = Number(input);
        info = await dddInfo(ddd);
      } else {
        const result = await searchDddByCity(input);
        ddd = result.ddd;
        info = result.info;
      }
      const uf = String(info?.state || '').toUpperCase();
      const stateName = STATE_NAMES[uf] || uf;
      const cities = (info?.cities || []).slice().sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const list = cities.map((city) => `• ${city}`).join('\n');
      await send(sock, jid, msg, `📞 *DDD ${ddd}*\n\n📍 Estado: *${stateName} — ${uf}*\n🏙️ Cidades atendidas (${cities.length}):\n${list}`);
      return true;
    }
  } catch (error) {
    const code = String(error?.message || error || '');
    console.error(`[ESSENTIAL UTILS] ${command}:`, code);
    if (['DDD_NOT_FOUND', 'CITY_NOT_FOUND', 'CEP_NOT_FOUND', 'CURRENCY_NOT_FOUND'].includes(code)) await send(sock, jid, msg, '🔎 Não encontrei esse dado. Confira o valor informado e tente novamente.');
    else await send(sock, jid, msg, `❌ Não consegui concluir *!${command}* agora.`);
    return true;
  }
  return false;
}
