const DIRECT_COMMANDS = new Set([
  'anime',
  'wiki',
  'wikimedia',
  'nasa',
  'youtube',
  'spotify'
]);

function cleanText(value = '') {
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}

function truncate(value = '', max = 3000) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max - 20)}\n…` : text;
}

async function getJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return data;
}

async function sendText(sock, jid, msg, text) {
  await sock.sendMessage(jid, { text: truncate(text) }, { quoted: msg });
}

async function sendImage(sock, jid, msg, imageUrl, caption) {
  if (!imageUrl) return sendText(sock, jid, msg, caption);
  try {
    await sock.sendMessage(jid, { image: { url: imageUrl }, caption: truncate(caption) }, { quoted: msg });
  } catch {
    await sendText(sock, jid, msg, caption);
  }
}

async function animeCommand(sock, jid, msg, args) {
  if (!args.trim()) return sendText(sock, jid, msg, 'Use: *!anime Naruto*');
  const query = `query ($search: String) { Media(search: $search, type: ANIME) { title { romaji english native } description episodes status genres averageScore seasonYear siteUrl coverImage { large } } }`;
  const data = await getJson('https://graphql.anilist.co', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables: { search: args.trim() } }) });
  const media = data?.data?.Media;
  if (!media) return sendText(sock, jid, msg, '🔎 Não encontrei esse anime.');
  const title = media.title?.english || media.title?.romaji || media.title?.native || args.trim();
  const genres = Array.isArray(media.genres) ? media.genres.join(', ') : '—';
  const caption = `🎌 *${title}*\n\n⭐ Nota: ${media.averageScore ? `${media.averageScore}/100` : '—'}\n🎞️ Episódios: ${media.episodes || '—'}\n📅 Ano: ${media.seasonYear || '—'}\n📌 Status: ${media.status || '—'}\n🏷️ Gêneros: ${genres}\n\n${cleanText(media.description || 'Sem sinopse disponível.')}\n\n${media.siteUrl ? `🔗 ${media.siteUrl}` : ''}`;
  await sendImage(sock, jid, msg, media.coverImage?.large, caption);
}

async function wikiCommand(sock, jid, msg, args) {
  if (!args.trim()) return sendText(sock, jid, msg, 'Use: *!wiki assunto*');
  const url = new URL('https://pt.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: args.trim(), gsrlimit: '1', prop: 'extracts|info|pageimages', exintro: '1', explaintext: '1', inprop: 'url', piprop: 'thumbnail', pithumbsize: '700' }).toString();
  const data = await getJson(url);
  const page = Object.values(data?.query?.pages || {})[0];
  if (!page) return sendText(sock, jid, msg, '🔎 Não encontrei esse assunto na Wikipédia.');
  await sendImage(sock, jid, msg, page.thumbnail?.source, `📚 *${page.title}*\n\n${truncate(page.extract || 'Sem resumo disponível.', 2400)}\n\n${page.fullurl ? `🔗 ${page.fullurl}` : ''}`);
}

async function wikimediaCommand(sock, jid, msg, args) {
  if (!args.trim()) return sendText(sock, jid, msg, 'Use: *!wikimedia assunto*');
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: args.trim(), gsrnamespace: '6', gsrlimit: '1', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '900' }).toString();
  const data = await getJson(url);
  const page = Object.values(data?.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!page || !info) return sendText(sock, jid, msg, '🔎 Não encontrei mídia no Wikimedia Commons.');
  const description = cleanText(info.extmetadata?.ImageDescription?.value || '');
  await sendImage(sock, jid, msg, info.thumburl || info.url, `🖼️ *${String(page.title || '').replace(/^File:/i, '')}*\n\n${description ? `${truncate(description, 1500)}\n\n` : ''}🔗 ${info.descriptionurl || info.url || ''}`);
}

function normalizeNasaDate(value = '') {
  const text = String(value).trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

async function nasaCommand(sock, jid, msg, args) {
  const raw = args.trim();
  const date = raw ? normalizeNasaDate(raw) : '';
  if (raw && !date) return sendText(sock, jid, msg, 'Use: *!nasa DD-MM-AAAA* ou apenas *!nasa* para hoje.');
  const url = new URL('https://api.nasa.gov/planetary/apod');
  url.searchParams.set('api_key', process.env.NASA_API_KEY || 'DEMO_KEY');
  if (date) url.searchParams.set('date', date);
  const data = await getJson(url);
  const caption = `🚀 *${data?.title || 'NASA APOD'}*\n${data?.date ? `📅 ${data.date}\n\n` : '\n'}${truncate(data?.explanation || 'Sem descrição.', 2300)}\n\n${data?.url ? `🔗 ${data.url}` : ''}`;
  if (data?.media_type === 'image') await sendImage(sock, jid, msg, data.hdurl || data.url, caption);
  else await sendText(sock, jid, msg, caption);
}

function youtubeVideoId(value = '') {
  try {
    const url = new URL(String(value).trim());
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') return url.searchParams.get('v') || '';
      const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/i);
      return match?.[1] || '';
    }
  } catch {}
  return '';
}

async function youtubeCommand(sock, jid, msg, args) {
  const input = args.trim();
  if (!input) return sendText(sock, jid, msg, 'Use: *!youtube link do vídeo*');
  const videoId = youtubeVideoId(input);
  if (!videoId) return sendText(sock, jid, msg, '⚠️ Envie um link válido do YouTube.\nExemplo: *!youtube link do vídeo*');

  const apiKey = String(process.env.YOUTUBE_API_KEY || '').trim();
  if (!apiKey) return sendText(sock, jid, msg, '⚠️ O comando *!youtube* precisa da *YOUTUBE_API_KEY* configurada na Railway.');

  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.search = new URLSearchParams({ part: 'snippet,contentDetails,statistics', id: videoId, key: apiKey }).toString();
  const data = await getJson(url);
  const video = Array.isArray(data?.items) ? data.items[0] : null;
  if (!video) return sendText(sock, jid, msg, '🔎 Não encontrei esse vídeo ou ele não está disponível.');

  const title = cleanText(video.snippet?.title || 'Vídeo');
  const channel = cleanText(video.snippet?.channelTitle || '—');
  const canonical = `https://youtu.be/${videoId}`;
  const views = Number(video.statistics?.viewCount || 0).toLocaleString('pt-BR');
  const caption = `▶️ *YOUTUBE*\n\n*${title}*\n📺 Canal: ${channel}\n👁️ Visualizações: ${views}\n🔗 ${canonical}`;
  await sendImage(sock, jid, msg, video.snippet?.thumbnails?.high?.url || video.snippet?.thumbnails?.medium?.url, caption);
}

