import { config } from '../config.js';

function withPrimaryPrefix(text) {
  const prefix = String(config.prefix || '!');
  return String(text).replace(/!(?=[A-Za-zÀ-ÿ])/g, prefix);
}

export function menuText() {
  return withPrimaryPrefix(`╭━━━〔 EDITH l • CINE LOUNGE CLUB 〕━━━╮
┃ Assistente oficial do grupo
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

┏━〔 PAINÉIS 〕━┓
┃ !adm — administração
┃ !dono — controles dos donos
┃ !vip — plano e acesso VIP
┃ !menuapi — pesquisas, utilidades e IA
┃ !RPG — NOX: Ecos do Último Mundo
┗━━━━━━━━━━━━━━━━━━━━┛

┏━〔 GERAL 〕━┓
┃ !menu / !ajuda
┃ !ping
┃ !status — status técnico
┃ !config — proteções ativas
┃ !regras
┃ !grupo
┃ !perfil — seu perfil
┃ !perfil número — consultar pelo PV
┃ !atividade @membro
┃ !ranking
┃ !membros
┗━━━━━━━━━━━━━━━━━━━━┛

┏━〔 MÍDIA 〕━┓
┃ !s — figurinha
┃ !s -str — figurinha quadrada
┃ !take — marcar figurinha respondida
┃ !toimg — figurinha para imagem
┃ !tomp3 — vídeo para áudio
┃ !tiktok link / !tktk link
┃ !instagram link
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
┃ Todos os comandos usam o mesmo prefixo.
╰━━━━━━━━━━━━━━━━━━╯`);
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
