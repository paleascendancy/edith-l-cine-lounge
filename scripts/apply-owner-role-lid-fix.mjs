import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/owner.js', import.meta.url);
let src = await readFile(path, 'utf-8');

if (src.includes('OWNER_ROLE_LID_FIX_V1')) {
  console.log('[DONO] Owner role LID fix already applied.');
  process.exit(0);
}

function replaceRequired(label, before, after) {
  if (!src.includes(before)) {
    console.error(`[DONO] Could not locate ${label}.`);
    process.exit(1);
  }
  src = src.replace(before, after);
}

replaceRequired(
  'participant ids',
  `function participantIds(participant = {}) {
  return [participant?.phoneNumber, participant?.id, participant?.lid].filter(Boolean);
}`,
  `const OWNER_ROLE_LID_FIX_V1 = true;

function participantIds(participant = {}) {
  return [
    participant?.participantPn,
    participant?.phoneNumber,
    participant?.id,
    participant?.lid
  ].filter(Boolean);
}

async function findParticipantReliable(sock, metadata, candidates = []) {
  const rawCandidates = candidates.filter(Boolean).map(String);
  const exactIds = new Set(rawCandidates);
  const phones = new Set();
  const lids = new Set(rawCandidates.filter((value) => value.endsWith('@lid')));

  for (const value of rawCandidates) {
    if (value.endsWith('@g.us')) continue;

    if (value.endsWith('@lid')) {
      try {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(value);
        const phone = normalizeOwnerNumber(pn);
        if (phone) phones.add(phone);
      } catch {}
      continue;
    }

    const phone = normalizeOwnerNumber(value);
    if (phone) phones.add(phone);

    try {
      const pnJid = value.includes('@') ? value : (phone ? \`${'${phone}'}@s.whatsapp.net\` : value);
      const lid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(pnJid);
      if (lid) lids.add(String(lid));
    } catch {}
  }

  for (const participant of metadata?.participants || []) {
    const ids = participantIds(participant).map(String);

    if (ids.some((id) => exactIds.has(id) || lids.has(id))) {
      return participant;
    }

    for (const id of ids) {
      if (id.endsWith('@lid')) {
        try {
          const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(id);
          const phone = normalizeOwnerNumber(pn);
          if (phone && phones.has(phone)) return participant;
        } catch {}
        continue;
      }

      const phone = normalizeOwnerNumber(id);
      if (phone && phones.has(phone)) return participant;
    }
  }

  return null;
}`
);

replaceRequired(
  'bot admin lookup',
  `    const botCandidates = [sock?.user?.id, sock?.user?.lid].filter(Boolean);
    const botInfo = metadata?.participants?.find((participant) =>
      botCandidates.some((candidate) => candidateMatchesParticipant(participant, candidate))
    );`,
  `    const botCandidates = [sock?.user?.id, sock?.user?.lid].filter(Boolean);
    const botInfo = await findParticipantReliable(sock, metadata, botCandidates);`
);

replaceRequired(
  'owner sender lookup',
  `    const senderInfo = metadata?.participants?.find((participant) =>
      senderCandidates.some((candidate) => candidateMatchesParticipant(participant, candidate))
    );`,
  `    const senderInfo = await findParticipantReliable(sock, metadata, senderCandidates);`
);

await writeFile(path, src, 'utf-8');
console.log('[DONO] Reliable bot-admin/LID role detection applied.');