async function spotifyToken() {
  const clientId = String(process.env.SPOTIFY_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return '';
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => null);
  return response.ok ? String(data?.access_token || '') : '';
}

async function spotifyCommand(sock, jid, msg, args) {
  if (!args.trim()) return sendText(sock, jid, msg, 'Use: *!spotify nome da música*');
  const token = await spotifyToken();
  if (!token) return sendText(sock, jid, msg, '⚠️ O comando *!spotify* já está integrado à API oficial do Spotify, mas faltam *SPOTIFY_CLIENT_ID* e *SPOTIFY_CLIENT_SECRET* na Railway.');
  const url = new URL('https://api.spotify.com/v1/search');
  url.search = new URLSearchParams({ q: args.trim(), type: 'track', limit: '5' }).toString();
  const data = await getJson(url, { headers: { authorization: `Bearer ${token}` } });
  const tracks = Array.isArray(data?.tracks?.items) ? data.tracks.items : [];
  if (!tracks.length) return sendText(sock, jid, msg, '🔎 Não encontrei músicas no Spotify.');
  const lines = tracks.map((track, index) => `${index + 1}. *${track.name}* — ${(track.artists || []).map((artist) => artist.name).join(', ')}\n${track.external_urls?.spotify || ''}`);
  await sendText(sock, jid, msg, `🎵 *SPOTIFY*\n\n${lines.join('\n\n')}`);
}

export function isDirectSourceCommand(command = '') {
  return DIRECT_COMMANDS.has(String(command).toLowerCase());
}

export async function handleDirectSourceCommand(sock, jid, msg, command, args = '') {
  try {
    switch (String(command).toLowerCase()) {
      case 'anime': await animeCommand(sock, jid, msg, args); break;
      case 'wiki': await wikiCommand(sock, jid, msg, args); break;
      case 'wikimedia': await wikimediaCommand(sock, jid, msg, args); break;
      case 'nasa': await nasaCommand(sock, jid, msg, args); break;
      case 'youtube': await youtubeCommand(sock, jid, msg, args); break;
      case 'spotify': await spotifyCommand(sock, jid, msg, args); break;
      default: return false;
    }
  } catch (error) {
    console.error(`[DIRECT] Falha no comando ${command}:`, error?.message || error);
    await sendText(sock, jid, msg, '❌ Não consegui consultar essa fonte agora. Tente novamente em alguns instantes.');
  }
  return true;
}
