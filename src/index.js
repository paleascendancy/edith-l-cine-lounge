import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from './config.js';
import { menuText } from './commands/menu.js';
import {
  movieInfo,
  seriesInfo,
  synopsis,
  rating,
  cast,
  trailer,
  watchProviders,
  nowPlaying,
  upcoming,
  recommend,
  tmdbErrorMessage
} from './services/tmdb.js';

const logger = pino({ level: 'silent' });
const authDir = process.env.AUTH_DIR || 'auth';
const pairingNumber = (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, '');
let pairingCodeRequested = false;

const pendingQuiz = new Map();
const ratings = new Map();

const quizzes = [
  {
    question: 'Qual filme venceu o Oscar de Melhor Filme em 2020?',
    options: ['A) 1917', 'B) Parasita', 'C) Coringa', 'D) Era Uma Vez em... Hollywood'],
    answer: 'B',
    explanation: 'Parasita venceu o Oscar de Melhor Filme na cerimônia de 2020.'
  },
  {
    question: 'Quem dirigiu Interestelar?',
    options: ['A) Christopher Nolan', 'B) Denis Villeneuve', 'C) James Cameron', 'D) Steven Spielberg'],
    answer: 'A',
    explanation: 'Interestelar foi dirigido por Christopher Nolan.'
  },
  {
    question: 'Em qual universo se passa a série The Mandalorian?',
    options: ['A) Star Trek', 'B) Marvel', 'C) Star Wars', 'D) Duna'],
    answer: 'C',
    explanation: 'The Mandalorian faz parte do universo de Star Wars.'
  },
  {
    question: 'Qual destes é um filme de animação do Studio Ghibli?',
    options: ['A) Your Name', 'B) A Viagem de Chihiro', 'C) Akira', 'D) Paprika'],
    answer: 'B',
    explanation: 'A Viagem de Chihiro é uma produção do Studio Ghibli.'
  }
];

const rulesText = `📜 *REGRAS • CINE LOUNGE CLUB*\n\n1. Respeite todos os membros.\n2. Discussões sobre filmes e séries são bem-vindas, ataques pessoais não.\n3. Avise antes de spoilers e evite revelar pontos importantes sem aviso.\n4. Nada de spam, flood ou divulgação sem autorização.\n5. Mantenha o conteúdo relacionado ao propósito do grupo.\n6. Siga as orientações da administração.\n\n🎬 Bom filme e boa conversa!`;

const groupText = `🎬 *CINE LOUNGE CLUB*\n\nComunidade para conversar sobre filmes e séries, trocar recomendações, comentar lançamentos, teorias, curiosidades e descobrir novos títulos.\n\nUse *!menu* para ver os comandos disponíveis.`;

function getText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ''
  ).trim();
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function parseCommand(text) {
  const body = text.slice(config.prefix.length).trim();
  const firstSpace = body.indexOf(' ');

  if (firstSpace === -1) {
    return { command: body.toLowerCase(), args: '' };
  }

  return {
    command: body.slice(0, firstSpace).toLowerCase(),
    args: body.slice(firstSpace + 1).trim()
  };
}

async function send(sock, jid, text, msg) {
  await sock.sendMessage(jid, { text }, { quoted: msg });
}

async function handleQuizAnswer(sock, jid, text, msg) {
  const quiz = pendingQuiz.get(jid);
  if (!quiz) return false;

  const answer = text.trim().toUpperCase();
  if (!['A', 'B', 'C', 'D'].includes(answer)) return false;

  pendingQuiz.delete(jid);

  if (answer === quiz.answer) {
    await send(sock, jid, `✅ *Acertou!*\n${quiz.explanation}`, msg);
  } else {
    await send(sock, jid, `❌ Não foi dessa vez. A resposta correta era *${quiz.answer}*.\n${quiz.explanation}`, msg);
  }

  return true;
}

async function runTmdbCommand(sock, jid, msg, action) {
  try {
    const result = await action();
    if (!result) {
      await send(sock, jid, '🔎 Não encontrei esse título. Confira o nome e tente novamente.', msg);
      return;
    }
    await send(sock, jid, result, msg);
  } catch (error) {
    await send(sock, jid, tmdbErrorMessage(error), msg);
  }
}

