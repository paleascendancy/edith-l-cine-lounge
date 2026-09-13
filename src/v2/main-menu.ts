import { readFile } from 'node:fs/promises';
import { commandRegistry, type CommandCategory, type CommandDefinition } from './registry.js';

const bannerPath = new URL('../../assets/file_000000008a38820e8f6348eb61a08540.png', import.meta.url);
let bannerCache: Buffer | null = null;

const categoryOrder: CommandCategory[] = ['painel', 'geral', 'midia'];

const categoryMeta: Record<string, { title: string; subtitle: string }> = {
  painel: { title: 'PAINÉIS', subtitle: 'Abra uma central e veja os comandos daquele módulo' },
  geral: { title: 'GERAL', subtitle: 'Perfil, status, atividade e utilidades básicas' },
  midia: { title: 'FIGURINHAS & MÍDIA', subtitle: 'Ferramentas de uso rápido e conversões' }
};

const hiddenFromMain = new Set([
  'vipstatus',
  'resumiraudio',
  'semfundo'
]);

const panelDescriptions: Record<string, string> = {
  vip: 'todos os recursos premium e status VIP',
  rpg: 'NOX • RPG persistente, exploração e progressão',
  diversao: 'créditos, desafios, conquistas, loja e recompensas',
  'filmes-series': 'busca, acompanhamento, sessões e cinema',
  menuapi: 'pesquisas, fontes e ferramentas de API'
};

function displayName(command: CommandDefinition): string {
  if (command.name === 'rpg') return 'RPG';
  return command.name;
}

function formatCommand(prefix: string, command: CommandDefinition): string {
  const args = command.args ? ` ${command.args}` : '';
  const description = panelDescriptions[command.name];
  return `┃ ◈ ${prefix}${displayName(command)}${args}${description ? ` — ${description}` : ''}`;
}

function visiblePublicMenuCommands(): CommandDefinition[] {
  return commandRegistry.filter((command) => {
    if (command.category === 'admin' || command.category === 'dono') return false;
    if (command.name === 'adm' || command.name === 'dono') return false;
    if (command.category === 'cinema' || command.category === 'comunidade' || command.category === 'privacidade') return false;
    if (command.category === 'economia' || command.category === 'nox' || command.category === 'vip') return false;
    if (hiddenFromMain.has(command.name)) return false;
    return true;
  });
}

function essentialCatalog(prefix: string): string {
  return `╭━━━〔 🆓 ESSENCIAIS 〕━━━╮\n` +
    `┃ *Mídia*\n` +
    `┃ ◈ ${prefix}tiktok link\n┃ ◈ ${prefix}instagram link\n┃ ◈ ${prefix}youtube pesquisa/link\n┃ ◈ ${prefix}s / take / ${prefix}toimg\n` +
    `┃ ◈ ${prefix}compress\n┃ ◈ ${prefix}audio / ${prefix}mp3\n┃ ◈ ${prefix}gif\n┃ ◈ ${prefix}removeaudio\n┃ ◈ ${prefix}scan\n┃ ◈ ${prefix}pdf\n┃ ◈ ${prefix}stickertexto texto\n┃ ◈ ${prefix}stickeremoji 😎\n` +
    `┃\n┃ *IA & estudo*\n` +
    `┃ ◈ ${prefix}ia pergunta\n┃ ◈ ${prefix}resumir texto/link\n┃ ◈ ${prefix}explicar tema\n┃ ◈ ${prefix}corrigir texto\n┃ ◈ ${prefix}traduzir texto\n┃ ◈ ${prefix}transcrever\n┃ ◈ ${prefix}estudar tema\n┃ ◈ ${prefix}redacao tema\n` +
    `┃\n┃ *Utilidades*\n` +
    `┃ ◈ ${prefix}contagem 25/12\n┃ ◈ ${prefix}rastreio código\n┃ ◈ ${prefix}cep CEP\n┃ ◈ ${prefix}clima cidade\n┃ ◈ ${prefix}cotacao USD\n┃ ◈ ${prefix}qr texto/link\n┃ ◈ ${prefix}encurtar link\n` +
    `┃\n┃ *Grupo*\n` +
    `┃ ◈ ${prefix}antispam on/off\n┃ ◈ ${prefix}antipalavra ...\n┃ ◈ ${prefix}despedida on/off\n┃ ◈ ${prefix}tagall\n┃ ◈ ${prefix}sorteio [quantidade]\n┃ ◈ ${prefix}enquete pergunta | op1 | op2\n┃ ◈ ${prefix}verdade / ${prefix}desafio\n┃ ◈ ${prefix}ranksemana / ${prefix}topativos\n┃ ◈ ${prefix}evento criar Nome | data\n┃ ◈ ${prefix}contador evento\n` +
    `┃\n┃ *Anime & descoberta*\n` +
    `┃ ◈ ${prefix}recomendaranime\n┃ ◈ ${prefix}comparar A | B\n┃ ◈ ${prefix}curiosidade título\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯`;
}

