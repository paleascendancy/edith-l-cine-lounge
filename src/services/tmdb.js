const BASE_URL = 'https://api.themoviedb.org/3';

const genreAliases = new Map([
  ['acao', 28], ['ação', 28],
  ['aventura', 12],
  ['animacao', 16], ['animação', 16],
  ['comedia', 35], ['comédia', 35],
  ['crime', 80],
  ['documentario', 99], ['documentário', 99],
  ['drama', 18],
  ['familia', 10751], ['família', 10751],
  ['fantasia', 14],
  ['historia', 36], ['história', 36],
  ['terror', 27],
  ['musica', 10402], ['música', 10402],
  ['misterio', 9648], ['mistério', 9648],
  ['romance', 10749],
  ['ficcao cientifica', 878], ['ficção científica', 878], ['sci-fi', 878], ['scifi', 878],
  ['thriller', 53], ['suspense', 53],
  ['guerra', 10752],
  ['faroeste', 37], ['western', 37]
]);

function credentials() {
  const token = (process.env.TMDB_TOKEN || '').trim();
  const apiKey = (process.env.TMDB_API_KEY || '').trim();
  if (token) return { token };
  if (apiKey) return { apiKey };
  throw new Error('TMDB_NOT_CONFIGURED');
}

async function request(path, params = {}) {
  const auth = credentials();
  const url = new URL(`${BASE_URL}${path}`);
  const finalParams = { language: 'pt-BR', ...params };
  if (auth.apiKey) finalParams.api_key = auth.apiKey;

  for (const [key, value] of Object.entries(finalParams)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: auth.token
      ? { Authorization: `Bearer ${auth.token}`, accept: 'application/json' }
      : { accept: 'application/json' }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`TMDB_HTTP_${response.status}:${body.slice(0, 160)}`);
  }

  return response.json();
}

function year(date) {
  return date ? String(date).slice(0, 4) : '—';
}

function score(value) {
  return Number.isFinite(value) && value > 0 ? `${value.toFixed(1)}/10` : 'sem nota';
}

function genresText(genres = []) {
  return genres.length ? genres.map((g) => g.name).join(', ') : 'não informado';
}

function titleOf(item, type) {
  return type === 'tv' ? item.name : item.title;
}

function dateOf(item, type) {
  return type === 'tv' ? item.first_air_date : item.release_date;
}

async function searchOne(query, type = 'movie') {
  if (!query) return null;
  const data = await request(`/search/${type}`, {
    query,
    include_adult: false,
    region: 'BR'
  });
  return data.results?.[0] || null;
}

async function detailsBySearch(query, type = 'movie', append = '') {
  const found = await searchOne(query, type);
  if (!found) return null;
  return request(`/${type}/${found.id}`, append ? { append_to_response: append } : {});
}

export async function movieInfo(query) {
  const item = await detailsBySearch(query, 'movie');
  if (!item) return null;
  return `🎬 *${item.title}* (${year(item.release_date)})\n⭐ TMDB: *${score(item.vote_average)}*\n🎭 ${genresText(item.genres)}\n⏱️ ${item.runtime ? `${item.runtime} min` : 'duração não informada'}\n\n📝 ${item.overview || 'Sinopse não disponível em português.'}`;
}

export async function seriesInfo(query) {
  const item = await detailsBySearch(query, 'tv');
  if (!item) return null;
  return `📺 *${item.name}* (${year(item.first_air_date)})\n⭐ TMDB: *${score(item.vote_average)}*\n🎭 ${genresText(item.genres)}\n📚 ${item.number_of_seasons || '—'} temporada(s)\n\n📝 ${item.overview || 'Sinopse não disponível em português.'}`;
}

export async function synopsis(query) {
  const movie = await detailsBySearch(query, 'movie');
  if (movie) return `📝 *${movie.title}*\n\n${movie.overview || 'Sinopse não disponível em português.'}`;
  const tv = await detailsBySearch(query, 'tv');
  if (tv) return `📝 *${tv.name}*\n\n${tv.overview || 'Sinopse não disponível em português.'}`;
  return null;
}

export async function rating(query) {
  const movie = await detailsBySearch(query, 'movie');
  if (movie) return `⭐ *${movie.title}*\nTMDB: *${score(movie.vote_average)}* (${movie.vote_count || 0} votos)`;
  const tv = await detailsBySearch(query, 'tv');
  if (tv) return `⭐ *${tv.name}*\nTMDB: *${score(tv.vote_average)}* (${tv.vote_count || 0} votos)`;
  return null;
}

