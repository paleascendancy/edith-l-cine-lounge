import { readFile } from 'node:fs/promises';
import { commandRegistry, type CommandCategory, type CommandDefinition } from './registry.js';

const bannerPath = new URL('../../assets/file_000000008a38820e8f6348eb61a08540.png', import.meta.url);
let bannerCache: Buffer | null = null;

const categoryOrder: CommandCategory[] = [
  'painel',
  'geral',
  'midia',
  'cinema',
  'economia',
  'comunidade',
  'nox',
  'vip',
  'privacidade'
];

const categoryMeta: Record<string, { title: string; subtitle: string }> = {
  painel: { title: 'PAINÉIS', subtitle: 'Atalhos para os principais módulos do bot' },
  geral: { title: 'GERAL', subtitle: 'Perfil, status, atividade e utilidades' },
  midia: { title: 'MÍDIA', subtitle: 'Figurinhas, conversões e ferramentas multimídia' },
  cinema: { title: 'CINEMA & SÉRIES', subtitle: 'Busca, recomendações, listas e acompanhamento' },
  economia: { title: 'ECONOMIA', subtitle: 'Créditos, recompensas, loja e progressão' },
  comunidade: { title: 'COMUNIDADE', subtitle: 'Sessões, sugestões e decisões coletivas' },
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
    `╭━━━〔 INFORMAÇÃO 〕━━━╮\n` +
    `┃ Comandos administrativos e de dono não aparecem neste menu.\n` +
    `┃ Use ${prefix}menu sempre que quiser abrir este painel.\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯`
  );
}

function collapsedCaption(body: string): string {
  // Mantém a prévia visual limpa: o WhatsApp mostra apenas o banner e “Ler mais”.
  // O conteúdo real aparece ao expandir a legenda.
  const maxCaptionLength = 3900;
  const clean = String(body || '').trim();
  const available = Math.max(0, maxCaptionLength - clean.length - 2);
  const fillerLength = Math.min(760, available);
  const invisible = '\u2063'.repeat(fillerLength);
  return `${invisible}\n${clean}`;
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

export async function sendMainMenu(sock: any, jid: string, msg: any, prefix = '!'): Promise<void> {
  const menu = buildMainMenu(prefix);
  const image = await bannerBuffer();

  if (image) {
    await sock.sendMessage(
      jid,
      {
        image,
        mimetype: 'image/png',
        caption: collapsedCaption(menu)
      },
      { quoted: msg }
    );
    return;
  }

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}
