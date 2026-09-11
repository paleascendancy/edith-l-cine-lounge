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
    headers: {
      accept: 'application/json',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(20000)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }
  return data;
}

async function sendText(sock, jid, msg, text) {
  await sock.sendMessage(jid, { text: truncate(text) }, { quoted: msg });
}

async function sendImage(sock, jid, msg, imageUrl, caption) {
  if (!imageUrl) {
    await sendText(sock, jid, msg, caption);
    return;
  }

  try {
    await sock.sendMessage(
      jid,
      {
        image: { url: imageUrl },
        caption: truncate(caption)
      },
      { quoted: msg }
    );
  } catch {
    await sendText(sock, jid, msg, caption);
  }
}

async function animeCommand(sock, jid, msg, args) {
  if (!args.trim()) {
    await sendText(sock, jid, msg, 'Use: *!anime Naruto*');
    return;
  }

  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        title { romaji english native }
        description
        episodes
        status
        genres
        averageScore
        seasonYear
        siteUrl
        coverImage { large }
      }
    }
  `;

  const data = await getJson('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { search: args.trim() } })
  });

  const media = data?.data?.Media;
  if (!media) {
    await sendText(sock, jid, msg, '🔎 Não encontrei esse anime.');
    return;
  }

  const title = media.title?.english || media.title?.romaji || media.title?.native || args.trim();
  const description = cleanText(media.description || 'Sem sinopse disponível.');
  const genres = Array.isArray(media.genres) ? media.genres.join(', ') : '—';

  const caption =
    `🎌 *${title}*\n\n` +
    `⭐ Nota: ${media.averageScore ? `${media.averageScore}/100` : '—'}\n` +
    `🎞️ Episódios: ${media.episodes || '—'}\n` +
    `📅 Ano: ${media.seasonYear || '—'}\n` +
    `📌 Status: ${media.status || '—'}\n` +
    `🏷️ Gêneros: ${genres}\n\n` +
    `${description}\n\n` +
    (media.siteUrl ? `🔗 ${media.siteUrl}` : '');

  await sendImage(sock, jid, msg, media.coverImage?.large, caption);
}

async function wikiCommand(sock, jid, msg, args) {
  if (!args.trim()) {
    await sendText(sock, jid, msg, 'Use: *!wiki assunto*');
    return;
  }

  const url = new URL('https://pt.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: args.trim(),
    gsrlimit: '1',
    prop: 'extracts|info|pageimages',
    exintro: '1',
    explaintext: '1',
    inprop: 'url',
    piprop: 'thumbnail',
    pithumbsize: '700'
  }).toString();

  const data = await getJson(url);
  const pages = Object.values(data?.query?.pages || {});
  const page = pages[0];

  if (!page) {
    await sendText(sock, jid, msg, '🔎 Não encontrei esse assunto na Wikipédia.');
    return;
  }

  const caption =
    `📚 *${page.title}*\n\n` +
    `${truncate(page.extract || 'Sem resumo disponível.', 2400)}\n\n` +
    (page.fullurl ? `🔗 ${page.fullurl}` : '');

  await sendImage(sock, jid, msg, page.thumbnail?.source, caption);
}

async function wikimediaCommand(sock, jid, msg, args) {
  if (!args.trim()) {
    await sendText(sock, jid, msg, 'Use: *!wikimedia assunto*');
    return;
  }

  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: args.trim(),
    gsrnamespace: '6',
    gsrlimit: '1',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '900'
  }).toString();

  const data = await getJson(url);
  const pages = Object.values(data?.query?.pages || {});
  const page = pages[0];
  const info = page?.imageinfo?.[0];

  if (!page || !info) {
    await sendText(sock, jid, msg, '🔎 Não encontrei mídia no Wikimedia Commons.');
    return;
  }

  const description = cleanText(info.extmetadata?.ImageDescription?.value || '');
  const caption =
    `🖼️ *${String(page.title || '').replace(/^File:/i, '')}*\n\n` +
    (description ? `${truncate(description, 1500)}\n\n` : '') +
    `🔗 ${info.descriptionurl || info.url || ''}`;

  await sendImage(sock, jid, msg, info.thumburl || info.url, caption);
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

  if (raw && !date) {
    await sendText(sock, jid, msg, 'Use: *!nasa DD-MM-AAAA* ou apenas *!nasa* para hoje.');
    return;
  }

  const url = new URL('https://api.nasa.gov/planetary/apod');
  url.searchParams.set('api_key', process.env.NASA_API_KEY || 'DEMO_KEY');
  if (date) url.searchParams.set('date', date);

  const data = await getJson(url);
  const caption =
    `🚀 *${data?.title || 'NASA APOD'}*\n` +
    (data?.date ? `📅 ${data.date}\n\n` : '\n') +
    `${truncate(data?.explanation || 'Sem descrição.', 2300)}\n\n` +
    (data?.url ? `🔗 ${data.url}` : '');

  if (data?.media_type === 'image') {
    await sendImage(sock, jid, msg, data.hdurl || data.url, caption);
  } else {
    await sendText(sock, jid, msg, caption);
  }
}

async function youtubeCommand(sock, jid, msg, args) {
  if (!args.trim()) {
    await sendText(sock, jid, msg, 'Use: *!youtube nome do vídeo*');
    return;
  }

  const apiKey = String(process.env.YOUTUBE_API_KEY || '').trim();
  if (!apiKey) {
    await sendText(
      sock,
      jid,
      msg,
      '⚠️ O comando *!youtube* já está integrado à API oficial do YouTube, mas falta configurar *YOUTUBE_API_KEY* na Railway.'
    );
    return;
  }

  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.search = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: '5',
    q: args.trim(),
    key: apiKey
  }).toString();

  const data = await getJson(url);
  const items = Array.isArray(data?.items) ? data.items : [];

  if (!items.length) {
    await sendText(sock, jid, msg, '🔎 Não encontrei vídeos.');
    return;
  }

  const lines = items.map((item, index) => {
    const title = cleanText(item?.snippet?.title || 'Vídeo');
    const id = item?.id?.videoId;
    return `${index + 1}. *${title}*\nhttps://youtu.be/${id}`;
  });

  await sendText(sock, jid, msg, `▶️ *YOUTUBE*\n\n${lines.join('\n\n')}`);
}

