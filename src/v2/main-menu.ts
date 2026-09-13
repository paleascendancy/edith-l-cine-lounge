import { readFile } from 'node:fs/promises';
import { commandByName, commandRegistry, type CommandCategory, type CommandDefinition } from './registry.js';

const bannerPath = new URL('../../assets/file_000000008a38820e8f6348eb61a08540.png', import.meta.url);
let bannerCache: Buffer | null = null;

const categoryOrder: CommandCategory[] = ['painel', 'geral', 'midia', 'economia', 'nox', 'vip'];

const categoryMeta: Record<string, { title: string; subtitle: string }> = {
  painel: { title: 'PAINÉIS', subtitle: 'Atalhos para os principais módulos do bot' },
  geral: { title: 'GERAL', subtitle: 'Perfil, status, atividade e utilidades' },
  midia: { title: 'FIGURINHAS & MÍDIA', subtitle: 'Stickers, conversões e ferramentas multimídia' },
  economia: { title: 'ECONOMIA', subtitle: 'Créditos, recompensas, loja e progressão' },
  nox: { title: 'NOX • ECOS DO ÚLTIMO MUNDO', subtitle: 'RPG persistente, exploração e progresso' },
  vip: { title: 'VIP', subtitle: 'Consulta de acesso e benefícios disponíveis' }
};

function displayName(command: CommandDefinition): string {
  if (command.name === 'rpg') return 'RPG';
  return command.name;
}

function formatCommand(prefix: string, command: CommandDefinition): string {
  const args = command.args ? ` ${command.args}` : '';
  const aliases = command.aliases.length ? `  ·  ${command.aliases.map((alias) => `${prefix}${alias}`).join(' / ')}` : '';
  return `┃ ◈ ${prefix}${displayName(command)}${args}${aliases}`;
}

function visiblePublicMenuCommands(): CommandDefinition[] {
  return commandRegistry.filter((command) => {
    if (command.category === 'admin' || command.category === 'dono') return false;
    if (command.name === 'adm' || command.name === 'dono') return false;
    if (command.category === 'cinema' || command.category === 'comunidade' || command.category === 'privacidade') return false;
    return true;
  });
}

