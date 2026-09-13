import { config } from '../config.js';
import { handleVipCommand } from '../vip.js';
import { formatProPhone, getProEntryForMessage, grantPro, listPros, normalizeProPhone, removePro, senderPrimaryPhone } from '../pro.js';
import { buildPixPayload } from './essential-utils.js';
import { createPayment, essentialUser, getOrCreateReferral, getPayment, scheduleEssentialSave, stateSnapshot, updatePayment } from './essential-state.js';

async function send(sock, jid, msg, text) {
  await sock.sendMessage(jid, { text: String(text).slice(0, 14000) }, { quoted: msg });
}

function price(name) {
  const defaults = { vip: 9.9, pro: 19.9, credits: 4.9 };
  const key = name === 'vip' ? 'VIP_PRICE' : name === 'pro' ? 'PRO_PRICE' : 'CREDITS_PRICE';
  const value = Number(String(process.env[key] || defaults[name]).replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : defaults[name];
}

function brl(value) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function planText() {
  return `╭━━━〔 💎 PLANOS RIMURU 〕━━━╮\n` +
    `┃ *FREE* — recursos essenciais do grupo\n` +
    `┃ *VIP* — ${brl(price('vip'))}/30 dias\n` +
    `┃ IA avançada, mídia HD, OCR, stickers premium, acompanhamento e limites maiores\n` +
    `┃\n` +
    `┃ *PRO* — ${brl(price('pro'))}/30 dias\n` +
    `┃ Tudo do VIP + automod, relatórios avançados, backup/restauração, personalização e !ddd\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `Use *${config.prefix}assinar vip* ou *${config.prefix}assinar pro*.`;
}

function parseCoupons() {
  const out = new Map();
  const raw = String(process.env.RIMURU_COUPONS || '').trim();
  for (const item of raw.split(',').map((v) => v.trim()).filter(Boolean)) {
    const [code, pct] = item.split(':').map((v) => v.trim());
    const discount = Number(pct);
    if (code && Number.isFinite(discount) && discount > 0 && discount <= 80) out.set(code.toUpperCase(), discount);
  }
  return out;
}

async function resolveTargetPhone(sock, msg, raw = '') {
  const direct = normalizeProPhone(String(raw).split(/\s+/u)[0]);
  if (direct) return direct;
  const context = msg?.message?.extendedTextMessage?.contextInfo || msg?.message?.imageMessage?.contextInfo || msg?.message?.videoMessage?.contextInfo || null;
  const target = context?.mentionedJid?.[0] || context?.participantAlt || context?.participant || '';
  if (!target) return '';
  if (!String(target).endsWith('@lid')) return normalizeProPhone(String(target).split('@')[0].split(':')[0]);
  try {
    const mapped = await sock.signalRepository?.lidMapping?.getPNForLID?.(target);
    return normalizeProPhone(String(mapped || '').split('@')[0].split(':')[0]);
  } catch { return ''; }
}

async function paymentMessage(ctx, plan, { targetPhone = '', days = 30 } = {}) {
  const { sock, jid, msg, user, userKey } = ctx;
  const phone = targetPhone || await senderPrimaryPhone(sock, msg);
  if (!phone) { await send(sock, jid, msg, '⚠️ Não consegui resolver seu número com segurança para gerar a cobrança.'); return true; }
  const basePrice = plan === 'pro' ? price('pro') : plan === 'credits' ? price('credits') : price('vip');
  let discount = 0;
  const coupon = String(user.pendingCoupon || '').toUpperCase();
  if (coupon) {
    const coupons = parseCoupons();
    if (coupons.has(coupon)) discount = coupons.get(coupon);
    else if (stateSnapshot().referrals[coupon]) discount = 5;
  }
  const amount = Math.max(0.01, basePrice * (1 - discount / 100));
  const payment = createPayment({ userKey, phone, targetPhone: targetPhone || phone, plan, days, amount, discount, coupon, status: 'pending' });
  user.pendingCoupon = '';
  scheduleEssentialSave();
  const pixKey = String(process.env.PIX_KEY || '').trim();
  const details = `🧾 Código: *${payment.code}*\nPlano: *${plan.toUpperCase()}*\nValor: *${brl(amount)}*${discount ? `\nDesconto: *${discount}%*` : ''}\nValidade do plano: *${days} dias*`;
  if (!pixKey) {
    await send(sock, jid, msg, `💳 *PEDIDO CRIADO*\n\n${details}\n\n⚙️ A chave PIX automática ainda não está configurada no servidor. Envie o código ao responsável após o pagamento combinado.`);
    return true;
  }
  const payload = buildPixPayload({ key: pixKey, amount, name: process.env.PIX_MERCHANT_NAME || 'RIMURU BOT', city: process.env.PIX_MERCHANT_CITY || 'BOA VISTA', txid: payment.code });
  const qr = `https://quickchart.io/qr?size=850&margin=2&text=${encodeURIComponent(payload)}`;
  await sock.sendMessage(jid, { image: { url: qr }, caption: `💠 *PIX — RIMURU*\n\n${details}\n\n*Copia e cola:*\n${payload}\n\nUse *${config.prefix}pagamento ${payment.code}* para consultar o status.` }, { quoted: msg });
  return true;
}

export const ESSENTIAL_COMMERCE_COMMANDS = new Set([
  'planos', 'assinar', 'pix', 'pagamento', 'ativar', 'indicar', 'cupom', 'creditos',
  'comprarcreditos', 'teste', 'presentear', 'renovar', 'upgrade', 'historico', 'prioridade',
  'pro', 'prostatus', 'addpro', 'rempro', 'renovarpro', 'pros'
]);

export async function handleEssentialCommerce(ctx) {
  const { sock, jid, msg, command, args, user, userKey, isOwner, isPro, isVip } = ctx;

  if (command === 'planos' || command === 'pro') {
    await send(sock, jid, msg, planText());
    return true;
  }

  if (command === 'prostatus') {
    const entry = await getProEntryForMessage(sock, msg);
    await send(sock, jid, msg, entry ? `👑 PRO: *ATIVO*\nExpira em: *${new Date(entry.expiresAt).toLocaleString('pt-BR', { timeZone: 'America/Boa_Vista' })}*` : `👑 PRO: *INATIVO*\nUse *${config.prefix}planos* para ver os planos.`);
    return true;
  }

  if (['addpro', 'rempro', 'renovarpro', 'pros'].includes(command)) {
    if (!isOwner) { await send(sock, jid, msg, '⛔ Esse comando é exclusivo do dono da Rimuru.'); return true; }
    if (command === 'pros') {
      const entries = await listPros();
      await send(sock, jid, msg, entries.length ? `👑 *PRO ATIVOS*\n\n${entries.map((entry, i) => `${i + 1}. ${formatProPhone(entry.phone)} — até ${new Date(entry.expiresAt).toLocaleDateString('pt-BR')}`).join('\n')}` : '👑 Nenhum PRO ativo.');
      return true;
    }
    const target = await resolveTargetPhone(sock, msg, args);
    if (!target) { await send(sock, jid, msg, `Use *${config.prefix}${command} 5595999999999 30* ou mencione a pessoa.`); return true; }
    if (command === 'rempro') {
      const removed = await removePro(target);
      await send(sock, jid, msg, removed ? `✅ PRO removido de *${formatProPhone(target)}*.` : 'ℹ️ Esse número não possui PRO ativo.');
      return true;
    }
    const parts = String(args || '').trim().split(/\s+/u);
    const days = Number(parts.find((part, index) => index > 0 && /^\d+$/.test(part)) || 30);
    const entry = await grantPro(target, days, { renew: command === 'renovarpro' });
    await send(sock, jid, msg, `👑 PRO *${command === 'renovarpro' ? 'RENOVADO' : 'ATIVADO'}*\nNúmero: *${formatProPhone(target)}*\nExpira em: *${new Date(entry.expiresAt).toLocaleString('pt-BR', { timeZone: 'America/Boa_Vista' })}*`);
    return true;
  }

  if (command === 'assinar' || command === 'pix') {
    const plan = String(args || '').trim().toLowerCase().split(/\s+/u)[0];
    if (!['vip', 'pro'].includes(plan)) { await send(sock, jid, msg, planText()); return true; }
    return paymentMessage(ctx, plan);
  }

  if (command === 'upgrade') {
    if (isPro) { await send(sock, jid, msg, '👑 Você já possui o plano PRO.'); return true; }
    return paymentMessage(ctx, 'pro');
  }

  if (command === 'renovar') {
    return paymentMessage(ctx, isPro ? 'pro' : 'vip');
  }

  if (command === 'pagamento') {
    const code = String(args || '').trim().toUpperCase();
    let payment = code ? getPayment(code) : null;
    if (!payment) {
      payment = Object.values(stateSnapshot().payments).filter((entry) => entry.userKey === userKey).sort((a, b) => b.createdAt - a.createdAt)[0] || null;
    }
    if (!payment) { await send(sock, jid, msg, '🧾 Nenhum pedido encontrado. Use *!assinar vip* ou *!assinar pro*.'); return true; }
    await send(sock, jid, msg, `🧾 *PAGAMENTO ${payment.code}*\nPlano: *${String(payment.plan).toUpperCase()}*\nValor: *${brl(payment.amount)}*\nStatus: *${payment.status === 'paid' ? 'ATIVADO ✅' : payment.status === 'cancelled' ? 'CANCELADO' : 'PENDENTE ⏳'}*`);
    return true;
  }

  if (command === 'ativar') {
    if (!isOwner) { await send(sock, jid, msg, '⛔ Apenas o dono pode confirmar/ativar pagamentos manualmente.'); return true; }
    const code = String(args || '').trim().toUpperCase();
    const payment = getPayment(code);
    if (!payment) { await send(sock, jid, msg, '⚠️ Código de pagamento não encontrado.'); return true; }
    if (payment.status === 'paid') { await send(sock, jid, msg, 'ℹ️ Esse pagamento já foi ativado.'); return true; }
    if (payment.plan === 'pro') {
      await grantPro(payment.targetPhone || payment.phone, payment.days || 30, { renew: true, note: `payment:${payment.code}` });
    } else if (payment.plan === 'vip') {
      await handleVipCommand(sock, jid, msg, `${config.prefix}addvip ${payment.targetPhone || payment.phone} ${payment.days || 30}`, { isOwner: true });
    } else if (payment.plan === 'credits') {
      const targetUser = essentialUser(payment.userKey);
      targetUser.credits = Number(targetUser.credits || 0) + Number(payment.credits || 100);
      scheduleEssentialSave();
    }
    updatePayment(code, { status: 'paid', paidAt: Date.now() });
    await send(sock, jid, msg, `✅ Pedido *${code}* marcado como pago e benefício ativado.`);
    return true;
  }

  if (command === 'teste') {
    if (isVip || isPro) { await send(sock, jid, msg, '💎 Seu plano já está ativo; o teste é destinado a novos usuários.'); return true; }
    if (user.trialUsed) { await send(sock, jid, msg, 'ℹ️ O teste gratuito já foi usado nesta conta.'); return true; }
    const phone = await senderPrimaryPhone(sock, msg);
    if (!phone) { await send(sock, jid, msg, '⚠️ Não consegui validar seu número para ativar o teste.'); return true; }
    user.trialUsed = true; scheduleEssentialSave();
    await handleVipCommand(sock, jid, msg, `${config.prefix}addvip ${phone} 1`, { isOwner: true });
    await send(sock, jid, msg, '🎁 Teste VIP de *24 horas* ativado.');
    return true;
  }

  if (command === 'presentear') {
    const target = await resolveTargetPhone(sock, msg, args);
    if (!target) { await send(sock, jid, msg, '🎁 Mencione uma pessoa ou informe o número. Ex.: *!presentear 5595999999999 7d*.'); return true; }
    const dayMatch = String(args || '').match(/\b(7|30|60|90)d?\b/i);
    const days = dayMatch ? Number(dayMatch[1]) : 7;
    return paymentMessage(ctx, 'vip', { targetPhone: target, days });
  }

  if (command === 'indicar') {
    const code = getOrCreateReferral(userKey);
    const info = stateSnapshot().referrals[code];
    await send(sock, jid, msg, `🤝 *SEU CÓDIGO DE INDICAÇÃO*\n*${code}*\n\nCompartilhe com amigos. Usos registrados: *${Number(info?.uses || 0)}*.`);
    return true;
  }

  if (command === 'cupom') {
    const code = String(args || '').trim().toUpperCase();
    if (!code) { await send(sock, jid, msg, '🎟️ Use *!cupom CODIGO*.'); return true; }
    const coupons = parseCoupons();
    const referral = stateSnapshot().referrals[code];
    if (!coupons.has(code) && !referral) { await send(sock, jid, msg, '❌ Cupom inválido ou expirado.'); return true; }
    user.pendingCoupon = code;
    if (referral && referral.owner !== userKey) { referral.uses = Number(referral.uses || 0) + 1; scheduleEssentialSave(); }
    await send(sock, jid, msg, `🎟️ Cupom *${code}* aplicado ao seu próximo pedido.`);
    return true;
  }

  if (command === 'creditos') {
    await send(sock, jid, msg, `💰 Créditos Rimuru: *${Number(user.credits || 0)}*.`);
    return true;
  }

  if (command === 'comprarcreditos') {
    const payment = await paymentMessage({ ...ctx, user, userKey }, 'credits');
    const recent = Object.values(stateSnapshot().payments).filter((entry) => entry.userKey === userKey && entry.plan === 'credits').sort((a, b) => b.createdAt - a.createdAt)[0];
    if (recent) { recent.credits = 100; scheduleEssentialSave(); }
    return payment;
  }

  if (command === 'historico') {
    const rows = user.history.slice(-15).reverse();
    await send(sock, jid, msg, rows.length ? `🕘 *HISTÓRICO DE COMANDOS*\n\n${rows.map((entry, i) => `${i + 1}. !${entry.command} — ${new Date(entry.at).toLocaleString('pt-BR', { timeZone: 'America/Boa_Vista' })}`).join('\n')}` : '🕘 Ainda não há histórico suficiente.');
    return true;
  }

  if (command === 'prioridade') {
    const level = isOwner || isPro ? '👑 PRO — prioridade máxima' : isVip ? '💎 VIP — prioridade alta' : '🆓 FREE — fila padrão';
    await send(sock, jid, msg, `⚡ *PRIORIDADE*\n${level}\n\nA prioridade é aplicada aos recursos pesados da suíte premium.`);
    return true;
  }

  return false;
}
