import { downloadContentFromMessage } from '@whiskeysockets/baileys';

function unwrap(message) {
  if (!message) return null;
  if (message.ephemeralMessage?.message) return unwrap(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return unwrap(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrap(message.viewOnceMessageV2.message);
  return message;
}

function contextInfo(message) {
  const clean = unwrap(message) || {};
  return clean.extendedTextMessage?.contextInfo || clean.imageMessage?.contextInfo || clean.videoMessage?.contextInfo || clean.audioMessage?.contextInfo || clean.documentMessage?.contextInfo || clean.stickerMessage?.contextInfo || null;
}

function mediaFrom(message, type) {
  const clean = unwrap(message);
  if (!clean) return null;
  const key = `${type}Message`;
  if (clean[key]) return clean[key];
  const quoted = contextInfo(clean)?.quotedMessage;
  return quoted ? mediaFrom(quoted, type) : null;
}

async function download(media, type) {
  const stream = await downloadContentFromMessage(media, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function send(sock, jid, msg, text) {
  await sock.sendMessage(jid, { text: String(text).slice(0, 12000) }, { quoted: msg });
}

function firstText(value, depth = 0) {
  if (depth > 6 || value == null) return '';
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstText(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    for (const key of ['response', 'resposta', 'answer', 'content', 'text', 'message', 'result', 'resultado', 'data']) {
      if (value[key] != null) {
        const found = firstText(value[key], depth + 1);
        if (found) return found;
      }
    }
    for (const nested of Object.values(value)) {
      const found = firstText(nested, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

async function nagatoroAi(prompt) {
  const key = String(process.env.NAGATORO_API_KEY || '').trim();
  if (!key) throw new Error('AI_NOT_CONFIGURED');
  const url = new URL('/api/ia/gpt', 'https://api.nagatoro.cloud');
  url.searchParams.set('apikey', key);
  url.searchParams.set('prompt', String(prompt).slice(0, 7000));
  const response = await fetch(url, { headers: { accept: 'application/json,text/plain' }, signal: AbortSignal.timeout(30000) });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  if (!response.ok) throw new Error(`AI_HTTP_${response.status}`);
  const text = firstText(data);
  if (!text) throw new Error('AI_EMPTY');
  return text;
}

async function transcribeBuffer(buffer, mime = 'audio/ogg') {
  const customEndpoint = String(process.env.TRANSCRIPTION_ENDPOINT || '').trim();
  const groqKey = String(process.env.GROQ_API_KEY || '').trim();
  const endpoint = customEndpoint || (groqKey ? 'https://api.groq.com/openai/v1/audio/transcriptions' : '');
  const token = String(process.env.TRANSCRIPTION_TOKEN || groqKey || '').trim();
  if (!endpoint || !token) throw new Error('TRANSCRIPTION_NOT_CONFIGURED');

  const form = new FormData();
  form.set('file', new Blob([buffer], { type: mime }), mime.includes('video') ? 'video.mp4' : 'audio.ogg');
  form.set('model', String(process.env.TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo'));
  form.set('language', 'pt');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(90000)
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  if (!response.ok) throw new Error(`TRANSCRIPTION_HTTP_${response.status}`);
  const text = firstText(data);
  if (!text) throw new Error('TRANSCRIPTION_EMPTY');
  return text;
}

async function imageFromMessage(msg) {
  const image = mediaFrom(msg.message, 'image');
  if (image) return { buffer: await download(image, 'image'), mime: image.mimetype || 'image/jpeg' };
  const sticker = mediaFrom(msg.message, 'sticker');
  if (sticker) return { buffer: await download(sticker, 'sticker'), mime: 'image/webp' };
  return null;
}

async function visionAnalyze(image, prompt) {
  const endpoint = String(process.env.VISION_ENDPOINT || '').trim();
  const token = String(process.env.VISION_TOKEN || '').trim();
  if (!endpoint || !token) throw new Error('VISION_NOT_CONFIGURED');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, image_base64: image.buffer.toString('base64'), mime_type: image.mime }),
    signal: AbortSignal.timeout(60000)
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  if (!response.ok) throw new Error(`VISION_HTTP_${response.status}`);
  const text = firstText(data);
  if (!text) throw new Error('VISION_EMPTY');
  return text;
}

async function ocrImage(image) {
  const key = String(process.env.OCR_SPACE_KEY || '').trim();
  if (!key) throw new Error('OCR_NOT_CONFIGURED');
  const form = new FormData();
  form.set('apikey', key);
  form.set('language', 'por');
  form.set('isOverlayRequired', 'false');
  form.set('file', new Blob([image.buffer], { type: image.mime }), 'imagem.jpg');
  const response = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
  const data = await response.json();
  if (!response.ok || data?.IsErroredOnProcessing) throw new Error('OCR_FAILED');
  const text = (data?.ParsedResults || []).map((item) => item?.ParsedText || '').join('\n').trim();
  if (!text) throw new Error('OCR_EMPTY');
  return text;
}

async function removeBackground(image) {
  const key = String(process.env.REMOVE_BG_API_KEY || '').trim();
  if (!key) throw new Error('REMOVE_BG_NOT_CONFIGURED');
  const form = new FormData();
  form.set('size', 'auto');
  form.set('image_file', new Blob([image.buffer], { type: image.mime }), 'imagem.png');
  const response = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': key },
    body: form,
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`REMOVE_BG_HTTP_${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function generateImage(prompt) {
  const endpoint = String(process.env.IMAGE_GENERATION_ENDPOINT || '').trim();
  const token = String(process.env.IMAGE_GENERATION_TOKEN || '').trim();
  if (!endpoint || !token) throw new Error('IMAGE_GENERATION_NOT_CONFIGURED');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(120000)
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  if (!response.ok) throw new Error(`IMAGE_GENERATION_HTTP_${response.status}`);
  const url = data?.url || data?.image_url || data?.data?.[0]?.url || '';
  const base64 = data?.b64_json || data?.image_base64 || data?.data?.[0]?.b64_json || '';
  if (base64) return { buffer: Buffer.from(base64, 'base64') };
  if (url) return { url };
  throw new Error('IMAGE_GENERATION_EMPTY');
}

async function pdfAi(msg, question) {
  const document = mediaFrom(msg.message, 'document');
  if (!document || !/pdf/i.test(document.mimetype || document.fileName || '')) throw new Error('PDF_REQUIRED');
  const endpoint = String(process.env.PDF_AI_ENDPOINT || '').trim();
  const token = String(process.env.PDF_AI_TOKEN || '').trim();
  if (!endpoint || !token) throw new Error('PDF_AI_NOT_CONFIGURED');
  const buffer = await download(document, 'document');
  const form = new FormData();
  form.set('file', new Blob([buffer], { type: 'application/pdf' }), document.fileName || 'documento.pdf');
  form.set('question', question || 'Resuma este documento em português.');
  const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(120000) });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  if (!response.ok) throw new Error(`PDF_AI_HTTP_${response.status}`);
  const text = firstText(data);
  if (!text) throw new Error('PDF_AI_EMPTY');
  return text;
}

export const ESSENTIAL_AI_COMMANDS = new Set([
  'ia', 'resumir', 'explicar', 'corrigir', 'traduzir', 'transcrever', 'resumiraudio',
  'imagem', 'analisar', 'pdfia', 'estudar', 'flashcards', 'redacao', 'semfundo', 'ocr'
]);

function aiPrompt(command, args) {
  const input = String(args || '').trim();
  if (command === 'ia') return input;
  if (command === 'resumir') return `Resuma o conteúdo abaixo em português, de forma objetiva e útil, preservando os pontos importantes:\n\n${input}`;
  if (command === 'explicar') return `Explique de forma clara, didática e correta, em português:\n\n${input}`;
  if (command === 'corrigir') return `Corrija ortografia, gramática e clareza do texto abaixo sem mudar a intenção. Depois mostre somente a versão corrigida:\n\n${input}`;
  if (command === 'traduzir') return `Traduza o texto abaixo. Se o usuário indicar um idioma no começo, use-o; caso contrário traduza para português brasileiro:\n\n${input}`;
  if (command === 'estudar') return `Crie um material de estudo sobre o tema abaixo com resumo, conceitos-chave e 5 perguntas de revisão com gabarito:\n\n${input}`;
  if (command === 'flashcards') return `Transforme o conteúdo abaixo em até 12 flashcards no formato "Pergunta → Resposta", claros e curtos:\n\n${input}`;
  if (command === 'redacao') return `Ajude a estruturar uma redação sobre o tema abaixo. Forneça tese, argumentos, repertórios possíveis e uma estrutura de introdução/desenvolvimento/conclusão. Não invente fontes:\n\n${input}`;
  return input;
}

function providerErrorMessage(error) {
  const code = String(error?.message || error || '');
  if (code === 'AI_NOT_CONFIGURED') return '⚙️ A IA de texto ainda precisa da chave *NAGATORO_API_KEY* no servidor.';
  if (code === 'TRANSCRIPTION_NOT_CONFIGURED') return '⚙️ A transcrição precisa de *GROQ_API_KEY* ou de um provedor configurado em *TRANSCRIPTION_ENDPOINT*.';
  if (code === 'VISION_NOT_CONFIGURED') return '⚙️ A análise de imagens precisa de um provedor configurado em *VISION_ENDPOINT*.';
  if (code === 'OCR_NOT_CONFIGURED') return '⚙️ O OCR precisa da chave *OCR_SPACE_KEY* no servidor.';
  if (code === 'REMOVE_BG_NOT_CONFIGURED') return '⚙️ A remoção de fundo precisa da chave *REMOVE_BG_API_KEY* no servidor.';
  if (code === 'IMAGE_GENERATION_NOT_CONFIGURED') return '⚙️ A geração de imagens precisa de um provedor configurado em *IMAGE_GENERATION_ENDPOINT*.';
  if (code === 'PDF_AI_NOT_CONFIGURED') return '⚙️ O PDF IA precisa de um provedor configurado em *PDF_AI_ENDPOINT*.';
  if (code === 'PDF_REQUIRED') return '📄 Responda a um arquivo PDF com *!pdfia sua pergunta*.';
  return `❌ Não consegui concluir esse comando agora. (${code.slice(0, 80)})`;
}

export async function handleEssentialAi(ctx) {
  const { sock, jid, msg, command, args } = ctx;
  try {
    if (['ia', 'resumir', 'explicar', 'corrigir', 'traduzir', 'estudar', 'flashcards', 'redacao'].includes(command)) {
      if (!String(args || '').trim()) {
        await send(sock, jid, msg, `Use *!${command} texto/tema*.`);
        return true;
      }
      const answer = await nagatoroAi(aiPrompt(command, args));
      await send(sock, jid, msg, `🧠 *RIMURU IA*\n\n${answer}`);
      return true;
    }

    if (command === 'transcrever' || command === 'resumiraudio') {
      const audio = mediaFrom(msg.message, 'audio');
      const video = mediaFrom(msg.message, 'video');
      const media = audio || video;
      if (!media) { await send(sock, jid, msg, `🎙️ Responda a um áudio ou vídeo com *!${command}*.`); return true; }
      const type = audio ? 'audio' : 'video';
      const buffer = await download(media, type);
      const transcript = await transcribeBuffer(buffer, media.mimetype || (audio ? 'audio/ogg' : 'video/mp4'));
      if (command === 'transcrever') {
        await send(sock, jid, msg, `🎙️ *TRANSCRIÇÃO*\n\n${transcript}`);
      } else {
        const summary = await nagatoroAi(`Resuma esta transcrição em português, destacando decisões, fatos e pontos importantes:\n\n${transcript}`);
        await send(sock, jid, msg, `🎙️ *RESUMO DO ÁUDIO*\n\n${summary}`);
      }
      return true;
    }

    if (command === 'analisar') {
      const image = await imageFromMessage(msg);
      if (!image) { await send(sock, jid, msg, '🖼️ Responda a uma imagem com *!analisar pergunta opcional*.'); return true; }
      const result = await visionAnalyze(image, args.trim() || 'Analise esta imagem detalhadamente e responda em português.');
      await send(sock, jid, msg, `👁️ *ANÁLISE DA IMAGEM*\n\n${result}`);
      return true;
    }

    if (command === 'ocr') {
      const image = await imageFromMessage(msg);
      if (!image) { await send(sock, jid, msg, '🔤 Responda a uma imagem com *!ocr*.'); return true; }
      const text = await ocrImage(image);
      await send(sock, jid, msg, `🔤 *TEXTO EXTRAÍDO*\n\n${text}`);
      return true;
    }

    if (command === 'semfundo') {
      const image = await imageFromMessage(msg);
      if (!image) { await send(sock, jid, msg, '🪄 Responda a uma imagem com *!semfundo*.'); return true; }
      const output = await removeBackground(image);
      await sock.sendMessage(jid, { document: output, mimetype: 'image/png', fileName: 'rimuru-sem-fundo.png', caption: '🪄 Fundo removido.' }, { quoted: msg });
      return true;
    }

    if (command === 'imagem') {
      const prompt = String(args || '').trim();
      if (!prompt) { await send(sock, jid, msg, '🎨 Use *!imagem descrição da imagem*.' ); return true; }
      const generated = await generateImage(prompt);
      await sock.sendMessage(jid, generated.buffer ? { image: generated.buffer, caption: '🎨 Imagem gerada pela Rimuru.' } : { image: { url: generated.url }, caption: '🎨 Imagem gerada pela Rimuru.' }, { quoted: msg });
      return true;
    }

    if (command === 'pdfia') {
      const answer = await pdfAi(msg, String(args || '').trim());
      await send(sock, jid, msg, `📚 *PDF IA*\n\n${answer}`);
      return true;
    }
  } catch (error) {
    console.error(`[ESSENTIAL AI] ${command}:`, error?.message || error);
    await send(sock, jid, msg, providerErrorMessage(error));
    return true;
  }
  return false;
}