function essentialCatalog(prefix: string): string {
  return `╭━━━〔 🆓 FREE • ESSENCIAIS 〕━━━╮\n` +
    `┃ *Mídia*\n` +
    `┃ ◈ ${prefix}tiktok link\n┃ ◈ ${prefix}instagram link\n┃ ◈ ${prefix}youtube pesquisa/link\n┃ ◈ ${prefix}s / take / ${prefix}toimg\n` +
    `┃ ◈ ${prefix}compress\n┃ ◈ ${prefix}audio / ${prefix}mp3\n┃ ◈ ${prefix}gif\n┃ ◈ ${prefix}removeaudio\n┃ ◈ ${prefix}scan\n┃ ◈ ${prefix}pdf\n┃ ◈ ${prefix}stickertexto texto\n┃ ◈ ${prefix}stickeremoji 😎\n` +
    `┃\n┃ *IA & estudo*\n` +
    `┃ ◈ ${prefix}ia pergunta\n┃ ◈ ${prefix}resumir texto/link\n┃ ◈ ${prefix}explicar tema\n┃ ◈ ${prefix}corrigir texto\n┃ ◈ ${prefix}traduzir texto\n┃ ◈ ${prefix}transcrever\n┃ ◈ ${prefix}estudar tema\n┃ ◈ ${prefix}redacao tema\n` +
    `┃\n┃ *Utilidades*\n` +
    `┃ ◈ ${prefix}contagem 25/12\n┃ ◈ ${prefix}rastreio código\n┃ ◈ ${prefix}cep CEP\n┃ ◈ ${prefix}clima cidade\n┃ ◈ ${prefix}cotacao USD\n┃ ◈ ${prefix}qr texto/link\n┃ ◈ ${prefix}encurtar link\n` +
    `┃\n┃ *Grupo & diversão*\n` +
    `┃ ◈ ${prefix}antispam on/off\n┃ ◈ ${prefix}antipalavra ...\n┃ ◈ ${prefix}despedida on/off\n┃ ◈ ${prefix}tagall\n┃ ◈ ${prefix}sorteio [quantidade]\n┃ ◈ ${prefix}enquete pergunta | op1 | op2\n┃ ◈ ${prefix}verdade / ${prefix}desafio\n┃ ◈ ${prefix}ranksemana / ${prefix}topativos\n┃ ◈ ${prefix}evento criar Nome | data\n┃ ◈ ${prefix}contador evento\n` +
    `┃\n┃ *Cinema & anime*\n` +
    `┃ ◈ ${prefix}recomendaranime\n┃ ◈ ${prefix}comparar A | B\n┃ ◈ ${prefix}curiosidade título\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `╭━━━〔 💎 VIP 〕━━━╮\n` +
    `┃ ◈ ${prefix}hd\n┃ ◈ ${prefix}melhorar\n┃ ◈ ${prefix}semfundo\n┃ ◈ ${prefix}stickerhd\n┃ ◈ ${prefix}stickerpack nome\n┃ ◈ ${prefix}marca nome\n┃ ◈ ${prefix}stickergif\n` +
    `┃ ◈ ${prefix}resumiraudio\n┃ ◈ ${prefix}imagem descrição\n┃ ◈ ${prefix}analisar\n┃ ◈ ${prefix}pdfia pergunta\n┃ ◈ ${prefix}flashcards texto\n┃ ◈ ${prefix}ocr\n` +
    `┃ ◈ ${prefix}salvarlink\n┃ ◈ ${prefix}pixqr chave valor\n┃ ◈ ${prefix}compararpreco produto\n┃ ◈ ${prefix}seguiranime nome\n┃ ◈ ${prefix}listafilmes\n` +
    `┃ ◈ ${prefix}tagativos\n┃ ◈ ${prefix}inativos dias\n┃ ◈ ${prefix}relatorio\n┃ ◈ ${prefix}historico\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `╭━━━〔 👑 PRO 〕━━━╮\n` +
    `┃ Tudo do VIP + ferramentas avançadas\n┃ ◈ ${prefix}automod on/off\n┃ ◈ ${prefix}limpargrupo simular/confirmar\n┃ ◈ ${prefix}relatorio semanal\n` +
    `┃ ◈ ${prefix}backupgrupo\n┃ ◈ ${prefix}restaurargrupo\n┃ ◈ ${prefix}personalizarbot ...\n┃ ◈ ${prefix}ddd 95\n┃ ◈ ${prefix}ddd Boa Vista\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `╭━━━〔 💳 PLANOS & CONTA 〕━━━╮\n` +
    `┃ ◈ ${prefix}planos\n┃ ◈ ${prefix}assinar vip|pro\n┃ ◈ ${prefix}pagamento código\n┃ ◈ ${prefix}teste\n┃ ◈ ${prefix}indicar\n┃ ◈ ${prefix}cupom código\n┃ ◈ ${prefix}creditos\n┃ ◈ ${prefix}comprarcreditos\n┃ ◈ ${prefix}upgrade\n┃ ◈ ${prefix}renovar\n┃ ◈ ${prefix}presentear @pessoa 7d\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯`;
}

export function buildMainMenu(prefix = '!'): string {
  const commands = visiblePublicMenuCommands();
  const blocks: string[] = [];
  for (const category of categoryOrder) {
    const items = commands.filter((command) => command.category === category);
    if (!items.length) continue;
    const meta = categoryMeta[category] ?? { title: category.toUpperCase(), subtitle: '' };
    blocks.push(`╭━━━〔 ${meta.title} 〕━━━╮\n┃ ${meta.subtitle}\n┃\n${items.map((command) => formatCommand(prefix, command)).join('\n')}\n╰━━━━━━━━━━━━━━━━━━━━╯`);
  }
  return `╭━━━〔 𝑹𝒊𝒎𝒖𝒓𝒖-𝒃𝒐𝒕 〕━━━╮\n┃ Central de comandos\n┃ Prefixo atual: ${prefix}\n╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n${blocks.join('\n\n')}\n\n${essentialCatalog(prefix)}\n\n╭━━━〔 FILMES & SÉRIES 〕━━━╮\n┃ Todos os recursos de cinema foram reunidos em um painel próprio.\n┃ ◈ ${prefix}filmes-series\n╰━━━━━━━━━━━━━━━━━━━━╯`;
}

function commandLine(prefix: string, name: string): string | null {
  const command = commandByName(name);
  return command ? formatCommand(prefix, command) : null;
}

function filmBlock(title: string, subtitle: string, prefix: string, names: string[]): string {
  const lines = names.map((name) => commandLine(prefix, name)).filter((line): line is string => Boolean(line));
  return `╭━━━〔 ${title} 〕━━━╮\n┃ ${subtitle}\n┃\n${lines.join('\n')}\n╰━━━━━━━━━━━━━━━━━━━━╯`;
}

export function buildFilmSeriesMenu(prefix = '!'): string {
  const blocks = [
    filmBlock('BUSCA & DESCOBERTA', 'Informações, catálogos e recomendações', prefix, ['filme', 'serie', 'recomendar', 'ondeassistir', 'lancamentos', 'emcartaz', 'topfilmes', 'topseries', 'trailer', 'elenco', 'nota', 'sinopse']),
    filmBlock('ACOMPANHAMENTO', 'Séries e lançamentos pessoais', prefix, ['seguirserie', 'seguirlancamento', 'seguindo', 'pararseguir', 'minhalista', 'assistido']),
    filmBlock('SESSÕES & ESCOLHAS', 'Recursos coletivos de cinema', prefix, ['roleta', 'sugerirfilme', 'votarfilme', 'sessao']),
    filmBlock('QUIZ & INTERAÇÃO', 'Jogos e avaliações sem apostas', prefix, ['quiz', 'duelo', 'avaliar'])
  ];
  return `╭━━━〔 🎬 FILMES & SÉRIES 〕━━━╮\n┃ Painel completo de cinema do 𝑹𝒊𝒎𝒖𝒓𝒖-𝒃𝒐𝒕\n┃ Prefixo atual: ${prefix}\n╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n${blocks.join('\n\n')}`;
}

function collapsedCaption(body: string): string {
  const clean = String(body || '').trim();
  const readMoreTrigger = '\u200e'.repeat(4001);
  return `${readMoreTrigger}\n${clean}`;
}

async function bannerBuffer(): Promise<Buffer | null> {
  if (bannerCache) return bannerCache;
  try {
    const data = await readFile(bannerPath);
    if (data.length > 1000) { bannerCache = data; return data; }
  } catch (error) {
    console.error('[MENU V2] Falha ao carregar banner:', error instanceof Error ? error.message : error);
  }
  return null;
}

async function sendBannerPanel(sock: any, jid: string, msg: any, body: string): Promise<void> {
  const image = await bannerBuffer();
  if (image) {
    await sock.sendMessage(jid, { image, mimetype: 'image/png', caption: collapsedCaption(body) }, { quoted: msg });
    return;
  }
  await sock.sendMessage(jid, { text: body }, { quoted: msg });
}

export async function sendMainMenu(sock: any, jid: string, msg: any, prefix = '!'): Promise<void> {
  await sendBannerPanel(sock, jid, msg, buildMainMenu(prefix));
}

export async function sendFilmSeriesMenu(sock: any, jid: string, msg: any, prefix = '!'): Promise<void> {
  await sendBannerPanel(sock, jid, msg, buildFilmSeriesMenu(prefix));
}
