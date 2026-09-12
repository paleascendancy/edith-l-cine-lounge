const KNOWN_COMMANDS = new Set([
  // Geral e painéis
  'menu', 'ajuda', 'menuapi', 'ping', 'status', 'config', 'regras', 'grupo',
  'perfil', 'atividade', 'ranking', 'membros', 'adm', 'menuadm', 'dono',
  'vip', 'vipstatus', 'planovip',

  // Dono
  'autorizar', 'desautorizar', 'statusgrupo', 'grupostatus', 'grupos', 'donos', 'adddono',
  'remdono', 'botnumero', 'seradm', 'sermembro', 'prefixo', 'addvip', 'remvip',
  'renovarvip', 'vips',

  // Mídia
  's', 'take', 'toimg', 'tomp3', 'tiktok', 'tktk', 'instagram',

  // Administração
  'd', 'ban', 'adv', 'advs', 'remadv', 'desadv', 'limparadv', 'logs', 'limparlogs',
  'promover', 'rebaixar', 'admins', 'fechar', 'abrir', 'antilink', 'antflood',
  'boasvindas', 'autoaceitar', 'linkgrupo', 'setdesc', 'streaming',
  'lancamentosstreaming',

  // Cinema e séries
  'filme', 'serie', 'recomendar', 'ondeassistir', 'lancamentos', 'emcartaz',
  'topfilmes', 'topseries', 'trailer', 'elenco', 'nota', 'sinopse', 'quiz',
  'duelo', 'avaliar',

  // APIs e pesquisas
  'anime', 'applemusic', 'brainly', 'dicio', 'diciourl', 'nome', 'emoji',
  'imagem', 'google', 'playstore', 'grupospublicos', 'celular', 'horoscopo',
  'pais', 'pensador', 'pinterest', 'receita', 'receitaurl', 'spotify',
  'ringtone', 'myinstants', 'tuna', 'uptodown', 'wallpaper', 'wikimedia',
  'wiki', 'youtube', 'playlist', 'nasa', 'letra', 'edith', 'gpt', 'claude',
  'dolphin', 'gemini', 'gpt4o', 'gpt4omini',

  // NOX RPG
  'rpg', 'renomear', 'personagem', 'habilidades', 'inventario', 'mapa',
  'explorar', 'viajar', 'missao', 'acao', 'evento', 'faccoes', 'reputacao',
  'historia', 'codex', 'rankingrpg'
]);

export function isKnownCommandName(command = '') {
  return KNOWN_COMMANDS.has(String(command).toLowerCase());
}

// Prefixo errado e grupo não autorizado ficam silenciosos.
// O estado do grupo só é mostrado quando o dono usa !grupostatus / !statusgrupo.
export async function explainKnownCommandIssue() {
  return false;
}

export function commandFailureReason(error, source = 'serviço externo') {
  const raw = String(error?.message || error || '').trim();
  const lower = raw.toLowerCase();

  if (raw === 'NAGATORO_KEY_MISSING') {
    return 'a chave da API Nagatoro ainda não está configurada no servidor';
  }

  if (raw === 'TMDB_NOT_CONFIGURED') {
    return 'a chave do TMDB não está configurada no servidor';
  }

  if (/HTTP_(401|403)/i.test(raw)) {
    return `a autenticação com ${source} foi recusada ou a credencial não tem permissão`;
  }

  if (/HTTP_429/i.test(raw)) {
    return `${source} atingiu o limite de requisições e precisa de alguns instantes`;
  }

  if (/HTTP_5\d\d/i.test(raw)) {
    return `${source} está com uma falha temporária no servidor`;
  }

  if (/HTTP_404/i.test(raw)) {
    return `${source} não encontrou esse recurso`;
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborterror') ||
    lower.includes('signal is aborted')
  ) {
    return `${source} demorou demais para responder`;
  }

  if (
    lower.includes('fetch failed') ||
    lower.includes('enotfound') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('connection closed') ||
    lower.includes('network')
  ) {
    return `houve uma falha de conexão com ${source}`;
  }

  if (raw.startsWith('⚠️')) {
    return raw.replace(/^⚠️\s*/u, '');
  }

  return `ocorreu uma falha inesperada ao acessar ${source}`;
}
