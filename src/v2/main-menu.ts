import { readFile } from 'node:fs/promises';
import { commandByName, commandRegistry, type CommandCategory, type CommandDefinition } from './registry.js';

const bannerPath = new URL('../../assets/file_000000008a38820e8f6348eb61a08540.png', import.meta.url);
let bannerCache: Buffer | null = null;

const categoryOrder: CommandCategory[] = [
  'painel',
  'geral',
  'midia',
  'economia',
  'nox',
  'vip',
  'privacidade'
];

const categoryMeta: Record<string, { title: string; subtitle: string }> = {
  painel: { title: 'PAINÉIS', subtitle: 'Atalhos para os principais módulos do bot' },
  geral: { title: 'GERAL', subtitle: 'Perfil, status, atividade e utilidades' },
  midia: { title: 'FIGURINHAS & MÍDIA', subtitle: 'Stickers, conversões e ferramentas multimídia' },
  economia: { title: 'ECONOMIA', subtitle: 'Créditos, recompensas, loja e progressão' },
  nox: { title: 'NOX • ECOS DO ÚLTIMO MUNDO', subtitle: 'RPG persistente, exploração e progresso' },
  vip: { title: 'VIP', subtitle: 'Consulta de acesso e benefícios disponíveis' },
  privacidade: { title: 'PRIVACIDADE', subtitle: 'Controle dos seus dados e notificações' }
};

function displayName(command: CommandDefinition): string {
  if (command.name === 'rpg') return 'RPG';
  return command.name;
}

function formatCommand(prefix: string, command: CommandDefinition): string {
  const args = command.args ? ` ${command.args}` : '';
  const aliases = command.aliases.length
    ? `  ·  ${command.aliases.map((alias) => `${prefix}${alias}`).join(' / ')}`
    : '';
  return `┃ ◈ ${prefix}${displayName(command)}${args}${aliases}`;
}

function visiblePublicMenuCommands(): CommandDefinition[] {
  return commandRegistry.filter((command) => {
    if (command.category === 'admin' || command.category === 'dono') return false;
    if (command.name === 'adm' || command.name === 'dono') return false;
    if (command.category === 'cinema' || command.category === 'comunidade') return false;
    return true;
  });
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
      `┃ ${meta.subtitle}\n` +
      `┃\n` +
      `${items.map((command) => formatCommand(prefix, command)).join('\n')}\n` +
      `╰━━━━━━━━━━━━━━━━━━━━╯`
    );
  }

  return (
    `╭━━━〔 𝑹𝒊𝒎𝒖𝒓𝒖-𝒃𝒐𝒕 〕━━━╮\n` +
    `┃ Central de comandos\n` +
    `┃ Prefixo atual: ${prefix}\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `${blocks.join('\n\n')}\n\n` +
    `╭━━━〔 FILMES & SÉRIES 〕━━━╮\n` +
    `┃ Todos os recursos de cinema foram reunidos em um painel próprio.\n` +
    `┃ ◈ ${prefix}filmes-series\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯`
  );
}

function commandLine(prefix: string, name: string): string | null {
  const command = commandByName(name);
  return command ? formatCommand(prefix, command) : null;
}

function filmBlock(title: string, subtitle: string, prefix: string, names: string[]): string {
  const lines = names.map((name) => commandLine(prefix, name)).filter((line): line is string => Boolean(line));
  return (
    `╭━━━〔 ${title} 〕━━━╮\n` +
    `┃ ${subtitle}\n` +
    `┃\n` +
    `${lines.join('\n')}\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯`
  );
}

export function buildFilmSeriesMenu(prefix = '!'): string {
  const blocks = [
    filmBlock('BUSCA & DESCOBERTA', 'Informações, catálogos e recomendações', prefix, [
      'filme', 'serie', 'recomendar', 'ondeassistir', 'lancamentos', 'emcartaz',
      'topfilmes', 'topseries', 'trailer', 'elenco', 'nota', 'sinopse'
    ]),
    filmBlock('ACOMPANHAMENTO', 'Séries, lançamentos e agenda pessoal', prefix, [
      'seguirserie', 'seguirlancamento', 'seguindo', 'pararseguir', 'agenda', 'minhalista', 'assistido'
    ]),
    filmBlock('SESSÕES & ESCOLHAS', 'Tudo que antes ficava separado em comunidade', prefix, [
      'roleta', 'sugerirfilme', 'votarfilme', 'sessao'
    ]),
    filmBlock('QUIZ & INTERAÇÃO', 'Jogos e avaliações sem apostas', prefix, [
      'quiz', 'duelo', 'avaliar'
    ])
  ];

  return (
    `╭━━━〔 🎬 FILMES & SÉRIES 〕━━━╮\n` +
    `┃ Painel completo de cinema do 𝑹𝒊𝒎𝒖𝒓𝒖-𝒃𝒐𝒕\n` +
    `┃ Prefixo atual: ${prefix}\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    blocks.join('\n\n')
  );
}

function collapsedCaption(body: string): string {
  const clean = String(body || '').trim();
  // O truque de “Ler mais” precisa de comprimento, não de dezenas de quebras de linha.
  // U+200E é invisível e fica em uma única linha, evitando o enorme bloco vazio no WhatsApp.
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
    await sock.sendMessage(
      jid,
      {
        image,
        mimetype: 'image/png',
        caption: collapsedCaption(body)
      },
      { quoted: msg }
    );
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
