const API_BASE = 'https://api.nagatoro.cloud';
const MAX_TEXT = 3500;

const COMMANDS = {
  menuapi: { menu: true },
  anime: { path: '/api/pesquisa/animefire', param: 'query', usage: '!anime Naruto' },
  applemusic: { path: '/api/pesquisa/apple-music', param: 'query', usage: '!applemusic Crazy in Love' },
  brainly: { path: '/api/pesquisa/brainly-questions', param: 'query', usage: '!brainly fotossíntese' },
  dicio: { path: '/api/pesquisa/dicionario', param: 'query', usage: '!dicio casa' },
  diciourl: { path: '/api/pesquisa/dicionario/get', param: 'query', usage: '!diciourl https://dicio.com.br/casa/' },
  nome: { path: '/api/pesquisa/myname', param: 'query', usage: '!nome Ana' },
  emoji: { path: '/api/pesquisa/emojigraph', param: 'emoji', usage: '!emoji 🎬' },
  imagem: { path: '/api/pesquisa/googleimage', param: 'query', usage: '!imagem Naruto', image: true },
  google: { path: '/api/pesquisa/google', param: 'query', usage: '!google JavaScript' },
  playstore: { path: '/api/pesquisa/playstore', param: 'query', usage: '!playstore Pou' },
  grupospublicos: { path: '/api/pesquisa/gerar-grupos', noArgs: true },
  celular: { path: '/api/pesquisa/gsmarena', param: 'query', usage: '!celular Galaxy S25' },
  horoscopo: { path: '/api/pesquisa/horoscopo', param: 'signo', usage: '!horoscopo libra' },
  pais: { path: '/api/pesquisa/flagpedia', param: 'query', usage: '!pais Brasil', image: true },
  pensador: { path: '/api/pesquisa/pensador', param: 'query', usage: '!pensador Motivação' },
  pinterest: { path: '/api/pesquisa/pinterest', param: 'text', usage: '!pinterest Naruto', image: true },
  receita: { path: '/api/pesquisa/cybercook', param: 'query', usage: '!receita bolo de chocolate' },
  receitaurl: { path: '/api/pesquisa/infomar-receita', param: 'url', usage: '!receitaurl URL' },
  spotify: { path: '/api/pesquisa/spotify', param: 'query', usage: '!spotify Crazy in Love' },
  ringtone: { path: '/api/pesquisa/ringtone', param: 'query', usage: '!ringtone iPhone' },
  myinstants: { path: '/api/pesquisa/myinstants', param: 'query', usage: '!myinstants meme' },
  tuna: { path: '/api/pesquisa/tuna', param: 'query', usage: '!tuna meme' },
  uptodown: { path: '/api/pesquisa/uptodown', param: 'query', usage: '!uptodown Pou' },
  wallpaper: { path: '/api/pesquisa/wallpaper', param: 'query', usage: '!wallpaper Naruto', image: true },
  wikimedia: { path: '/api/pesquisa/wikimedia', param: 'query', usage: '!wikimedia Beyoncé', image: true },
  wiki: { path: '/api/pesquisa/wikipedia', param: 'query', usage: '!wiki JavaScript' },
  youtube: { path: '/api/pesquisa/youtube', param: 'query', usage: '!youtube nome do vídeo' },
  playlist: { path: '/api/pesquisa/youtube-playlist', param: 'url', usage: '!playlist URL' },
  nasa: { path: '/api/pesquisa/nasa_apod', param: 'data', usage: '!nasa 19-10-2007', image: true },
  letra: { path: '/api/pesquisa/lyrics', param: 'query', usage: '!letra nome da música', lyricsSafe: true },
  edith: { path: '/api/ia/openai-gpt', param: 'prompt', usage: '!edith sua pergunta', ai: true },
  gpt: { path: '/api/ia/gpt', param: 'prompt', usage: '!gpt sua pergunta', ai: true },
  claude: { path: '/api/ia/claude', param: 'prompt', usage: '!claude sua pergunta', ai: true },
  dolphin: { path: '/api/ia/dolphin', param: 'prompt', usage: '!dolphin sua pergunta', ai: true, safetyPrompt: true },
  gemini: { path: '/api/ia/gemini', param: 'prompt', usage: '!gemini sua pergunta', ai: true, extra: 'gemini' },
  gpt4o: { path: '/api/ia/gpt4o', param: 'prompt', usage: '!gpt4o sua pergunta', ai: true, extra: 'groq' },
  gpt4omini: { path: '/api/ia/gpt4omini', param: 'prompt', usage: '!gpt4omini sua pergunta', ai: true, extra: 'groq' }
};

