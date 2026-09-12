export type CommandCategory = 'painel' | 'geral' | 'midia' | 'cinema' | 'economia' | 'comunidade' | 'nox' | 'admin' | 'dono' | 'vip' | 'privacidade';
export type Permission = 'public' | 'group' | 'admin' | 'owner' | 'vip';

export interface CommandDefinition {
  name: string;
  aliases: string[];
  args: string;
  category: CommandCategory;
  contexts: Array<'group' | 'private'>;
  permission: Permission;
  cooldownSeconds: number;
  quota: string | null;
  cost: number;
  implementation: 'legacy' | 'v2';
}

const legacy = (name: string, category: CommandCategory, permission: Permission = 'public', aliases: string[] = [], args = ''): CommandDefinition => ({
  name, aliases, args, category, contexts: ['group', 'private'], permission, cooldownSeconds: 1, quota: null, cost: 0, implementation: 'legacy'
});
const v2 = (name: string, category: CommandCategory, permission: Permission = 'public', aliases: string[] = [], args = ''): CommandDefinition => ({
  name, aliases, args, category, contexts: ['group', 'private'], permission, cooldownSeconds: 2, quota: null, cost: 0, implementation: 'v2'
});

export const commandRegistry: CommandDefinition[] = [
  legacy('menu', 'painel', 'public', ['ajuda']), legacy('adm', 'painel', 'admin'), legacy('dono', 'painel', 'owner'), legacy('vip', 'painel'), legacy('menuapi', 'painel'), legacy('rpg', 'painel'),
  legacy('ping', 'geral'), legacy('status', 'geral'), legacy('config', 'geral'), legacy('regras', 'geral'), legacy('grupo', 'geral'), legacy('perfil', 'geral', 'public', [], '[número]'), legacy('atividade', 'geral', 'group', [], '@membro'), legacy('ranking', 'geral', 'group'), legacy('membros', 'geral', 'group'),
  legacy('s', 'midia', 'public', [], '[-str]'), legacy('take', 'midia'), legacy('toimg', 'midia'), legacy('tomp3', 'midia'), legacy('tiktok', 'midia', 'public', ['tktk']), legacy('instagram', 'midia'),
  legacy('filme', 'cinema'), legacy('serie', 'cinema'), legacy('recomendar', 'cinema'), legacy('ondeassistir', 'cinema'), legacy('lancamentos', 'cinema'), legacy('emcartaz', 'cinema'), legacy('topfilmes', 'cinema'), legacy('topseries', 'cinema'), legacy('trailer', 'cinema'), legacy('elenco', 'cinema'), legacy('nota', 'cinema'), legacy('sinopse', 'cinema'), legacy('quiz', 'cinema'), legacy('duelo', 'cinema'), legacy('avaliar', 'cinema'),
  legacy('donos', 'dono', 'owner'), legacy('adddono', 'dono', 'owner'), legacy('remdono', 'dono', 'owner'), legacy('botnumero', 'dono', 'owner'), legacy('seradm', 'dono', 'owner'), legacy('sermembro', 'dono', 'owner'), legacy('autorizar', 'dono', 'owner'), legacy('desautorizar', 'dono', 'owner'), legacy('grupostatus', 'dono', 'owner'), legacy('grupos', 'dono', 'owner'), legacy('addvip', 'dono', 'owner'), legacy('renovarvip', 'dono', 'owner'), legacy('remvip', 'dono', 'owner'), legacy('vips', 'dono', 'owner'), legacy('prefixo', 'dono', 'owner'),
  legacy('d', 'admin', 'admin'), legacy('ban', 'admin', 'admin'), legacy('adv', 'admin', 'admin'), legacy('advs', 'admin', 'admin'), legacy('remadv', 'admin', 'admin', ['desadv']), legacy('limparadv', 'admin', 'admin'), legacy('promover', 'admin', 'admin'), legacy('rebaixar', 'admin', 'admin'), legacy('admins', 'admin', 'admin'), legacy('antilink', 'admin', 'admin'), legacy('antflood', 'admin', 'admin'), legacy('boasvindas', 'admin', 'admin'), legacy('autoaceitar', 'admin', 'admin'), legacy('fechar', 'admin', 'admin'), legacy('abrir', 'admin', 'admin'), legacy('linkgrupo', 'admin', 'admin'), legacy('setdesc', 'admin', 'admin'), legacy('streaming', 'admin', 'admin'), legacy('logs', 'admin', 'admin'), legacy('limparlogs', 'admin', 'admin'),
  legacy('vipstatus', 'vip'),
  v2('diario', 'economia'), v2('saldo', 'economia'), v2('extrato', 'economia'), v2('desafios', 'economia'), v2('conquistas', 'economia'), v2('loja', 'economia'), v2('comprar', 'economia', 'public', [], 'item'), v2('resgatarvip', 'economia', 'public', [], '7|30'), v2('rankingeconomia', 'economia'),
  v2('seguirserie', 'cinema', 'public', [], 'nome'), v2('seguirlancamento', 'cinema', 'public', [], 'nome'), v2('seguindo', 'cinema'), v2('pararseguir', 'cinema', 'public', [], 'identificador'), v2('agenda', 'cinema'), v2('roleta', 'cinema', 'group', [], '[gênero]'), v2('sugerirfilme', 'comunidade', 'group', [], 'nome'), v2('votarfilme', 'comunidade', 'group', [], 'id'), v2('sessao', 'comunidade', 'group', [], 'criar|entrar|sair|status'), v2('minhalista', 'cinema'), v2('assistido', 'cinema', 'public', [], 'nome'),
  v2('inativos', 'admin', 'admin', [], 'dias'), v2('limpargrupo', 'admin', 'admin', [], 'simular|confirmar|cancelar'), v2('isentar', 'admin', 'admin', [], '@membro'), v2('enqueteadm', 'admin', 'admin', [], 'pergunta | opção 1 | opção 2'),
  v2('privacidade', 'privacidade'), v2('meusdados', 'privacidade'), v2('apagardados', 'privacidade'), v2('notificacoes', 'privacidade', 'public', [], 'on|off')
];

export function commandByName(name: string): CommandDefinition | undefined {
  const normalized = name.toLowerCase();
  return commandRegistry.find((entry) => entry.name === normalized || entry.aliases.includes(normalized));
}

export function visibleCommands(input: { isOwner: boolean; isAdmin: boolean; isVip: boolean; isGroup: boolean }): CommandDefinition[] {
  return commandRegistry.filter((command) => {
    if (!command.contexts.includes(input.isGroup ? 'group' : 'private')) return false;
    if (command.permission === 'owner') return input.isOwner;
    if (command.permission === 'admin') return input.isOwner || input.isAdmin;
    if (command.permission === 'vip') return input.isOwner || input.isVip;
    if (command.permission === 'group') return input.isGroup;
    return true;
  });
}
