import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/index.js', import.meta.url);
let src = await readFile(path, 'utf-8');

if (src.includes('AUTOACEITAR_RELIABLE_V2')) {
  console.log('[AUTOACEITAR] Reliability patch already applied.');
  process.exit(0);
}

const original = src;

src = src.replace(
  'let pairingCodeRequested = false;',
  "let pairingCodeRequested = false;\nconst AUTOACEITAR_RELIABLE_V2 = true;"
);

const helperCode = [
  'function joinRequestCandidates(request = {}) {',
  '  return [',
  '    request.participantPn,',
  '    request.phoneNumber,',
  '    request.phone,',
  '    request.pn,',
  '    request.phone_number,',
  '    request.jid,',
  '    request.id,',
  '    request.participant,',
  '    request.participantAlt,',
  '    request.lid',
  '  ].filter(Boolean);',
  '}',
  '',
  'function brazilPhoneJid(request = {}) {',
  '  for (const candidate of joinRequestCandidates(request)) {',
  '    const value = String(candidate);',
  "    if (value.endsWith('@lid')) continue;",
  '',
  "    const digits = value.split('@')[0].split(':')[0].replace(/\\D/g, '');",
  '',
  '    if (/^55\\d{10,11}$/.test(digits)) {',
  "      return digits + '@s.whatsapp.net';",
  '    }',
  '  }',
  '',
  '  return null;',
  '}',
  '',
  'async function resolveBrazilJoinRequest(sock, request = {}) {',
  '  const directPn = brazilPhoneJid(request);',
  '  const approvalJid =',
  '    request.jid ||',
  '    request.id ||',
  '    request.participant ||',
  '    request.lid ||',
  '    directPn;',
  '',
  '  if (directPn) {',
  '    return { approvalJid, phoneJid: directPn };',
  '  }',
  '',
  '  for (const candidate of joinRequestCandidates(request)) {',
  '    const value = String(candidate);',
  "    if (!value.endsWith('@lid')) continue;",
  '',
  '    try {',
  '      const mappedPn = await sock.signalRepository?.lidMapping?.getPNForLID?.(value);',
  '      const phoneJid = brazilPhoneJid({ jid: mappedPn });',
  '',
  '      if (phoneJid) {',
  '        return { approvalJid: approvalJid || value, phoneJid };',
  '      }',
  '    } catch (error) {',
  "      console.error('[AUTOACEITAR] Falha ao resolver LID:', error?.message || error);",
  '    }',
  '  }',
  '',
  '  return null;',
  '}',
  '',
  'function waitJoinRequest(ms) {',
  '  return new Promise((resolve) => setTimeout(resolve, ms));',
  '}',
  '',
  'async function processBrazilJoinRequests(sock, jid) {',
  '  const settings = getSettings(jid);',
  '  if (!settings.autoApproveBrazil) {',
  '    return { approved: 0, pending: 0, total: 0 };',
  '  }',
  '',
  '  const requests = await sock.groupRequestParticipantsList(jid);',
  '  let approved = 0;',
  '',
  '  for (const request of requests || []) {',
  '    const resolved = await resolveBrazilJoinRequest(sock, request);',
  '    if (!resolved?.approvalJid) continue;',
  '',
  '    try {',
  '      const result = await sock.groupRequestParticipantsUpdate(',
  '        jid,',
  '        [resolved.approvalJid],',
  "        'approve'",
  '      );',
  '',
  '      const accepted = !Array.isArray(result) || result.length > 0;',
  '      if (!accepted) continue;',
  '',
  '      approved += 1;',
  '      addAdminLog(',
  '        jid,',
  "        'AUTO_APROVAR_BR',",
  '        null,',
  '        { id: resolved.phoneJid || resolved.approvalJid },',
  "        'solicitação aprovada automaticamente'",
  '      );',
  '    } catch (error) {',
  "      console.error('[AUTOACEITAR] Falha ao aprovar ' + resolved.approvalJid + ' em ' + jid + ':', error?.message || error);",
  '    }',
  '',
  '    await waitJoinRequest(350);',
  '  }',
  '',
  '  if (approved) {',
  '    await saveGroupSettings();',
  '  }',
  '',
  '  return {',
  '    approved,',
  '    pending: Math.max(0, (requests || []).length - approved),',
  '    total: (requests || []).length',
  '  };',
  '}',
  '',
  'async function processBrazilJoinRequestsWithRetry(sock, jid, attempts = 3) {',
  '  let lastError = null;',
  '',
  '  for (let attempt = 1; attempt <= attempts; attempt += 1) {',
  '    try {',
  '      return await processBrazilJoinRequests(sock, jid);',
  '    } catch (error) {',
  '      lastError = error;',
  "      console.error('[AUTOACEITAR] Tentativa ' + attempt + '/' + attempts + ' falhou em ' + jid + ':', error?.message || error);",
  '',
  '      if (attempt < attempts) {',
  '        await waitJoinRequest(1500 * attempt);',
  '      }',
  '    }',
  '  }',
  '',
  "  throw lastError || new Error('Falha ao processar solicitações.');",
  '}',
  '',
  'async function setAutoApproveBrazil'
].join('\n');