const API_MENU = `╭━━━〔 🔎 PESQUISAS & IA 〕━━━╮
┃ Comandos extras da Edith l
╰━━━━━━━━━━━━━━━━━━━━━━╯

┏━〔 PESQUISA 〕━┓
┃ !anime nome
┃ !imagem tema
┃ !google pesquisa
┃ !wiki assunto
┃ !wikimedia assunto
┃ !dicio palavra
┃ !diciourl URL
┃ !brainly pergunta
┃ !nome nome
┃ !emoji emoji
┃ !celular modelo
┃ !pais país
┃ !pensador tema
┃ !horoscopo signo
┃ !playstore app
┃ !uptodown app
┃ !grupospublicos
┗━━━━━━━━━━━━━━━━━━━━┛

┏━〔 MÚSICA & MÍDIA 〕━┓
┃ !youtube pesquisa
┃ !playlist URL
┃ !spotify música
┃ !applemusic música
┃ !myinstants pesquisa
┃ !tuna pesquisa
┃ !ringtone pesquisa
┃ !pinterest tema
┃ !wallpaper tema
┃ !letra música — trecho curto
┗━━━━━━━━━━━━━━━━━━━━┛

┏━〔 UTILIDADES 〕━┓
┃ !receita prato
┃ !receitaurl URL
┃ !nasa DD-MM-AAAA
┗━━━━━━━━━━━━━━━━━━━━┛

┏━〔 IA 〕━┓
┃ !edith pergunta
┃ !gpt pergunta
┃ !claude pergunta
┃ !dolphin pergunta
┃ !gemini pergunta
┃ !gpt4o pergunta
┃ !gpt4omini pergunta
┗━━━━━━━━━━━━━━━━━━━━┛`;

function apiKey() {
  return String(process.env.NAGATORO_API_KEY || '').trim();
}