async function startEdith() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: state,
    logger
  });

  if (!state.creds.registered && pairingNumber && !pairingCodeRequested) {
    pairingCodeRequested = true;
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairingNumber);
        console.log(`PAIRING_CODE=${code}`);
      } catch (error) {
        pairingCodeRequested = false;
        console.error('Falha ao gerar código de pareamento:', error?.message || error);
      }
    }, 2000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      pairingCodeRequested = false;
      console.log(`${config.botName} conectada ao WhatsApp.`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('Conexão encerrada.', shouldReconnect ? 'Reconectando...' : 'Sessão desconectada.');
      if (shouldReconnect) startEdith();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const jid = msg.key.remoteJid;
      const text = getText(msg.message);
      if (!jid || !text) continue;

      if (await handleQuizAnswer(sock, jid, text, msg)) continue;
      if (!text.startsWith(config.prefix)) continue;

      const { command, args } = parseCommand(text);
      if (!command) continue;

      switch (command) {
        case 'menu':
        case 'ajuda':
          await send(sock, jid, menuText(), msg);
          break;

        case 'ping':
          await send(sock, jid, '🏓 Pong! Edith l está funcionando.', msg);
          break;

        case 'regras':
          await send(sock, jid, rulesText, msg);
          break;

        case 'grupo':
          await send(sock, jid, groupText, msg);
          break;

        case 'filme':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}filme Interestelar*`, msg);
            break;
          }
          await runTmdbCommand(sock, jid, msg, () => movieInfo(args));
          break;

        case 'serie':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}serie Dark*`, msg);
            break;
          }
          await runTmdbCommand(sock, jid, msg, () => seriesInfo(args));
          break;

        case 'sinopse':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}sinopse Clube da Luta*`, msg);
            break;
          }
          await runTmdbCommand(sock, jid, msg, () => synopsis(args));
          break;

        case 'nota':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}nota Parasita*`, msg);
            break;
          }
          await runTmdbCommand(sock, jid, msg, () => rating(args));
          break;

        case 'elenco':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}elenco Batman*`, msg);
            break;
          }
          await runTmdbCommand(sock, jid, msg, () => cast(args));
          break;

        case 'trailer':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}trailer Oppenheimer*`, msg);
            break;
          }
          await runTmdbCommand(sock, jid, msg, () => trailer(args));
          break;

        case 'ondeassistir':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}ondeassistir Duna*`, msg);
            break;
          }
          await runTmdbCommand(sock, jid, msg, () => watchProviders(args));
          break;

        case 'emcartaz':
          await runTmdbCommand(sock, jid, msg, nowPlaying);
          break;

        case 'lancamentos':
          await runTmdbCommand(sock, jid, msg, upcoming);
          break;

        case 'recomendar':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}recomendar ficção científica*`, msg);
            break;
          }
          try {
            const result = await recommend(args);
            if (result?.error === 'GENRE') {
              await send(sock, jid, '🎭 Gênero não reconhecido. Exemplos: ação, aventura, comédia, drama, fantasia, terror, romance, suspense, animação, documentário ou ficção científica.', msg);
              break;
            }
            await send(sock, jid, result?.text || 'Não encontrei recomendações agora.', msg);
          } catch (error) {
            await send(sock, jid, tmdbErrorMessage(error), msg);
          }
          break;

        case 'quiz': {
          const quiz = randomItem(quizzes);
          pendingQuiz.set(jid, quiz);
          await send(
            sock,
            jid,
            `🎲 *QUIZ CINE LOUNGE*\n\n${quiz.question}\n\n${quiz.options.join('\n')}\n\nResponda somente com *A*, *B*, *C* ou *D*.`,
            msg
          );
          break;
        }

        case 'duelo': {
          const [left, right] = args.split('|').map((item) => item?.trim()).filter(Boolean);
          if (!left || !right) {
            await send(sock, jid, `Exemplo: *${config.prefix}duelo Interestelar | Matrix*`, msg);
            break;
          }

          await send(
            sock,
            jid,
            `⚔️ *DUELO DE FILMES*\n\n🎬 A: *${left}*\n🎬 B: *${right}*\n\nQual vence? Responda com *A* ou *B* e diga o motivo.`,
            msg
          );
          break;
        }

        case 'avaliar': {
          const match = args.match(/^(.*)\s+(10(?:\.0)?|[0-9](?:\.\d)?)$/);
          if (!match) {
            await send(sock, jid, `Exemplo: *${config.prefix}avaliar Interestelar 9.5*`, msg);
            break;
          }

          const title = match[1].trim();
          const score = Number(match[2]);
          if (!title || score < 0 || score > 10) {
            await send(sock, jid, 'A nota precisa estar entre *0 e 10*.', msg);
            break;
          }

          const key = `${jid}:${title.toLowerCase()}`;
          ratings.set(key, { title, score, updatedAt: Date.now() });
          await send(sock, jid, `⭐ Avaliação registrada: *${title}* — *${score}/10*`, msg);
          break;
        }

        case 'bug':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}bug o comando quiz não respondeu*`, msg);
            break;
          }
          console.log(`[BUG] jid=${jid} relato=${args}`);
          await send(sock, jid, '🐞 Relato recebido. Obrigado por avisar!', msg);
          break;

        default:
          await send(
            sock,
            jid,
            `Comando *${config.prefix}${command}* ainda não foi ativado. Use *${config.prefix}menu*.`,
            msg
          );
      }
    }
  });
}

startEdith().catch((error) => {
  console.error('Falha ao iniciar Edith l:', error);
  process.exit(1);
});
