import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/index.js', import.meta.url);
let src = await readFile(path, 'utf-8');

if (src.includes('DELETE_MESSAGE_COMMAND_V1')) {
  console.log('[MOD] Delete-message command already applied.');
  process.exit(0);
}

const functionAnchor = 'async function banMember(sock, jid, msg) {';
if (!src.includes(functionAnchor)) {
  console.error('[MOD] Could not locate banMember anchor for delete command.');
  process.exit(1);
}

const deleteFunction = `const DELETE_MESSAGE_COMMAND_V1 = true;

async function deleteQuotedMessage(sock, jid, msg) {
  if (!jid.endsWith('@g.us')) {
    await send(sock, jid, '⚠️ O comando *' + config.prefix + 'd* só funciona em grupos.', msg);
    return;
  }

  try {
    const owner = await isBotOwner(sock, msg);
    const info = await getGroupMemberInfo(sock, jid, msg);

    if (!owner && !info?.senderInfo?.admin) {
      await send(
        sock,
        jid,
        '⛔ Apenas administradores do grupo ou donos da Edith podem apagar mensagens.',
        msg
      );
      return;
    }

    const context = getContextInfo(msg.message);
    const messageId = context?.stanzaId;

    if (!messageId) {
      await send(
        sock,
        jid,
        '🗑️ Responda à mensagem que deseja apagar usando *' + config.prefix + 'd*.',
        msg
      );
      return;
    }

    const participant = context?.participant || context?.participantAlt || '';
    const configuredBot = pairingNumber ? \`${'${pairingNumber}'}@s.whatsapp.net\` : '';
    const botIds = [sock?.user?.id, sock?.user?.lid, configuredBot].filter(Boolean);
    const fromMe = Boolean(
      participant && botIds.some((botId) => areJidsSameUser(participant, botId))
    );

    const deleteKey = {
      remoteJid: jid,
      fromMe,
      id: messageId
    };

    if (participant) {
      deleteKey.participant = participant;
    }

    await sock.sendMessage(jid, { delete: deleteKey });
  } catch (error) {
    console.error('Falha no comando de apagar mensagem:', error?.message || error);
    await send(
      sock,
      jid,
      '❌ *COMANDO NÃO EXECUTADO*\\n\\nMotivo: não consegui apagar essa mensagem. A Edith precisa ser administradora do grupo e o WhatsApp precisa permitir a remoção da mensagem.',
      msg
    );
  }
}

`;

src = src.replace(functionAnchor, deleteFunction + functionAnchor);

const switchAnchor = `        case 'ban':
          await banMember(sock, jid, msg);
          break;`;

if (!src.includes(switchAnchor)) {
  console.error('[MOD] Could not locate command switch anchor for delete command.');
  process.exit(1);
}

src = src.replace(
  switchAnchor,
  `        case 'd':
          await deleteQuotedMessage(sock, jid, msg);
          break;

${switchAnchor}`
);

await writeFile(path, src, 'utf-8');
console.log('[MOD] Admin/owner delete-message command applied.');