export function buildMainMenu(prefix = '!'): string {
  const commands = visiblePublicMenuCommands();
  const blocks: string[] = [];

  for (const category of categoryOrder) {
    const items = commands.filter((command) => command.category === category);
    if (!items.length) continue;
    const meta = categoryMeta[category] ?? { title: category.toUpperCase(), subtitle: '' };
    blocks.push(
      `╭━━━〔 ${meta.title} 〕━━━╮\n` +
      `┃ ${meta.subtitle}\n┃\n` +
      `${items.map((command) => formatCommand(prefix, command)).join('\n')}\n` +
      `╰━━━━━━━━━━━━━━━━━━━━╯`
    );
  }

  return `╭━━━〔 𝑹𝒊𝒎𝒖𝒓𝒖-𝒃𝒐𝒕 〕━━━╮\n` +
    `┃ Central de comandos\n` +
    `┃ Prefixo atual: ${prefix}\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `${blocks.join('\n\n')}\n\n` +
    `${essentialCatalog(prefix)}\n\n` +
    `💎 Recursos premium ficam dentro de *${prefix}vip*.\n` +
    `🌑 Todo o NOX fica dentro de *${prefix}RPG*.\n` +
    `🎮 Créditos e recompensas ficam dentro de *${prefix}diversao*.`;
}

export function buildFilmSeriesMenu(prefix = '!'): string {
  const sections = [
    ['BUSCA & DESCOBERTA', [
      `${prefix}filme nome`, `${prefix}serie nome`, `${prefix}recomendar`, `${prefix}ondeassistir nome`,
      `${prefix}lancamentos`, `${prefix}emcartaz`, `${prefix}topfilmes`, `${prefix}topseries`,
      `${prefix}trailer nome`, `${prefix}elenco nome`, `${prefix}nota nome`, `${prefix}sinopse nome`
    ]],
    ['ACOMPANHAMENTO', [
      `${prefix}seguirserie nome`, `${prefix}seguirlancamento nome`, `${prefix}seguindo`,
      `${prefix}pararseguir identificador`, `${prefix}minhalista`, `${prefix}assistido nome`
    ]],
    ['SESSÕES & ESCOLHAS', [
      `${prefix}roleta [gênero]`, `${prefix}sugerirfilme nome`, `${prefix}votarfilme id`, `${prefix}sessao criar|entrar|sair|status`
    ]],
    ['QUIZ & INTERAÇÃO', [`${prefix}quiz`, `${prefix}duelo`, `${prefix}avaliar`]]
  ] as const;

  return `╭━━━〔 🎬 FILMES & SÉRIES 〕━━━╮\n` +
    `┃ Busca, acompanhamento e diversão de cinema\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    sections.map(([title, commands]) => `*${title}*\n${commands.map((command) => `• ${command}`).join('\n')}`).join('\n\n');
}

export function buildFunMenu(prefix = '!'): string {
  return `╭━━━〔 🎮 DIVERSÃO & RECOMPENSAS 〕━━━╮\n` +
    `┃ Jogue, cumpra desafios, ganhe créditos e desbloqueie recompensas.\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `🎁 *PROGRESSÃO*\n` +
    `• *${prefix}diario* — resgata o bônus diário\n` +
    `• *${prefix}saldo* — mostra seus créditos\n` +
    `• *${prefix}extrato* — últimas movimentações\n` +
    `• *${prefix}desafios* — objetivos e formas de ganhar recompensas\n` +
    `• *${prefix}conquistas* — suas conquistas desbloqueadas\n\n` +
    `🛍️ *RECOMPENSAS*\n` +
    `• *${prefix}loja* — itens e benefícios disponíveis\n` +
    `• *${prefix}comprar item* — compra um item com créditos\n` +
    `• *${prefix}resgatarvip 7|30* — troca créditos por dias de VIP\n\n` +
    `🏆 *COMPETIÇÃO*\n` +
    `• *${prefix}rankingeconomia* — ranking de créditos\n\n` +
    `Atalho compatível: *${prefix}economia* abre este mesmo painel.`;
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
    if (data.length > 1000) {
      bannerCache = data;
      return data;
    }
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

export async function sendFunMenu(sock: any, jid: string, msg: any, prefix = '!'): Promise<void> {
  await sendBannerPanel(sock, jid, msg, buildFunMenu(prefix));
}
