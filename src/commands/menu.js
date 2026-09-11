import { config } from '../config.js';

function withPrimaryPrefix(text) {
  const prefix = String(config.prefix || '!');
  return String(text).replace(/!(?=[A-Za-zÀ-ÿ])/g, prefix);
}

export function menuText() {
  return withPrimaryPrefix(`╭━━━〔 EDITH l • CINE LOUNGE CLUB 〕━━━╮
┃ Assistente oficial do grupo
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

┏━〔 GERAL 〕━┓
┃ !menu
┃ !ajuda
┃ !menuapi — pesquisas, utilidades e IA
┃ !ping
┃ !status — status técnico
┃ !config — proteções ativas
┃ !regras
┃ !grupo
┃ !perfil — foto + informações
┃ !perfil número — consultar no PV
┃ !atividade @membro
┃ !ranking
┃ !membros
┗━━━━━━━━━━━━━━━━━━━━┛

┏━〔 PAINÉIS 〕━┓
┃ .adm — painel da administração
┃ .dono — painel do dono
┗━━━━━━━━━━━━━━━━━━━━┛

┏━〔 MÍDIA 〕━┓
┃ !s
┃ !s -str
┃ take — responda uma figurinha para marcar
┃ !toimg
┃ !tomp3
┃ !tiktok link / !tktk link
┃ !instagram link
┗━━━━━━━━━━━━━━━━━━━━┛

┏━〔 RPG 〕━┓
┃ NOX — Ecos do Último Mundo
┃ !RPG — abrir menu do RPG
┗━━━━━━━━━━━━━━━━━━━━┛

┏━〔 CINEMA & SÉRIES 〕━┓
┃ !filme nome
┃ !serie nome
┃ !recomendar tema
┃ !ondeassistir nome
┃ !lancamentos
┃ !emcartaz
┃ !topfilmes
┃ !topseries
┃ !trailer nome
┃ !elenco nome
┃ !nota nome
┃ !sinopse nome
┃ !quiz
┃ !duelo filme 1 | filme 2
┃ !avaliar filme nota
┗━━━━━━━━━━━━━━━━━━━━┛

╭━━━〔 EDITH l 〕━━━╮
┃ Cinema começa aqui.
╰━━━━━━━━━━━━━━━━━━╯`);
}

export function adminMenuText() {
  return withPrimaryPrefix(`╭━━━〔 EDITH l • ADMINISTRAÇÃO 〕━━━╮
┃ Painel administrativo
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

┏━〔 MODERAÇÃO 〕━┓
┃ !ban
┃ !adv @membro motivo
┃ !advs @membro
┃ !remadv @membro
┃ !desadv @membro
┃ !limparadv @membro
┃ !logs
┃ !limparlogs — limpa os registros
┃ !promover
┃ !rebaixar
┃ !admins
┗━━━━━━━━━━━━━━━━━━━━┛

┏━〔 CONTROLE DO GRUPO 〕━┓
┃ !fechar
┃ !abrir
┃ !antilink on/off/status
┃ !antflood on/off/status
┃ !boasvindas on/off/status
┃ !autoaceitar on/off/status — só +55
┃ !linkgrupo — link do grupo
┃ !setdesc Nova descrição
┗━━━━━━━━━━━━━━━━━━━━┛

╭━━━〔 EDITH l 〕━━━╮
┃ Abra este painel também com .adm
╰━━━━━━━━━━━━━━━━━━╯`);
}
