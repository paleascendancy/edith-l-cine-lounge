const BASE_URL = 'https://api.themoviedb.org/3';

export interface TmdbTitle {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string;
  overview: string;
}

const genreIds: Record<string, number> = {
  acao: 28, ação: 28, aventura: 12, animacao: 16, animação: 16, comedia: 35, comédia: 35,
  crime: 80, documentario: 99, documentário: 99, drama: 18, familia: 10751, família: 10751,
  fantasia: 14, historia: 36, história: 36, terror: 27, misterio: 9648, mistério: 9648,
  romance: 10749, suspense: 53, thriller: 53, guerra: 10752, faroeste: 37, scifi: 878, 'sci-fi': 878
};

function credentials(): { token?: string; apiKey?: string } {
  const token = String(process.env.TMDB_TOKEN || '').trim();
  const apiKey = String(process.env.TMDB_API_KEY || '').trim();
  if (!token && !apiKey) throw new Error('TMDB_NOT_CONFIGURED');
  return token ? { token } : { apiKey };
}

async function request(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<Record<string, unknown>> {
  const auth = credentials();
  const url = new URL(`${BASE_URL}${path}`);
  const merged = { language: 'pt-BR', region: 'BR', ...params };
  if (auth.apiKey) url.searchParams.set('api_key', auth.apiKey);
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: auth.token ? { Authorization: `Bearer ${auth.token}`, accept: 'application/json' } : { accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`TMDB_HTTP_${response.status}`);
  return await response.json() as Record<string, unknown>;
}

function mapItem(raw: unknown, mediaType: 'movie' | 'tv'): TmdbTitle | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = Number(item.id);
  const title = String(mediaType === 'tv' ? item.name || '' : item.title || '');
  const date = String(mediaType === 'tv' ? item.first_air_date || '' : item.release_date || '');
  if (!Number.isInteger(id) || !title) return null;
  return { id, mediaType, title, year: date.slice(0, 4) || '—', overview: String(item.overview || '') };
}

export async function searchTitles(query: string, preferred?: 'movie' | 'tv'): Promise<TmdbTitle[]> {
  const kinds: Array<'movie' | 'tv'> = preferred ? [preferred] : ['movie', 'tv'];
  const all: TmdbTitle[] = [];
  for (const kind of kinds) {
    const data = await request(`/search/${kind}`, { query, include_adult: false, page: 1 });
    const results = Array.isArray(data.results) ? data.results : [];
    for (const item of results.slice(0, 5)) {
      const mapped = mapItem(item, kind);
      if (mapped) all.push(mapped);
    }
  }
  return all.slice(0, 6);
}

export async function discoverMovie(genreText = ''): Promise<TmdbTitle | null> {
  const normalized = genreText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const genre = normalized ? genreIds[normalized] : undefined;
  const data = await request('/discover/movie', {
    ...(genre ? { with_genres: genre } : {}),
    include_adult: false,
    sort_by: 'popularity.desc',
    'vote_count.gte': 100,
    page: Math.floor(Math.random() * 3) + 1
  });
  const results = Array.isArray(data.results) ? data.results : [];
  const pool = results.map((item) => mapItem(item, 'movie')).filter((item): item is TmdbTitle => Boolean(item));
  return pool.length ? pool[Math.floor(Math.random() * pool.length)]! : null;
}

export function tmdbConfigured(): boolean {
  return Boolean(String(process.env.TMDB_TOKEN || process.env.TMDB_API_KEY || '').trim());
}