export async function cast(query) {
  let type = 'movie';
  let item = await searchOne(query, type);
  if (!item) {
    type = 'tv';
    item = await searchOne(query, type);
  }
  if (!item) return null;

  const credits = await request(`/${type}/${item.id}/credits`);
  const names = (credits.cast || []).slice(0, 8).map((person) => person.name);
  return `🎭 *Elenco principal — ${titleOf(item, type)}*\n\n${names.length ? names.map((n) => `• ${n}`).join('\n') : 'Elenco não disponível.'}`;
}

export async function trailer(query) {
  let type = 'movie';
  let item = await searchOne(query, type);
  if (!item) {
    type = 'tv';
    item = await searchOne(query, type);
  }
  if (!item) return null;

  let videos = await request(`/${type}/${item.id}/videos`);
  let candidates = videos.results || [];
  if (!candidates.length) {
    videos = await request(`/${type}/${item.id}/videos`, { language: 'en-US' });
    candidates = videos.results || [];
  }

  const video = candidates.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official)
    || candidates.find((v) => v.site === 'YouTube' && v.type === 'Trailer')
    || candidates.find((v) => v.site === 'YouTube');

  if (!video) return `🎞️ Não encontrei trailer disponível para *${titleOf(item, type)}*.`;
  return `🎞️ *Trailer — ${titleOf(item, type)}*\nhttps://www.youtube.com/watch?v=${video.key}`;
}

export async function watchProviders(query) {
  let type = 'movie';
  let item = await searchOne(query, type);
  if (!item) {
    type = 'tv';
    item = await searchOne(query, type);
  }
  if (!item) return null;

  const data = await request(`/${type}/${item.id}/watch/providers`, { language: undefined });
  const br = data.results?.BR;
  if (!br) return `📺 Não encontrei disponibilidade no Brasil para *${titleOf(item, type)}*.`;

  const providers = [...(br.flatrate || []), ...(br.free || []), ...(br.ads || [])]
    .map((p) => p.provider_name)
    .filter((name, index, arr) => arr.indexOf(name) === index);

  if (!providers.length) {
    return `📺 *${titleOf(item, type)}*\nNão encontrei opção de streaming por assinatura/grátis no Brasil agora.\n\nFonte de disponibilidade: JustWatch via TMDB.`;
  }

  return `📺 *Onde assistir — ${titleOf(item, type)}*\n\n${providers.map((p) => `• ${p}`).join('\n')}\n\nFonte de disponibilidade: JustWatch via TMDB.`;
}

export async function nowPlaying() {
  const data = await request('/movie/now_playing', { region: 'BR', page: 1 });
  const items = (data.results || []).slice(0, 10);
  return items.length
    ? `🍿 *Em cartaz no Brasil*\n\n${items.map((m, i) => `${i + 1}. ${m.title} (${year(m.release_date)})`).join('\n')}`
    : 'Não encontrei filmes em cartaz no momento.';
}

export async function upcoming() {
  const data = await request('/movie/upcoming', { region: 'BR', page: 1 });
  const items = (data.results || []).slice(0, 10);
  return items.length
    ? `🗓️ *Próximos lançamentos*\n\n${items.map((m, i) => `${i + 1}. ${m.title} — ${m.release_date || 'data a confirmar'}`).join('\n')}`
    : 'Não encontrei próximos lançamentos no momento.';
}

export async function recommend(genreText) {
  const normalized = genreText.trim().toLowerCase();
  const genreId = genreAliases.get(normalized);
  if (!genreId) {
    return { error: 'GENRE', supported: [...new Set([...genreAliases.keys()])].slice(0, 18) };
  }

  const data = await request('/discover/movie', {
    with_genres: genreId,
    include_adult: false,
    sort_by: 'popularity.desc',
    'vote_count.gte': 100,
    region: 'BR',
    page: Math.floor(Math.random() * 3) + 1
  });

  const pool = (data.results || []).filter((m) => m.title);
  const items = pool.sort(() => Math.random() - 0.5).slice(0, 5);
  return {
    text: items.length
      ? `🎯 *Recomendações — ${genreText}*\n\n${items.map((m, i) => `${i + 1}. ${m.title} (${year(m.release_date)}) — ⭐ ${score(m.vote_average)}`).join('\n')}`
      : 'Não encontrei recomendações para esse gênero agora.'
  };
}

export function tmdbErrorMessage(error) {
  if (error?.message === 'TMDB_NOT_CONFIGURED') {
    return '⚙️ O catálogo de cinema ainda precisa da chave TMDB no servidor. Configure *TMDB_TOKEN* ou *TMDB_API_KEY* no Railway.';
  }
  console.error('[TMDB]', error?.message || error);
  return '⚠️ Não consegui consultar o catálogo agora. Tente novamente em alguns instantes.';
}
