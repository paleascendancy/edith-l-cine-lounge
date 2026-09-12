import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
const ownerPath = new URL('../src/owner.js', import.meta.url);

let indexSource = await readFile(indexPath, 'utf-8');
let ownerSource = await readFile(ownerPath, 'utf-8');

if (!indexSource.includes('OWNER_FULL_ACCESS_V1')) {
  const participantIdsBefore = `  const participantJids = [\n    participant?.id,\n    participant?.phoneNumber,\n    participant?.lid\n  ].filter(Boolean);`;
  const participantIdsAfter = `  const OWNER_FULL_ACCESS_V1 = true;\n  const participantJids = [\n    participant?.participantPn,\n    participant?.id,\n    participant?.phoneNumber,\n    participant?.lid\n  ].filter(Boolean);`;

  if (!indexSource.includes(participantIdsBefore)) {
    console.error('[DONO] Could not patch participant identity fields.');
    process.exit(1);
  }
  indexSource = indexSource.replace(participantIdsBefore, participantIdsAfter);

  const botLookupBefore = `function findBotParticipant(metadata, sock) {\n  const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean);\n  return metadata.participants.find((participant) =>\n    participantMatches(participant, ...botIds)\n  );\n}`;
  const botLookupAfter = `function findBotParticipant(metadata, sock) {\n  const configuredBot = pairingNumber ? \`${'${pairingNumber}'}@s.whatsapp.net\` : '';\n  const botIds = [sock.user?.id, sock.user?.lid, configuredBot].filter(Boolean);\n  return metadata.participants.find((participant) =>\n    participantMatches(participant, ...botIds)\n  );\n}`;

  if (!indexSource.includes(botLookupBefore)) {
    console.error('[DONO] Could not patch bot participant detection.');
    process.exit(1);
  }
  indexSource = indexSource.replace(botLookupBefore, botLookupAfter);

  const antiLinkConfigBefore = `    if (!senderInfo?.admin) {\n      await send(sock, jid, '⛔ Apenas administradores podem alterar o anti-link.', msg);\n      return;\n    }`;
  const antiLinkConfigAfter = `    if (!senderInfo?.admin && !(await isBotOwner(sock, msg))) {\n      await send(sock, jid, '⛔ Apenas administradores ou donos da Edith podem alterar o anti-link.', msg);\n      return;\n    }`;

  if (!indexSource.includes(antiLinkConfigBefore)) {
    console.error('[DONO] Could not patch anti-link owner permission.');
    process.exit(1);
  }
  indexSource = indexSource.replace(antiLinkConfigBefore, antiLinkConfigAfter);

  const antiLinkBypassBefore = `    if (senderInfo?.admin) {\n      return false;\n    }`;
  const antiLinkBypassAfter = `    if (senderInfo?.admin || (await isBotOwner(sock, msg))) {\n      return false;\n    }`;

  if (!indexSource.includes(antiLinkBypassBefore)) {
    console.error('[DONO] Could not patch anti-link owner bypass.');
    process.exit(1);
  }
  indexSource = indexSource.replace(antiLinkBypassBefore, antiLinkBypassAfter);

  await writeFile(indexPath, indexSource, 'utf-8');
}

if (!ownerSource.includes('OWNER_ROLE_COMMAND_FALLBACK_V1')) {
  const candidatesBefore = `    const botCandidates = [sock?.user?.id, sock?.user?.lid].filter(Boolean);`;
  const candidatesAfter = `    const OWNER_ROLE_COMMAND_FALLBACK_V1 = true;\n    const configuredBotNumber = normalizeOwnerNumber(process.env.WHATSAPP_NUMBER || '');\n    const botCandidates = [\n      sock?.user?.id,\n      sock?.user?.lid,\n      configuredBotNumber ? \`${'${configuredBotNumber}'}@s.whatsapp.net\` : ''\n    ].filter(Boolean);`;

  if (!ownerSource.includes(candidatesBefore)) {
    console.error('[DONO] Could not patch owner role bot candidates.');
    process.exit(1);
  }
  ownerSource = ownerSource.replace(candidatesBefore, candidatesAfter);

  const adminGuardBefore = `    if (!botInfo?.admin) {\n      await send(\n        sock,\n        jid,\n        '🛡️ *COMANDO NÃO EXECUTADO*\\n\\nMotivo: a Edith precisa ser administradora do grupo para alterar seu cargo.',\n        msg\n      );\n      return;\n    }`;
  const adminGuardAfter = `    if (!botInfo?.admin) {\n      console.warn('[DONO] Não foi possível confirmar o cargo da Edith pelo metadata; tentando a alteração mesmo assim.');\n    }`;

  if (!ownerSource.includes(adminGuardBefore)) {
    console.error('[DONO] Could not patch owner role admin fallback.');
    process.exit(1);
  }
  ownerSource = ownerSource.replace(adminGuardBefore, adminGuardAfter);

  await writeFile(ownerPath, ownerSource, 'utf-8');
}

console.log('[DONO] Full owner access and bot-admin fallback applied.');