function trimText(value, max = MAX_TEXT) {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 20)}\n… resultado reduzido`;
}

function prettifyKey(key = '') {
  return String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function unwrap(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

  for (const key of ['result', 'resultado', 'results', 'data', 'response', 'resposta']) {
    if (data[key] !== undefined && data[key] !== null) return data[key];
  }

  return data;
}

function primitiveLines(obj, depth = 0) {
  if (obj == null) return [];
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
    return [String(obj)];
  }

  if (Array.isArray(obj)) {
    return obj.slice(0, 6).flatMap((item, index) => {
      const lines = primitiveLines(item, depth + 1);
      if (!lines.length) return [];
      return lines.length === 1 ? [`${index + 1}. ${lines[0]}`] : [`${index + 1}.`, ...lines.map((line) => `   ${line}`)];
    });
  }

  if (typeof obj === 'object' && depth < 3) {
    const ignored = new Set(['status', 'success', 'code', 'apikey', 'api_key']);
    const lines = [];

    for (const [key, value] of Object.entries(obj).slice(0, 16)) {
      if (ignored.has(key.toLowerCase()) || value == null || value === '') continue;

      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        lines.push(`*${prettifyKey(key)}:* ${String(value)}`);
      } else {
        const nested = primitiveLines(value, depth + 1);
        if (nested.length) {
          lines.push(`*${prettifyKey(key)}:*`);
          lines.push(...nested.map((line) => `  ${line}`));
        }
      }
    }

    return lines;
  }

  return [];
}

function firstString(data, preferred = []) {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object') return '';

  for (const key of preferred) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  for (const value of Object.values(data)) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const nested = firstString(value, preferred);
      if (nested) return nested;
    }
  }

  return '';
}

function findImageUrl(data, depth = 0) {
  if (depth > 4 || data == null) return '';

  if (typeof data === 'string') {
    const value = data.trim();
    if (/^https?:\/\//i.test(value) && /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(value)) return value;
    return '';
  }

  if (Array.isArray(data)) {
    for (const item of data.slice(0, 10)) {
      const found = findImageUrl(item, depth + 1);
      if (found) return found;
    }
    return '';
  }

  if (typeof data === 'object') {
    const imageKeys = ['image', 'imagem', 'thumbnail', 'thumb', 'cover', 'capa', 'photo', 'foto', 'url_image', 'image_url'];
    for (const key of imageKeys) {
      if (data[key]) {
        const found = findImageUrl(data[key], depth + 1);
        if (found) return found;
      }
    }

    for (const value of Object.values(data)) {
      const found = findImageUrl(value, depth + 1);
      if (found) return found;
    }
  }

  return '';
}

function safeLyrics(data) {
  const raw = firstString(unwrap(data), ['lyrics', 'letra', 'text', 'texto']);
  if (!raw) return '🎵 Música encontrada, mas a API não retornou um trecho legível.';

  const words = raw.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const snippet = words.slice(0, 10).join(' ');

  return `🎵 *Trecho curto*\n${snippet}${words.length > 10 ? '…' : ''}\n\nA Edith não envia letras completas.`;
}

function formatResult(command, data) {
  if (command === 'letra') return safeLyrics(data);

  const clean = unwrap(data);

  if (COMMANDS[command]?.ai) {
    const answer = firstString(clean, ['response', 'resposta', 'answer', 'content', 'text', 'message', 'resultado', 'result']);
    if (answer) return trimText(answer);
  }

  const lines = primitiveLines(clean);
  if (lines.length) return trimText(lines.join('\n'));

  return '🔎 A API respondeu, mas não encontrei conteúdo legível para mostrar.';
}

function extraParams(command) {
  if (COMMANDS[command]?.extra === 'gemini') {
    const tokenGoogle = String(process.env.NAGATORO_GOOGLE_TOKEN || '').trim();
    const tokenGemini = String(process.env.NAGATORO_GEMINI_TOKEN || '').trim();
    if (!tokenGoogle) return { error: '⚠️ O comando !gemini precisa do token Google configurado.' };
    return {
      params: {
        token_google: tokenGoogle,
        token_gemini: tokenGemini
      }
    };
  }

  if (COMMANDS[command]?.extra === 'groq') {
    const tokenGroq = String(process.env.NAGATORO_GROQ_TOKEN || '').trim();
    if (!tokenGroq) return { error: `⚠️ O comando !${command} precisa do token Groq configurado.` };
    return { params: { token_groq: tokenGroq } };
  }

  return { params: {} };
}

async function requestEndpoint(command, args) {
  const definition = COMMANDS[command];
  const key = apiKey();

  if (!key) {
    throw new Error('NAGATORO_KEY_MISSING');
  }

  const url = new URL(definition.path, API_BASE);
  url.searchParams.set('apikey', key);

  const extra = extraParams(command);
  if (extra.error) throw new Error(extra.error);

  for (const [name, value] of Object.entries(extra.params || {})) {
    if (value) url.searchParams.set(name, value);
  }

  if (!definition.noArgs) {
    let value = String(args || '').trim();
    if (definition.safetyPrompt) {
      value = `Responda de forma segura e apropriada para público geral, sem conteúdo sexual explícito nem instruções perigosas ou ilegais. Pergunta: ${value}`;
    }
    url.searchParams.set(definition.param, value);
  }

  const response = await fetch(url, {
    headers: { accept: 'application/json,text/plain;q=0.9,*/*;q=0.8' },
    signal: AbortSignal.timeout(20000)
  });

  const raw = await response.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }

  if (!response.ok) {
    const detail = typeof data === 'string' ? data : firstString(data, ['message', 'error', 'erro']);
    throw new Error(`HTTP_${response.status}${detail ? `:${detail}` : ''}`);
  }

  return data;
}

async function sendText(sock, jid, msg, text) {
  await sock.sendMessage(jid, { text: trimText(text) }, { quoted: msg });
}

export function isNagatoroCommand(command = '') {
  return Object.prototype.hasOwnProperty.call(COMMANDS, String(command).toLowerCase());
}

export async function handleNagatoroCommand(sock, jid, msg, command, args = '') {
  const cmd = String(command).toLowerCase();
  const definition = COMMANDS[cmd];
  if (!definition) return false;

  if (definition.menu) {
    await sendText(sock, jid, msg, API_MENU);
    return true;
  }

  const cleanArgs = String(args || '').trim();
  if (!definition.noArgs && !cleanArgs) {
    await sendText(sock, jid, msg, `Uso: *${definition.usage}*`);
    return true;
  }

  try {
    const data = await requestEndpoint(cmd, cleanArgs);
    const text = formatResult(cmd, data);
    const imageUrl = definition.image ? findImageUrl(unwrap(data)) : '';

    if (imageUrl) {
      try {
        await sock.sendMessage(
          jid,
          { image: { url: imageUrl }, caption: trimText(text, 2800) },
          { quoted: msg }
        );
        return true;
      } catch {
        // Alguns provedores bloqueiam hotlink. Nesse caso, envia o texto normalmente.
      }
    }

    await sendText(sock, jid, msg, text);
  } catch (error) {
    const message = String(error?.message || error);

    if (message === 'NAGATORO_KEY_MISSING') {
      await sendText(sock, jid, msg, '⚠️ As novas APIs ainda precisam da chave da Nagatoro configurada pelo dono.');
      return true;
    }

    if (message.startsWith('⚠️')) {
      await sendText(sock, jid, msg, message);
      return true;
    }

    console.error(`[API] Falha no !${cmd}:`, message);
    await sendText(sock, jid, msg, '❌ Essa consulta não respondeu agora. Tente novamente em instantes.');
  }

  return true;
}
