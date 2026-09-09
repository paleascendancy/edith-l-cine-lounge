import makeWASocket, {
  DisconnectReason,
  areJidsSameUser,
  downloadContentFromMessage,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
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
const execFileAsync = promisify(execFile);
const authDir = process.env.AUTH_DIR || 'auth';
const groupSettingsFile = join(authDir, 'group-settings.json');
const pairingNumber = (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, '');
let pairingCodeRequested = false;

const pendingQuiz = new Map();
const ratings = new Map();
const groupSettings = new Map();

async function loadGroupSettings() {
  try {
    await mkdir(authDir, { recursive: true });
    const raw = await readFile(groupSettingsFile, 'utf-8');
    const saved = JSON.parse(raw);

    for (const [groupJid, settings] of Object.entries(saved)) {
      groupSettings.set(groupJid, {
        antiLink: Boolean(settings?.antiLink)
      });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('Falha ao carregar configurações dos grupos:', error?.message || error);
    }
  }
}

async function saveGroupSettings() {
  await mkdir(authDir, { recursive: true });
  const saved = Object.fromEntries(groupSettings.entries());
  await writeFile(groupSettingsFile, JSON.stringify(saved, null, 2), 'utf-8');
}

function extractLinks(text = '') {
  const matches = text.match(
    /(?:https?:\/\/|www\.)[^\s]+|(?:[a-z0-9-]+\.)+(?:com|com\.br|net|org|io|gg|me|app|br)(?:\/[^\s]*)?/gi
  );

  return matches || [];
}

function normalizeLink(link = '') {
  const cleaned = link
    .trim()
    .replace(/[),.!?;:]+$/g, '');

  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }

  return `https://${cleaned.replace(/^www\./i, '')}`;
}

function isAllowedMemberLink(link = '') {
  try {
    const url = new URL(normalizeLink(link));
    const host = url.hostname.toLowerCase().replace(/^www\./, '');

    return (
      host === 'instagram.com' ||
      host.endsWith('.instagram.com') ||
      host === 'tiktok.com' ||
      host.endsWith('.tiktok.com')
    );
  } catch {
    return false;
  }
}

function hasBlockedLinkForMember(text = '') {
  const links = extractLinks(text);
  if (links.length === 0) return false;

  return links.some((link) => !isAllowedMemberLink(link));
}

async function getGroupMemberInfo(sock, jid, msg) {
  const metadata = await sock.groupMetadata(jid);
  const sender = msg.key.participant || msg.key.remoteJid;
  const senderAlt = msg.key.participantAlt;
  const senderInfo = metadata.participants.find((participant) =>
    participantMatches(participant, sender, senderAlt)
  );

  return { metadata, sender, senderAlt, senderInfo };
}

async function handleAntiLink(sock, jid, text, msg) {
  if (!jid.endsWith('@g.us')) return false;
  if (!groupSettings.get(jid)?.antiLink) return false;
  if (msg.key.fromMe) return false;

  const links = extractLinks(text);
  if (links.length === 0) return false;

  try {
    const { senderInfo } = await getGroupMemberInfo(sock, jid, msg);

    if (senderInfo?.admin) {
      return false;
    }

    if (!hasBlockedLinkForMember(text)) {
      return false;
    }

    await sock.sendMessage(jid, { delete: msg.key });
    await send(
      sock,
      jid,
      '🔗 Link bloqueado. Membros podem enviar apenas links do *Instagram* e *TikTok*. Administradores podem enviar qualquer link.',
      msg
    );
    return true;
  } catch (error) {
    console.error('Falha no anti-link:', error?.message || error);
    return false;
  }
}

async function setAntiLink(sock, jid, msg, args = '') {
  if (!jid.endsWith('@g.us')) {
    await send(sock, jid, '🚫 O comando *!antilink* só funciona em grupos.', msg);
    return;
  }

  try {
    const { senderInfo } = await getGroupMemberInfo(sock, jid, msg);

    if (!senderInfo?.admin) {
      await send(sock, jid, '⛔ Apenas administradores podem alterar o anti-link.', msg);
      return;
    }

    const option = args.trim().toLowerCase();

    if (!['on', 'off', 'status'].includes(option)) {
      await send(
        sock,
        jid,
        'Use *!antilink on*, *!antilink off* ou *!antilink status*.',
        msg
      );
      return;
    }

    if (option === 'status') {
      const enabled = Boolean(groupSettings.get(jid)?.antiLink);
      await send(
        sock,
        jid,
        `🔗 Anti-link está *${enabled ? 'ATIVADO' : 'DESATIVADO'}*.`,
        msg
      );
      return;
    }

    const enabled = option === 'on';
    groupSettings.set(jid, {
      ...(groupSettings.get(jid) || {}),
      antiLink: enabled
    });

    await saveGroupSettings();

    await send(
      sock,
      jid,
      `🔗 Anti-link *${enabled ? 'ATIVADO' : 'DESATIVADO'}*.${enabled ? '\nMembros: apenas Instagram e TikTok.\nAdministradores: qualquer link.' : ''}`,
      msg
    );
  } catch (error) {
    console.error('Falha ao configurar anti-link:', error?.message || error);
    await send(sock, jid, '❌ Não consegui alterar o anti-link agora.', msg);
  }
}

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

