import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { areJidsSameUser } from '@whiskeysockets/baileys';
import { isBotOwner } from './owner.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const REGION = 'BR';
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 45 * 1000;
const PROVIDER_DELAY_MS = 140;
const MAX_OVERVIEW = 520;

let stateFile = null;
let initialized = false;
let monitorTimer = null;
let monitorRunning = false;
const enabledGroups = new Set();
const seenPairs = new Set();

function tmdbCredentials() {
  const token = String(process.env.TMDB_TOKEN || '').trim();
  const apiKey = String(process.env.TMDB_API_KEY || '').trim();

  if (token) return { token };
  if (apiKey) return { apiKey };
  throw new Error('TMDB_NOT_CONFIGURED');
}

async function tmdbRequest(path, params = {}) {
  const auth = tmdbCredentials();
  const url = new URL(`${TMDB_BASE_URL}${path}`);
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function yearOf(date = '') {
  return String(date || '').slice(0, 4) || '—';
}

function formatDate(date = '') {
  if (!date) return 'data não informada';
  const match = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
}

function scoreOf(value) {
  const number = Number(value || 0);
  return number > 0 ? `${number.toFixed(1)}/10` : 'sem nota';
}

function shortOverview(value = '') {
  const text = String(value || '').trim();
  if (!text) return 'Sinopse não disponível em português.';
  if (text.length <= MAX_OVERVIEW) return text;
  return `${text.slice(0, MAX_OVERVIEW - 1).trim()}…`;
}

async function saveState() {
  if (!stateFile) return;

  await mkdir(join(stateFile, '..'), { recursive: true }).catch(() => {});
  await writeFile(
    stateFile,
    JSON.stringify(
      {
        version: 1,
        initialized,
        enabledGroups: [...enabledGroups],
        seenPairs: [...seenPairs]
      },
      null,
      2
    ),
    'utf-8'
  );
}

export async function initStreamingMonitor(authDir) {
  stateFile = join(authDir, 'streaming-monitor.json');

  try {
    const raw = await readFile(stateFile, 'utf-8');
    const saved = JSON.parse(raw);

    initialized = Boolean(saved?.initialized);

    enabledGroups.clear();
    for (const jid of saved?.enabledGroups || []) {
      if (typeof jid === 'string' && jid.endsWith('@g.us')) {
        enabledGroups.add(jid);
      }
    }

    seenPairs.clear();
    for (const pair of saved?.seenPairs || []) {
      if (typeof pair === 'string' && pair.includes(':')) {
        seenPairs.add(pair);
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[STREAMING] Falha ao carregar estado:', error?.message || error);
    }
  }
}

function participantMatches(participant, candidate) {
  const ids = [participant?.id, participant?.phoneNumber, participant?.lid].filter(Boolean);

  return ids.some((id) => {
    try {
      return areJidsSameUser(id, candidate);
    } catch {
      return String(id) === String(candidate);
    }
  });
}

async function canConfigure(sock, jid, msg) {
  if (await isBotOwner(sock, msg)) return true;
  if (!String(jid).endsWith('@g.us')) return false;

  try {
    const metadata = await sock.groupMetadata(jid);
    const candidates = [msg?.key?.participant, msg?.key?.participantAlt].filter(Boolean);
    const sender = metadata.participants.find((participant) =>
      candidates.some((candidate) => participantMatches(participant, candidate))
    );
    return Boolean(sender?.admin);
  } catch {
    return false;
  }
}

export async function handleStreamingCommand(sock, jid, msg, args = '', prefix = '!') {
  if (!String(jid).endsWith('@g.us')) {
    await sock.sendMessage(jid, { text: '🚫 Esse comando só funciona em grupos.' }, { quoted: msg });
    return;
  }

  if (!(await canConfigure(sock, jid, msg))) {
    await sock.sendMessage(
      jid,
      { text: '⛔ Apenas administradores ou o dono do bot podem alterar os avisos de streaming.' },
      { quoted: msg }
    );
    return;
  }

  const option = String(args || '').trim().toLowerCase();

  if (!['on', 'off', 'status'].includes(option)) {
    await sock.sendMessage(
      jid,
      {
        text:
          `🍿 *AVISOS DE STREAMING*\n\n` +
          `Use *${prefix}streaming on*, *${prefix}streaming off* ou *${prefix}streaming status*.`
      },
      { quoted: msg }
    );
    return;
  }

  if (option === 'status') {
    await sock.sendMessage(
      jid,
      {
        text:
          `🍿 Avisos de streaming: *${enabledGroups.has(jid) ? 'ATIVADOS' : 'DESATIVADOS'}*\n` +
          `🇧🇷 Região monitorada: *Brasil*\n` +
          `⏱️ Verificação automática: *a cada 1 hora*`
      },
      { quoted: msg }
    );
    return;
  }

  if (option === 'on') enabledGroups.add(jid);
  else enabledGroups.delete(jid);

  await saveState();

  await sock.sendMessage(
    jid,
    {
      text:
        option === 'on'
          ? '✅ *AVISOS DE STREAMING ATIVADOS*\nA Edith avisará neste grupo quando detectar novos filmes disponíveis em serviços de streaming no Brasil.'
          : '🔕 *AVISOS DE STREAMING DESATIVADOS*\nEste grupo não receberá mais avisos automáticos.'
    },
    { quoted: msg }
  );
}

async function discoverProviderMovies(providerId, sortBy) {
  const data = await tmdbRequest('/discover/movie', {
    watch_region: REGION,
    with_watch_providers: providerId,
    with_watch_monetization_types: 'flatrate',
    sort_by: sortBy,
    include_adult: false,
    page: 1
  });

  return Array.isArray(data?.results) ? data.results : [];
}

async function collectCurrentStreamingPairs() {
  const providerData = await tmdbRequest('/watch/providers/movie', {
    watch_region: REGION
  });

  const providers = (providerData?.results || [])
    .filter((provider) => provider?.provider_id && provider?.provider_name)
    .sort((a, b) => Number(a.display_priority || 999) - Number(b.display_priority || 999));

  const pairs = new Map();

  for (const provider of providers) {
    const providerId = Number(provider.provider_id);
    const providerName = String(provider.provider_name);

    try {
      const [newest, popular] = await Promise.all([
        discoverProviderMovies(providerId, 'primary_release_date.desc'),
        discoverProviderMovies(providerId, 'popularity.desc')
      ]);

      const movies = [...newest, ...popular];

      for (const movie of movies) {
        if (!movie?.id || !movie?.title) continue;

        const key = `${movie.id}:${providerId}`;
        pairs.set(key, {
          key,
          providerId,
          providerName,
          movie: {
            id: movie.id,
            title: movie.title,
            release_date: movie.release_date || '',
            vote_average: Number(movie.vote_average || 0),
            overview: movie.overview || '',
            poster_path: movie.poster_path || ''
          }
        });
      }
    } catch (error) {
      console.error(
        `[STREAMING] Falha ao consultar ${providerName}:`,
        error?.message || error
      );
    }

    await delay(PROVIDER_DELAY_MS);
  }

  return pairs;
}

function aggregateNewMovies(currentPairs) {
  const movies = new Map();

  for (const [key, entry] of currentPairs) {
    if (seenPairs.has(key)) continue;

    const movieId = String(entry.movie.id);
    let item = movies.get(movieId);

    if (!item) {
      item = {
        movie: entry.movie,
        providers: new Set()
      };
      movies.set(movieId, item);
    }

    item.providers.add(entry.providerName);
  }

  return [...movies.values()];
}

async function sendStreamingAlert(sock, groupJid, item) {
  const providers = [...item.providers].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const movie = item.movie;
  const caption =
    `🍿 *NOVO NO STREAMING*\n\n` +
    `🎬 *${movie.title}* (${yearOf(movie.release_date)})\n` +
    `📺 ${providers.join(', ')}\n` +
    `⭐ TMDB: *${scoreOf(movie.vote_average)}*\n` +
    `📅 Lançamento: *${formatDate(movie.release_date)}*\n\n` +
    `📝 ${shortOverview(movie.overview)}\n\n` +
    `🇧🇷 Disponibilidade monitorada no Brasil.`;

  if (movie.poster_path) {
    try {
      await sock.sendMessage(groupJid, {
        image: { url: `https://image.tmdb.org/t/p/w500${movie.poster_path}` },
        caption
      });
      return;
    } catch (error) {
      console.error('[STREAMING] Falha ao enviar pôster:', error?.message || error);
    }
  }

  await sock.sendMessage(groupJid, { text: caption });
}

export async function checkStreamingReleases(sock, isGroupAllowed = () => true) {
  if (monitorRunning) return { skipped: true, newMovies: 0 };
  monitorRunning = true;

  try {
    const currentPairs = await collectCurrentStreamingPairs();

    if (!initialized) {
      for (const key of currentPairs.keys()) seenPairs.add(key);
      initialized = true;
      await saveState();
      console.log(`[STREAMING] Base inicial criada com ${currentPairs.size} disponibilidades.`);
      return { seeded: true, newMovies: 0 };
    }

    const newMovies = aggregateNewMovies(currentPairs);

    for (const key of currentPairs.keys()) {
      seenPairs.add(key);
    }

    await saveState();

    if (!newMovies.length) {
      console.log('[STREAMING] Nenhum lançamento novo detectado.');
      return { newMovies: 0 };
    }

    const activeGroups = [...enabledGroups].filter((jid) => {
      try {
        return isGroupAllowed(jid);
      } catch {
        return false;
      }
    });

    for (const item of newMovies) {
      for (const groupJid of activeGroups) {
        try {
          await sendStreamingAlert(sock, groupJid, item);
        } catch (error) {
          console.error(
            `[STREAMING] Falha ao avisar ${groupJid}:`,
            error?.message || error
          );
        }
      }
    }

    console.log(
      `[STREAMING] ${newMovies.length} filme(s) novo(s) detectado(s); ${activeGroups.length} grupo(s) avisado(s).`
    );

    return { newMovies: newMovies.length, groups: activeGroups.length };
  } catch (error) {
    console.error('[STREAMING] Falha na verificação:', error?.message || error);
    return { error: error?.message || String(error), newMovies: 0 };
  } finally {
    monitorRunning = false;
  }
}

export function startStreamingMonitor(sock, isGroupAllowed = () => true) {
  stopStreamingMonitor();

  const run = () => {
    checkStreamingReleases(sock, isGroupAllowed).catch((error) => {
      console.error('[STREAMING] Erro inesperado:', error?.message || error);
    });
  };

  const firstTimer = setTimeout(run, FIRST_CHECK_DELAY_MS);
  monitorTimer = {
    firstTimer,
    interval: setInterval(run, CHECK_INTERVAL_MS)
  };
}

export function stopStreamingMonitor() {
  if (!monitorTimer) return;
  clearTimeout(monitorTimer.firstTimer);
  clearInterval(monitorTimer.interval);
  monitorTimer = null;
}
