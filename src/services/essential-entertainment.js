import { scheduleEssentialSave } from './essential-state.js';

async function send(sock, jid, msg, text) {
  await sock.sendMessage(jid, { text: String(text).slice(0, 12000) }, { quoted: msg });
}

function firstText(value, depth = 0) {
  if (depth > 6 || value == null) return '';
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) { const found = firstText(item, depth + 1); if (found) return found; }
    return '';
  }
  if (typeof value === 'object') {
    for (const key of ['response', 'resposta', 'answer', 'content', 'text', 'message', 'result', 'resultado', 'data']) {
      if (value[key] != null) { const found = firstText(value[key], depth + 1); if (found) return found; }
    }
    for (const nested of Object.values(value)) { const found = firstText(nested, depth + 1); if (found) return found; }
  }
  return '';
}

async function ask(prompt) {
  const key = String(process.env.NAGATORO_API_KEY || '').trim();
  if (!key) throw new Error('AI_NOT_CONFIGURED');
  const url = new URL('/api/ia/gpt', 'https://api.nagatoro.cloud');
  url.searchParams.set('apikey', key);
  url.searchParams.set('prompt', String(prompt).slice(0, 6500));
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  if (!response.ok) throw new Error(`AI_HTTP_${response.status}`);
  const text = firstText(data);
  if (!text) throw new Error('AI_EMPTY');
  return text;
}

export const ESSENTIAL_ENTERTAINMENT_COMMANDS = new Set(['recomendaranime', 'comparar', 'curiosidade', 'seguiranime', 'listafilmes']);

export async function handleEssentialEntertainment(ctx) {
  const { sock, jid, msg, command, args, user } = ctx;
  try {
    if (command === 'recomendaranime') {
      const preference = String(args || '').trim();
      const prompt = preference
        ? `Recomende 5 animes para alguém que pediu: ${preference}. Para cada um, dê nome, gênero e um motivo curto. Não invente títulos.`
        : 'Recomende 5 animes variados e populares, misturando gêneros. Para cada um, dê nome, gênero e um motivo curto.';
      await send(sock, jid, msg, `🍥 *RECOMENDAÇÕES DE ANIME*\n\n${await ask(prompt)}`);
      return true;
    }

    if (command === 'comparar') {
      const input = String(args || '').trim();
      const parts = input.split('|').map((v) => v.trim()).filter(Boolean);
      if (parts.length < 2) { await send(sock, jid, msg, '⚖️ Use *!comparar Matrix | Interestelar*.'); return true; }
      const answer = await ask(`Compare "${parts[0]}" e "${parts[1]}" de forma objetiva: proposta, gênero, pontos fortes, para quem é indicado e qual escolher dependendo do gosto. Evite spoilers importantes.`);
      await send(sock, jid, msg, `⚖️ *COMPARAÇÃO*\n\n${answer}`);
      return true;
    }

    if (command === 'curiosidade') {
      const title = String(args || '').trim();
      if (!title) { await send(sock, jid, msg, '🎬 Use *!curiosidade Titanic*.'); return true; }
      const answer = await ask(`Dê 5 curiosidades verificáveis e interessantes sobre "${title}". Se não tiver certeza de um fato, não invente. Responda em português e evite spoilers grandes.`);
      await send(sock, jid, msg, `🎬 *CURIOSIDADES — ${title.slice(0, 80)}*\n\n${answer}`);
      return true;
    }

    if (command === 'seguiranime') {
      const input = String(args || '').trim();
      const [actionRaw = '', ...rest] = input.split(/\s+/u);
      const action = actionRaw.toLowerCase();
      if (!input || action === 'listar') {
        await send(sock, jid, msg, user.follows.anime.length ? `🍥 *ANIMES SEGUIDOS*\n\n${user.follows.anime.map((item, i) => `${i + 1}. ${item.name}`).join('\n')}` : '🍥 Você ainda não segue animes. Use *!seguiranime nome*.' );
        return true;
      }
      if (['rem', 'remove', 'parar'].includes(action)) {
        const query = rest.join(' ').trim().toLowerCase();
        const before = user.follows.anime.length;
        user.follows.anime = user.follows.anime.filter((item) => item.name.toLowerCase() !== query && String(item.id) !== query);
        scheduleEssentialSave();
        await send(sock, jid, msg, before === user.follows.anime.length ? 'ℹ️ Anime não encontrado na sua lista.' : '✅ Anime removido do acompanhamento.');
        return true;
      }
      const name = input.replace(/^add\s+/i, '').trim().slice(0, 120);
      if (!user.follows.anime.some((item) => item.name.toLowerCase() === name.toLowerCase())) user.follows.anime.push({ id: Date.now(), name, addedAt: Date.now() });
      scheduleEssentialSave();
      await send(sock, jid, msg, `✅ *${name}* foi adicionado ao seu acompanhamento. Use *!seguiranime listar*.`);
      return true;
    }

    if (command === 'listafilmes') {
      const input = String(args || '').trim();
      const [actionRaw = '', ...rest] = input.split(/\s+/u);
      const action = actionRaw.toLowerCase();
      if (!input || action === 'listar') {
        await send(sock, jid, msg, user.follows.movies.length ? `🎞️ *MINHA LISTA DE FILMES*\n\n${user.follows.movies.map((item, i) => `${i + 1}. ${item.name}`).join('\n')}` : '🎞️ Sua lista está vazia. Use *!listafilmes add Nome do filme*.' );
        return true;
      }
      if (['rem', 'remove'].includes(action)) {
        const query = rest.join(' ').trim().toLowerCase();
        const before = user.follows.movies.length;
        user.follows.movies = user.follows.movies.filter((item) => item.name.toLowerCase() !== query && String(item.id) !== query);
        scheduleEssentialSave();
        await send(sock, jid, msg, before === user.follows.movies.length ? 'ℹ️ Filme não encontrado.' : '✅ Filme removido da lista.');
        return true;
      }
      const name = (action === 'add' ? rest.join(' ') : input).trim().slice(0, 120);
      if (!name) { await send(sock, jid, msg, 'Use *!listafilmes add Nome do filme*.'); return true; }
      if (!user.follows.movies.some((item) => item.name.toLowerCase() === name.toLowerCase())) user.follows.movies.push({ id: Date.now(), name, addedAt: Date.now() });
      scheduleEssentialSave();
      await send(sock, jid, msg, `✅ *${name}* adicionado à sua lista.`);
      return true;
    }
  } catch (error) {
    console.error(`[ESSENTIAL ENTERTAINMENT] ${command}:`, error?.message || error);
    await send(sock, jid, msg, String(error?.message) === 'AI_NOT_CONFIGURED' ? '⚙️ Esse recurso precisa da chave *NAGATORO_API_KEY* no servidor.' : `❌ Não consegui concluir *!${command}* agora.`);
    return true;
  }
  return false;
}
