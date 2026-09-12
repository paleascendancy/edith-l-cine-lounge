export interface CapabilityContext {
  sock: any;
  jid: string;
  msg: any;
  prefix: string;
  isVip: boolean;
  isOwner: boolean;
}

export const quotaDefaults = {
  cinemaQueries: { common: 20, vip: null },
  basicStickers: { common: 20, vip: null },
  transcriptionMinutes: { common: 5, vip: 60 },
  backgroundRemoval: { common: 3, vip: 30 },
  imageGeneration: { common: 1, vip: 10 },
  ttsMinutes: { common: 2, vip: 20 },
  followedSeries: { common: 3, vip: 30 },
  personalLists: { common: 1, vip: 10 }
} as const;

async function send(ctx: CapabilityContext, text: string): Promise<void> {
  await ctx.sock.sendMessage(ctx.jid, { text }, { quoted: ctx.msg });
}

function planLabel(ctx: CapabilityContext): 'VIP' | 'COMUM' {
  return ctx.isVip || ctx.isOwner ? 'VIP' : 'COMUM';
}

function providerState(name: 'transcription' | 'background' | 'image' | 'tts'): string {
  const map = {
    transcription: String(process.env.TRANSCRIPTION_PROVIDER || '').trim(),
    background: String(process.env.BACKGROUND_REMOVAL_PROVIDER || '').trim(),
    image: String(process.env.IMAGE_PROVIDER || '').trim(),
    tts: String(process.env.TTS_PROVIDER || '').trim()
  };
  return map[name] ? 'configurado, mas sem adaptador validado neste build' : 'não configurado';
}

export async function handleCapabilityCommand(ctx: CapabilityContext, command: string, args: string): Promise<boolean> {
  if (command === 'meuslimites') {
    const vip = ctx.isVip || ctx.isOwner;
    const unlimited = 'sem quota diária comercial*';
    await send(
      ctx,
      `📊 *MEUS LIMITES — ${planLabel(ctx)}*\n\n` +
      `Cinema: *${vip ? unlimited : `${quotaDefaults.cinemaQueries.common}/dia`}*\n` +
      `Stickers: *${vip ? unlimited : `${quotaDefaults.basicStickers.common}/dia`}*\n` +
      `Transcrição: *${vip ? quotaDefaults.transcriptionMinutes.vip : quotaDefaults.transcriptionMinutes.common} min/dia*\n` +
      `Remoção de fundo: *${vip ? quotaDefaults.backgroundRemoval.vip : quotaDefaults.backgroundRemoval.common}/dia*\n` +
      `Imagens: *${vip ? quotaDefaults.imageGeneration.vip : quotaDefaults.imageGeneration.common}/dia*\n` +
      `Voz sintética: *${vip ? quotaDefaults.ttsMinutes.vip : quotaDefaults.ttsMinutes.common} min/dia*\n` +
      `Séries acompanhadas: *${vip ? quotaDefaults.followedSeries.vip : quotaDefaults.followedSeries.common}*\n` +
      `Listas pessoais: *${vip ? quotaDefaults.personalLists.vip : quotaDefaults.personalLists.common}*\n\n` +
      `*Sem quota comercial ainda respeita cooldown, concorrência, fornecedor e uso justo.\n` +
      `IA/mídia avançada só consome quota quando houver adaptador validado e o job concluir com sucesso.`
    );
    return true;
  }

  if (command === 's' && /(^|\s)-semfundo(\s|$)/i.test(args)) {
    await send(ctx, `🧩 *STICKER SEM FUNDO*\nO motor de segmentação ainda não está habilitado neste deploy. Nenhuma quota foi consumida.\nUse *${ctx.prefix}s* normalmente enquanto isso.`);
    return true;
  }

  const blocked: Record<string, { label: string; state: string; example: string }> = {
    transcrever: { label: 'Transcrição', state: providerState('transcription'), example: `Responda um áudio com *${ctx.prefix}transcrever*.` },
    resumiraudio: { label: 'Resumo de áudio', state: providerState('transcription'), example: `Responda um áudio com *${ctx.prefix}resumiraudio*.` },
    semfundo: { label: 'Remoção de fundo', state: providerState('background'), example: `Responda uma imagem com *${ctx.prefix}semfundo*.` },
    draw: { label: 'Geração de imagem', state: providerState('image'), example: `Use *${ctx.prefix}draw descrição*.` },
    voz: { label: 'Voz sintética', state: providerState('tts'), example: `Use *${ctx.prefix}voz narrador épico texto*.` }
  };

  const item = blocked[command];
  if (!item) return false;
  await send(
    ctx,
    `⚙️ *${item.label.toUpperCase()} INDISPONÍVEL*\n\nFornecedor: *${item.state}*.\nO comando está registrado, mas não vou simular resultado nem cobrar quota sem integração verificada.\n\n${item.example}`
  );
  return true;
}