function getContextInfo(message) {
  return (
    message?.extendedTextMessage?.contextInfo ||
    message?.imageMessage?.contextInfo ||
    message?.videoMessage?.contextInfo ||
    message?.documentMessage?.contextInfo ||
    null
  );
}

function participantMatches(participant, ...jids) {
  const participantJids = [
    participant?.id,
    participant?.phoneNumber,
    participant?.lid
  ].filter(Boolean);

  return jids
    .filter(Boolean)
    .some((jid) =>
      participantJids.some((participantJid) =>
        areJidsSameUser(participantJid, jid)
      )
    );
}

async function banMember(sock, jid, msg) {
  if (!jid.endsWith('@g.us')) {
    await send(sock, jid, '🚫 O comando *!ban* só funciona em grupos.', msg);
    return;
  }

  try {
    const metadata = await sock.groupMetadata(jid);

    const sender = msg.key.participant || msg.key.remoteJid;
    const senderAlt = msg.key.participantAlt;
    const senderInfo = metadata.participants.find((participant) =>
      participantMatches(participant, sender, senderAlt)
    );

    if (!senderInfo?.admin) {
      await send(sock, jid, '⛔ Apenas administradores do grupo podem usar *!ban*.', msg);
      return;
    }

    const contextInfo = getContextInfo(msg.message);
    const target =
      contextInfo?.participant ||
      contextInfo?.participantAlt ||
      contextInfo?.mentionedJid?.[0];

    if (!target) {
      await send(
        sock,
        jid,
        '👤 Responda à mensagem da pessoa com *!ban* ou use *!ban @membro*.',
        msg
      );
      return;
    }

    if (
      areJidsSameUser(target, sender) ||
      (senderAlt && areJidsSameUser(target, senderAlt))
    ) {
      await send(sock, jid, '⚠️ Você não pode usar *!ban* em si mesmo.', msg);
      return;
    }

    const targetInfo = metadata.participants.find((participant) =>
      participantMatches(participant, target)
    );

    if (!targetInfo) {
      await send(sock, jid, '🔎 Não encontrei esse membro no grupo.', msg);
      return;
    }

    const botIds = [
      sock.user?.id,
      sock.user?.lid
    ].filter(Boolean);

    const botInfo = metadata.participants.find((participant) =>
      participantMatches(participant, ...botIds)
    );

    if (!botInfo?.admin) {
      console.log('[BAN DEBUG] Não encontrei Edith como admin.', {
        botIds,
        addressingMode: metadata.addressingMode,
        participants: metadata.participants.map((participant) => ({
          id: participant.id,
          phoneNumber: participant.phoneNumber,
          lid: participant.lid,
          admin: participant.admin
        }))
      });

      await send(
        sock,
        jid,
        '🛡️ Não consegui reconhecer a Edith l como administradora. Vou precisar atualizar a identificação do bot neste grupo.',
        msg
      );
      return;
    }

    await sock.groupParticipantsUpdate(jid, [targetInfo.id], 'remove');

    await sock.sendMessage(
      jid,
      {
        text: '🚫 Membro removido do grupo.',
        mentions: [targetInfo.id]
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no comando !ban:', error?.message || error);
    await send(sock, jid, '❌ Não consegui remover esse membro. Verifique as permissões de administrador da Edith l.', msg);
  }
}

function getImageMessage(message) {
  if (!message) return null;

  if (message.imageMessage) return message.imageMessage;
  if (message.ephemeralMessage?.message) return getImageMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return getImageMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return getImageMessage(message.viewOnceMessageV2.message);

  const contextInfo =
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.documentMessage?.contextInfo ||
    message.stickerMessage?.contextInfo;

  if (contextInfo?.quotedMessage) {
    return getImageMessage(contextInfo.quotedMessage);
  }

  return null;
}

function getVideoMessage(message) {
  if (!message) return null;

  if (message.videoMessage) return message.videoMessage;
  if (message.ephemeralMessage?.message) return getVideoMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return getVideoMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return getVideoMessage(message.viewOnceMessageV2.message);

  const contextInfo =
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.documentMessage?.contextInfo ||
    message.stickerMessage?.contextInfo;

  if (contextInfo?.quotedMessage) {
    return getVideoMessage(contextInfo.quotedMessage);
  }

  return null;
}

function getStickerMessage(message) {
  if (!message) return null;

  if (message.stickerMessage) return message.stickerMessage;
  if (message.ephemeralMessage?.message) return getStickerMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return getStickerMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return getStickerMessage(message.viewOnceMessageV2.message);

  const contextInfo =
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.documentMessage?.contextInfo ||
    message.stickerMessage?.contextInfo;

  if (contextInfo?.quotedMessage) {
    return getStickerMessage(contextInfo.quotedMessage);
  }

  return null;
}

async function downloadMessageBuffer(mediaMessage, mediaType) {
  const stream = await downloadContentFromMessage(mediaMessage, mediaType);
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function imageToStickerBuffer(imageMessage, mode = 'normal') {
  const imageBuffer = await downloadMessageBuffer(imageMessage, 'image');
  const isSquareMode = mode === 'str';

  return sharp(imageBuffer)
    .rotate()
    .resize(
      512,
      512,
      isSquareMode
        ? {
            fit: 'cover',
            position: 'centre'
          }
        : {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          }
    )
    .webp({ quality: 86 })
    .toBuffer();
}

async function videoToStickerBuffer(videoMessage, mode = 'normal') {
  if (!ffmpegPath) {
    throw new Error('FFmpeg não está disponível.');
  }

  const videoBuffer = await downloadMessageBuffer(videoMessage, 'video');
  const tempDir = await mkdtemp(join(tmpdir(), 'edith-sticker-'));
  const inputPath = join(tempDir, 'input.mp4');
  const outputPath = join(tempDir, 'output.webp');

  try {
    await writeFile(inputPath, videoBuffer);

    const videoFilter =
      mode === 'str'
        ? 'fps=12,scale=512:512:force_original_aspect_ratio=increase,crop=512:512,format=rgba'
        : 'fps=12,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba';

    await execFileAsync(
      ffmpegPath,
      [
        '-y',
        '-i', inputPath,
        '-t', '6',
        '-vf', videoFilter,
        '-an',
        '-c:v', 'libwebp',
        '-lossless', '0',
        '-compression_level', '6',
        '-q:v', '58',
        '-loop', '0',
        '-preset', 'picture',
        outputPath
      ],
      { maxBuffer: 10 * 1024 * 1024 }
    );

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function stickerToImageBuffer(stickerMessage) {
  const stickerBuffer = await downloadMessageBuffer(stickerMessage, 'sticker');

  return sharp(stickerBuffer, { page: 0, pages: 1 })
    .png()
    .toBuffer();
}

async function sendSticker(sock, jid, msg, args = '') {
  const imageMessage = getImageMessage(msg.message);
  const videoMessage = getVideoMessage(msg.message);

  if (!imageMessage && !videoMessage) {
    await send(
      sock,
      jid,
      '🎞️ Envie ou responda uma *imagem* ou *vídeo* com *!s*.\n\nUse *!s -str* para preencher o formato quadrado.',
      msg
    );
    return;
  }

  try {
    const mode = args.toLowerCase().includes('-str') ? 'str' : 'normal';
    const sticker = imageMessage
      ? await imageToStickerBuffer(imageMessage, mode)
      : await videoToStickerBuffer(videoMessage, mode);

    await sock.sendMessage(jid, { sticker }, { quoted: msg });
  } catch (error) {
    console.error('Falha ao criar figurinha:', error?.message || error);
    await send(sock, jid, '❌ Não consegui transformar esse conteúdo em figurinha.', msg);
  }
}

async function sendToImage(sock, jid, msg) {
  const stickerMessage = getStickerMessage(msg.message);

  if (!stickerMessage) {
    await send(
      sock,
      jid,
      '🖼️ Responda a uma figurinha com *!toimg* para transformar em foto.',
      msg
    );
    return;
  }

  try {
    const image = await stickerToImageBuffer(stickerMessage);

    await sock.sendMessage(
      jid,
      {
        image,
        mimetype: 'image/png',
        caption: '🖼️ Figurinha convertida em foto.'
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no comando !toimg:', error?.message || error);
    await send(sock, jid, '❌ Não consegui transformar essa figurinha em foto.', msg);
  }
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
  await loadGroupSettings();
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

      if (await handleAntiLink(sock, jid, text, msg)) continue;
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

        case 's':
          await sendSticker(sock, jid, msg, args);
          break;

        case 'toimg':
          await sendToImage(sock, jid, msg);
          break;

        case 'ban':
          await banMember(sock, jid, msg);
          break;

        case 'antilink':
          await setAntiLink(sock, jid, msg, args);
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
