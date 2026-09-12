import { config } from '../config.js';

function withPrimaryPrefix(text) {
  const prefix = String(config.prefix || '!');
  return String(text).replace(/!(?=[A-Za-zÀ-ÿ])/g, prefix);
}

export function menuText() {
  const prefix = String(config.prefix || '!');
  return withPrimaryPrefix(`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃          EDITH // CLC        ┃
┃       COMMAND CENTER         ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 🟢 SISTEMA ONLINE
┃ ⚡ PREFIXO: ${prefix}
┃ 👥 CINE LOUNGE CLUB
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

[01] 👥 SOCIAL
     !geral

[02] 🎨 MEDIA
     !midia

[03] 🎬 CINE
     !cinema

[04] 🧠 API & IA
     !menuapi

[05] 💎 VIP
     !vip

[06] 🌑 NOX RPG
     !RPG

[07] 🛡️ STAFF
     !adm

[08] 👑 OWNER
     !dono

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EDITH l • Sistema de assistência CLC`);
}

export function generalMenuText() {
  return withPrimaryPrefix(`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃      EDITH // SOCIAL         ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 👥 COMUNIDADE & PERFIL
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

• !menu / !ajuda
• !ping
• !status — status técnico
• !config — proteções ativas
• !regras
• !grupo
• !perfil — seu perfil
• !perfil número — consultar pelo PV
• !atividade @membro
• !ranking
• !membros

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
↩ Use !menu para voltar ao Command Center.`);
}

export function mediaMenuText() {
  return withPrimaryPrefix(`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃       EDITH // MEDIA         ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 🎨 MÍDIA & CONVERSÕES
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

• !s — figurinha
• !s -str — figurinha quadrada
• !take — marcar figurinha respondida
• !toimg — figurinha para imagem
• !tomp3 — vídeo para áudio
• !tiktok link / !tktk link
• !instagram link

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
↩ Use !menu para voltar ao Command Center.`);
}

export function cinemaMenuText() {
  return withPrimaryPrefix(`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃        EDITH // CINE         ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 🎬 FILMES & SÉRIES
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

• !filme nome
• !serie nome
• !recomendar tema
• !ondeassistir nome
• !lancamentos
• !emcartaz
• !topfilmes
• !topseries
• !trailer nome
• !elenco nome
• !nota nome
• !sinopse nome
• !quiz
• !duelo filme 1 | filme 2
• !avaliar filme nota

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
↩ Use !menu para voltar ao Command Center.`);
}

export function adminMenuText() {
  return withPrimaryPrefix(`╭━━━〔 EDITH l • ADMINISTRAÇÃO 〕━━━╮
┃ Painel administrativo do grupo
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

┏━〔 MODERAÇÃO 〕━┓
┃ !d — responder uma mensagem para apagar
┃ !ban — remover membro
┃ !adv @membro motivo
┃ !advs @membro
┃ !remadv @membro / !desadv @membro
┃ !limparadv @membro
┃ !promover
┃ !rebaixar
┃ !admins
┗━━━━━━━━━━━━━━━━━━━━┛

┏━〔 PROTEÇÕES 〕━┓
┃ !antilink on/off/status
┃ !antflood on/off/status
┃ !boasvindas on/off/status
┃ !autoaceitar on/off/status — só +55
┗━━━━━━━━━━━━━━━━━━━━┛

┏━〔 GRUPO 〕━┓
┃ !fechar
┃ !abrir
┃ !linkgrupo
┃ !setdesc Nova descrição
┃ !streaming on/off/status
┗━━━━━━━━━━━━━━━━━━━━┛

┏━〔 REGISTROS 〕━┓
┃ !logs
┃ !limparlogs
┗━━━━━━━━━━━━━━━━━━━━┛

╭━━━〔 EDITH l 〕━━━╮
┃ Abra este painel com !adm
╰━━━━━━━━━━━━━━━━━━╯`);
}