src = src.replace(
  /function brazilPhoneJid\(request = \{\}\) \{[\s\S]*?\n\}\n\nasync function processBrazilJoinRequests\(sock, jid\) \{[\s\S]*?\n\}\n\nasync function setAutoApproveBrazil/,
  helperCode
);

src = src.replace(
  'const result = await processBrazilJoinRequests(sock, jid);\n      approvedNow = result.approved;',
  'const result = await processBrazilJoinRequestsWithRetry(sock, jid);\n      approvedNow = result.approved;'
);

const pollCode = [
  'let joinRequestPolling = false;',
  '',
  'async function pollBrazilJoinRequests(sock) {',
  '  if (joinRequestPolling) return;',
  '  joinRequestPolling = true;',
  '',
  '  try {',
  '    for (const [groupJid, settings] of groupSettings.entries()) {',
  '      if (!settings?.autoApproveBrazil) continue;',
  '',
  '      try {',
  '        await processBrazilJoinRequestsWithRetry(sock, groupJid, 2);',
  '      } catch (error) {',
  "        console.error('Falha ao verificar solicitações de ' + groupJid + ':', error?.message || error);",
  '      }',
  '',
  '      await waitJoinRequest(500);',
  '    }',
  '  } finally {',
  '    joinRequestPolling = false;',
  '  }',
  '}',
  '',
  'let activitySaveTimer'
].join('\n');

src = src.replace(
  /async function pollBrazilJoinRequests\(sock\) \{[\s\S]*?\n\}\n\nlet activitySaveTimer/,
  pollCode
);

src = src.replace('      }, 15000);', '      }, 30000);');

const eventAnchor = "  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {";
const eventHandler = [
  "  sock.ev.on('group.join-request', async (update) => {",
  "    if (update?.action !== 'created') return;",
  '',
  '    const groupJid = update.id;',
  '    if (!groupJid || !getSettings(groupJid).autoApproveBrazil) return;',
  '',
  '    try {',
  '      await waitJoinRequest(800);',
  '      await processBrazilJoinRequestsWithRetry(sock, groupJid, 2);',
  '    } catch (error) {',
  "      console.error('[AUTOACEITAR] Falha no evento de solicitação de ' + groupJid + ':', error?.message || error);",
  '    }',
  '  });',
  ''
].join('\n');

if (src.includes(eventAnchor) && !src.includes("sock.ev.on('group.join-request'")) {
  src = src.replace(eventAnchor, eventHandler + '\n' + eventAnchor);
}

if (src === original || !src.includes('AUTOACEITAR_RELIABLE_V2')) {
  console.error('[AUTOACEITAR] Runtime patch could not be applied; starting original code.');
  process.exit(0);
}

await writeFile(path, src, 'utf-8');
console.log('[AUTOACEITAR] Reliability patch applied at runtime.');