async function spotifyToken() {
  const clientId = String(process.env.SPOTIFY_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return '';

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${auth}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000)
  });

  const data = await response.json().catch(() => null);
  return response.ok ? String(data?.access_token || '') : '';
}

async function spotifyCommand(sock, jid, msg, args) {
  if (!args.trim()) {
    await sendText(sock, jid, msg, 'Use: *!spotify nome da música*');
    return;
  }

  const token = await spotifyToken();
  if (!token) {
    await sendText(
      sock,
      jid,
      msg,
      '⚠️ O comando *!spotify* já está integrado à API oficial do Spotify, mas faltam *SPOTIFY_CLIENT_ID* e *SPOTIFY_CLIENT_SECRET* na Railway.'
    );
    return;
  }

  const url = new URL('https://api.spotify.com/v1/search');
  url.search = new URLSearchParams({
    q: args.trim(),
    type: 'track',
    limit: '5'
  }).toString();

  const data = await getJson(url, {
    headers: { authorization: `Bearer ${token}` }
  });

  const tracks = Array.isArray(data?.tracks?.items) ? data.tracks.items : [];
  if (!tracks.length) {
    await sendText(sock, jid, msg, '🔎 Não encontrei músicas no Spotify.');
    return;
  }

  const lines = tracks.map((track, index) => {
    const artists = (track.artists || []).map((artist) => artist.name).join(', ');
    return `${index + 1}. *${track.name}* — ${artists}\n${track.external_urls?.spotify || ''}`;
  });

  await sendText(sock, jid, msg, `🎵 *SPOTIFY*\n\n${lines.join('\n\n')}`);
}

export function isDirectSourceCommand(command = '') {
  return DIRECT_COMMANDS.has(String(command).toLowerCase());
}

export async function handleDirectSourceCommand(sock, jid, msg, command, args = '') {
  try {
    switch (String(command).toLowerCase()) {
      case 'anime':
        await animeCommand(sock, jid, msg, args);
        break;
      case 'wiki':
        await wikiCommand(sock, jid, msg, args);
        break;
      case 'wikimedia':
        await wikimediaCommand(sock, jid, msg, args);
        break;
      case 'nasa':
        await nasaCommand(sock, jid, msg, args);
        break;
      case 'youtube':
        await youtubeCommand(sock, jid, msg, args);
        break;
      case 'spotify':
        await spotifyCommand(sock, jid, msg, args);
        break;
      default:
        return false;
    }
  } catch (error) {
    console.error(`[DIRECT] Falha no comando ${command}:`, error?.message || error);
    await sendText(sock, jid, msg, '❌ Não consegui consultar essa fonte agora. Tente novamente em alguns instantes.');
  }

  return true;
}
