import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

let stateFile = null;
let saveTimer = null;

const state = {
  version: 1,
  players: {},
  world: {
    season: 1,
    cycle: 1,
    discovered: ['Refúgio Nulo'],
    decisions: [],
    events: [],
    firstDiscoveries: {}
  }
};

const LOCATIONS = {
  'Refúgio Nulo': {
    key: 'refugio',
    danger: 0,
    description: 'O último ponto seguro conhecido de Arkan. Mercadores, viajantes e sinais antigos se cruzam aqui.'
  },
  'Estação Vesper': {
    key: 'vesper',
    danger: 1,
    description: 'Uma estação silenciosa onde transmissores continuam ativos sem fonte de energia aparente.'
  },
  'Ruínas de Oris': {
    key: 'oris',
    danger: 2,
    description: 'Estruturas quebradas pela Ruptura. Fragmentos instáveis aparecem entre os corredores.'
  },
  'Bosque de Vidro': {
    key: 'bosque',
    danger: 2,
    description: 'Árvores cristalizadas refletem versões diferentes de quem passa por elas.'
  },
  'Portão IX': {
    key: 'portao',
    danger: 4,
    description: 'Uma estrutura selada. Algo do outro lado parece responder aos Viajantes.'
  }
};

const ITEM_INFO = {
  'Fragmento de Eco': 'Matéria deixada pela Ruptura. Usada em missões e tecnologias.',
  'Célula Vesper': 'Fonte de energia antiga encontrada na Estação Vesper.',
  'Chave de Oris': 'Chave marcada com símbolos que não pertencem à Arkan atual.',
  'Vidro Mnêmico': 'Cristal que guarda um instante de memória que não é seu.',
  'Selo do Portão IX': 'Um selo raro ligado ao maior mistério conhecido de Arkan.'
};

const FACTIONS = [
  {
    name: 'Vigília de Arkan',
    text: 'Protege assentamentos e tenta impedir uma nova Ruptura.'
  },
  {
    name: 'Cartógrafos do Zero',
    text: 'Exploradores obcecados em mapear todos os Ecos.'
  },
  {
    name: 'Ordem Vazia',
    text: 'Facção secreta que acredita que o mundo deveria voltar ao estado Zero.'
  }
];

function playerId(msg) {
  return String(
    msg?.key?.participant ||
    msg?.key?.participantAlt ||
    msg?.key?.remoteJid ||
    ''
  );
}

function mentionLabel(jid = '') {
  const user = String(jid).split('@')[0].split(':')[0];
  return user ? `@${user}` : '@viajante';
}

async function send(sock, jid, text, msg, mentions = []) {
  await sock.sendMessage(
    jid,
    mentions.length ? { text, mentions } : { text },
    { quoted: msg }
  );
}

function now() {
  return Date.now();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function saveNow() {
  if (!stateFile) return;
  await mkdir(join(stateFile, '..'), { recursive: true }).catch(() => {});
  await writeFile(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

function scheduleSave() {
  if (saveTimer) return;

  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await saveNow();
    } catch (error) {
      console.error('NOX: falha ao salvar estado:', error?.message || error);
    }
  }, 1500);
}

export async function initNoxRpg(authDir) {
  stateFile = join(authDir, 'nox-rpg.json');

  try {
    const raw = await readFile(stateFile, 'utf-8');
    const saved = JSON.parse(raw);

    if (saved?.players && saved?.world) {
      state.version = Number(saved.version || 1);
      state.players = saved.players;
      state.world = {
        ...state.world,
        ...saved.world,
        discovered: Array.isArray(saved.world.discovered)
          ? saved.world.discovered
          : ['Refúgio Nulo'],
        decisions: Array.isArray(saved.world.decisions)
          ? saved.world.decisions.slice(-250)
          : [],
        events: Array.isArray(saved.world.events)
          ? saved.world.events.slice(-100)
          : [],
        firstDiscoveries:
          saved.world.firstDiscoveries &&
          typeof saved.world.firstDiscoveries === 'object'
            ? saved.world.firstDiscoveries
            : {}
      };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('NOX: falha ao carregar estado:', error?.message || error);
    }
  }
}

function createPlayer(id, name) {
  return {
    id,
    name: String(name || 'Viajante').slice(0, 28),
    createdAt: now(),
    origin: null,
    originSetup: {
      active: true,
      step: 1,
      answers: []
    },
    level: 1,
    xp: 0,
    credits: 80,
    fragments: 0,
    echoes: 0,
    energy: 100,
    energyUpdatedAt: now(),
    attributes: {
      força: 1,
      reflexo: 1,
      intelecto: 1,
      vontade: 1,
      anomalia: 0
    },
    conditions: [],
    location: 'Refúgio Nulo',
    inventory: {
      'Fragmento de Eco': 1
    },
    reputation: {
      'Vigília de Arkan': 0,
      'Cartógrafos do Zero': 0,
      'Ordem Vazia': 0
    },
    codex: {
      locations: ['Refúgio Nulo'],
      creatures: [],
      relics: []
    },
    mission: {
      id: 'sinal_vesper',
      name: 'O Sinal de Vesper',
      stage: 1,
      progress: 0,
      completed: false
    },
    history: [
      {
        at: now(),
        text: 'Despertou no Refúgio Nulo após a Ruptura.'
      }
    ],
    pendingEncounter: null,
    lastExploreAt: 0
  };
}

function getPlayer(msg) {
  return state.players[playerId(msg)] || null;
}

function ensureEnergy(player) {
  const elapsed = Math.max(0, now() - Number(player.energyUpdatedAt || now()));
  const recovered = Math.floor(elapsed / (5 * 60 * 1000));

  if (recovered > 0) {
    player.energy = clamp(Number(player.energy || 0) + recovered, 0, 100);
    player.energyUpdatedAt =
      Number(player.energyUpdatedAt || now()) + recovered * 5 * 60 * 1000;
  }

  return player.energy;
}

function spendEnergy(player, amount) {
  ensureEnergy(player);

  if (player.energy < amount) {
    return false;
  }

  player.energy -= amount;
  player.energyUpdatedAt = now();
  return true;
}

function addHistory(player, text) {
  player.history.push({ at: now(), text });

  if (player.history.length > 60) {
    player.history = player.history.slice(-60);
  }
}

function addItem(player, name, amount = 1) {
  player.inventory[name] = Number(player.inventory[name] || 0) + amount;
}

function addXp(player, amount) {
  player.xp = Number(player.xp || 0) + amount;
  const oldLevel = player.level;
  player.level = 1 + Math.floor(Math.sqrt(player.xp / 120));

  return {
    leveled: player.level > oldLevel,
    oldLevel,
    newLevel: player.level
  };
}

function originQuestion(step) {
  const questions = {
    1:
      'Uma sentinela bloqueia uma saída enquanto desconhecidos estão presos atrás de você.\n\n*A)* Enfrentar a sentinela\n*B)* Observar o padrão dela\n*C)* Proteger os desconhecidos e procurar outra rota',
    2:
      'Você encontra uma relíquia que pulsa quando você toca nela.\n\n*A)* Estudar a relíquia\n*B)* Tentar controlar sua energia\n*C)* Guardá-la até entender quem a procura',
    3:
      'Uma pessoa mascarada oferece uma rota secreta em troca de um favor futuro.\n\n*A)* Aceitar e confiar no instinto\n*B)* Negociar informações antes\n*C)* Recusar e seguir sozinho'
  };

  return questions[step] || '';
}

function applyOrigin(player) {
  const answers = player.originSetup.answers.join('');
  const scores = {
    Arquiteto: 0,
    Espectro: 0,
    Oráculo: 0,
    'Caçador de Ecos': 0,
    Tecnomante: 0
  };

  for (const answer of answers) {
    if (answer === 'A') {
      scores['Caçador de Ecos'] += 2;
      scores.Espectro += 1;
    } else if (answer === 'B') {
      scores.Arquiteto += 1;
      scores.Tecnomante += 2;
    } else {
      scores.Oráculo += 2;
      scores.Arquiteto += 1;
    }
  }

  const [origin] = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])[0];

  player.origin = origin;
  player.originSetup.active = false;

  const buffs = {
    Arquiteto: { intelecto: 2, vontade: 1 },
    Espectro: { reflexo: 2, intelecto: 1 },
    Oráculo: { anomalia: 2, vontade: 1 },
    'Caçador de Ecos': { força: 2, reflexo: 1 },
    Tecnomante: { intelecto: 2, anomalia: 1 }
  };

  for (const [attribute, amount] of Object.entries(buffs[origin] || {})) {
    player.attributes[attribute] += amount;
  }

  addHistory(player, `Origem revelada: ${origin}.`);

  return origin;
}

function playerPanel(player) {
  ensureEnergy(player);

  const conditionText = player.conditions.length
    ? player.conditions.join(', ')
    : 'Estável';

  return (
    `╭━━━〔 NOX • VIAJANTE 〕━━━╮\n` +
    `┃ ${player.name}\n` +
    `┃ Origem: *${player.origin || 'não revelada'}*\n` +
    `┃ Nível: *${player.level}* • XP: *${player.xp}*\n` +
    `┃ Energia: *${player.energy}/100*\n` +
    `┃ Local: *${player.location}*\n` +
    `┃ Estado: *${conditionText}*\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `Use *!mapa*, *!explorar*, *!missao* e *!inventario*.`
  );
}

function worldPanel() {
  return (
    `╭━━━〔 NOX • MUNDO 〕━━━╮\n` +
    `┃ Temporada: *${state.world.season} — A Ruptura*\n` +
    `┃ Ciclo mundial: *${state.world.cycle}*\n` +
    `┃ Regiões descobertas: *${state.world.discovered.length}*\n` +
    `┃ Decisões registradas: *${state.world.decisions.length}*\n` +
    `╰━━━━━━━━━━━━━━━━━━━╯`
  );
}

function rpgHelp() {
  return (
    `╭━━━〔 NOX • RPG 〕━━━╮\n` +
    `┃ !rpg — painel\n` +
    `┃ !rpg criar Nome\n` +
    `┃ !rpg escolher A/B/C\n` +
    `┃ !personagem\n` +
    `┃ !inventario\n` +
    `┃ !mapa\n` +
    `┃ !explorar\n` +
    `┃ !acao texto\n` +
    `┃ !missao\n` +
    `┃ !viajar local\n` +
    `┃ !habilidades\n` +
    `┃ !faccoes\n` +
    `┃ !reputacao\n` +
    `┃ !historia\n` +
    `┃ !rankingrpg\n` +
    `┃ !codex\n` +
    `┃ !evento\n` +
    `╰━━━━━━━━━━━━━━━━━━╯`
  );
}

async function handleCreate(sock, jid, msg, args) {
  const id = playerId(msg);

  if (state.players[id]) {
    await send(sock, jid, '⚠️ Você já possui um Viajante. Use *!personagem*.', msg);
    return;
  }

  const name = args.trim().slice(0, 28);

  if (!name) {
    await send(sock, jid, 'Use *!rpg criar NomeDoPersonagem*.', msg);
    return;
  }

  const player = createPlayer(id, name);
  state.players[id] = player;
  scheduleSave();

  await send(
    sock,
    jid,
    `🌑 *NOX // DESPERTAR*\n\n` +
      `Você acorda em Arkan sem uma classe definida. Suas próximas escolhas revelarão sua Origem.\n\n` +
      `*Escolha 1/3*\n${originQuestion(1)}\n\n` +
      `Responda com *!rpg escolher A*, *B* ou *C*.`,
    msg
  );
}

async function handleOriginChoice(sock, jid, msg, choice) {
  const player = getPlayer(msg);

  if (!player) {
    await send(sock, jid, 'Crie seu Viajante com *!rpg criar Nome*.', msg);
    return;
  }

  if (!player.originSetup?.active) {
    await send(sock, jid, `Sua Origem já foi revelada: *${player.origin}*.`, msg);
    return;
  }

  const answer = String(choice).trim().toUpperCase();

  if (!['A', 'B', 'C'].includes(answer)) {
    await send(sock, jid, 'Escolha *A*, *B* ou *C*.', msg);
    return;
  }

  player.originSetup.answers.push(answer);

  if (player.originSetup.step < 3) {
    player.originSetup.step += 1;
    scheduleSave();

    await send(
      sock,
      jid,
      `*Escolha ${player.originSetup.step}/3*\n${originQuestion(player.originSetup.step)}\n\n` +
        `Responda com *!rpg escolher A*, *B* ou *C*.`,
      msg
    );
    return;
  }

  const origin = applyOrigin(player);
  player.xp += 25;
  scheduleSave();

  await send(
    sock,
    jid,
    `⚡ *ORIGEM REVELADA*\n\nVocê é um(a) *${origin}*.\n\n` +
      `A Edith // Núcleo 01 registrou sua assinatura entre os Ecos.\n` +
      `Sua primeira missão foi liberada: *O Sinal de Vesper*.\n\n` +
      `Use *!personagem* e depois *!missao*.`,
    msg
  );
}

function inventoryText(player) {
  const items = Object.entries(player.inventory)
    .filter(([, amount]) => Number(amount) > 0)
    .sort((a, b) => b[1] - a[1]);

  const lines = items.length
    ? items.map(([name, amount]) => `• ${name} ×${amount}`).join('\n')
    : 'Inventário vazio.';

  return (
    `🎒 *INVENTÁRIO // ${player.name}*\n\n` +
    `${lines}\n\n` +
    `💳 Créditos: *${player.credits}*\n` +
    `◈ Fragmentos: *${player.fragments}*\n` +
    `◉ Ecos: *${player.echoes}*`
  );
}

function mapText(player) {
  const all = Object.keys(LOCATIONS);
  const lines = all.map((name) => {
    const discovered =
      state.world.discovered.includes(name) ||
      player.codex.locations.includes(name);

    if (!discovered) return '• ???';

    const here = player.location === name ? ' ← VOCÊ' : '';
    return `• ${name}${here}`;
  });

  return (
    `🗺️ *MAPA // ARKAN*\n\n` +
    `${lines.join('\n')}\n\n` +
    `Descobertas globais: *${state.world.discovered.length}/${all.length}*\n` +
    `Use *!viajar nome-do-local*.`
  );
}

function unlockLocation(player, location) {
  let first = false;

  if (!player.codex.locations.includes(location)) {
    player.codex.locations.push(location);
  }

  if (!state.world.discovered.includes(location)) {
    state.world.discovered.push(location);
    state.world.firstDiscoveries[location] = {
      player: player.name,
      at: now()
    };
    first = true;
  }

  return first;
}

function explorationPool(player) {
  const pools = {
    'Refúgio Nulo': [
      {
        text: 'Um rádio quebrado repete coordenadas da Estação Vesper.',
        discover: 'Estação Vesper',
        xp: 18
      },
      {
        text: 'Você encontra um Fragmento de Eco preso sob uma placa metálica.',
        item: 'Fragmento de Eco',
        xp: 10
      }
    ],
    'Estação Vesper': [
      {
        text: 'Uma porta de manutenção abre para um corredor que não aparece no mapa.',
        discover: 'Ruínas de Oris',
        xp: 22
      },
      {
        text: 'Uma célula de energia ainda funciona. A estação reage quando você a remove.',
        item: 'Célula Vesper',
        xp: 16
      },
      {
        encounter: true,
        title: 'Sentinela Vesper',
        text: 'Uma sentinela desperta e bloqueia o corredor. Luzes vermelhas acompanham seus movimentos.',
        difficulty: 7,
        reward: 'Célula Vesper'
      }
    ],
    'Ruínas de Oris': [
      {
        text: 'Atrás de uma parede rachada, você encontra um caminho tomado por árvores cristalizadas.',
        discover: 'Bosque de Vidro',
        xp: 28
      },
      {
        text: 'Símbolos nas ruínas formam uma chave quando vistos pelo reflexo.',
        item: 'Chave de Oris',
        xp: 20
      },
      {
        encounter: true,
        title: 'Eco Desalinhado',
        text: 'Uma presença instável copia seus movimentos com alguns segundos de atraso.',
        difficulty: 9,
        reward: 'Fragmento de Eco'
      }
    ],
    'Bosque de Vidro': [
      {
        text: 'Um reflexo mostra o Portão IX aberto por um único instante.',
        discover: 'Portão IX',
        xp: 34
      },
      {
        text: 'Uma folha cristalizada preserva uma memória desconhecida.',
        item: 'Vidro Mnêmico',
        xp: 24
      },
      {
        encounter: true,
        title: 'Observador de Vidro',
        text: 'Uma figura translúcida acompanha você entre os reflexos sem se aproximar.',
        difficulty: 11,
        reward: 'Vidro Mnêmico'
      }
    ],
    'Portão IX': [
      {
        encounter: true,
        title: 'Pulso do Portão IX',
        text: 'O Portão responde à sua presença e projeta três símbolos no chão.',
        difficulty: 13,
        reward: 'Selo do Portão IX'
      }
    ]
  };

  return pools[player.location] || pools['Refúgio Nulo'];
}

async function explore(sock, jid, msg) {
  const player = getPlayer(msg);

  if (!player) {
    await send(sock, jid, 'Crie seu Viajante com *!rpg criar Nome*.', msg);
    return;
  }

  if (player.originSetup?.active) {
    await send(sock, jid, 'Finalize suas escolhas de Origem primeiro.', msg);
    return;
  }

  if (player.pendingEncounter) {
    await send(
      sock,
      jid,
      `⚠️ Você ainda está em um encontro: *${player.pendingEncounter.title}*.\nUse *!acao descrição-do-que-você-faz*.`,
      msg
    );
    return;
  }

  if (!spendEnergy(player, 12)) {
    await send(
      sock,
      jid,
      `⚡ Energia insuficiente: *${player.energy}/100*.\nVocê recupera 1 ponto a cada 5 minutos.`,
      msg
    );
    return;
  }

  const event = randomItem(explorationPool(player));

  if (event.encounter) {
    player.pendingEncounter = {
      id: `enc_${now()}`,
      title: event.title,
      text: event.text,
      difficulty: event.difficulty,
      reward: event.reward,
      attempts: 0
    };
    scheduleSave();

    await send(
      sock,
      jid,
      `⚠️ *ENCONTRO // ${event.title}*\n\n${event.text}\n\n` +
        `Escreva sua estratégia com *!acao ...*\n` +
        `Ex.: *!acao observo o padrão e procuro uma falha no sistema*.`,
      msg
    );
    return;
  }

  let extra = '';

  if (event.discover) {
    const first = unlockLocation(player, event.discover);
    extra += `\n\n🗺️ Local descoberto: *${event.discover}*`;

    if (first) {
      extra += `\n🌐 *PRIMEIRA DESCOBERTA GLOBAL* — o mapa mudou para todos os Viajantes.`;
      state.world.events.push({
        at: now(),
        type: 'discovery',
        text: `${player.name} descobriu ${event.discover}.`
      });
    }
  }

  if (event.item) {
    addItem(player, event.item, 1);
    extra += `\n\n🎒 Encontrado: *${event.item}* ×1`;
  }

  const xpResult = addXp(player, event.xp || 10);
  addHistory(player, event.text);

  if (
    player.mission?.id === 'sinal_vesper' &&
    !player.mission.completed &&
    (player.location === 'Estação Vesper' || event.discover === 'Estação Vesper')
  ) {
    player.mission.progress += 1;
  }

  if (xpResult.leveled) {
    extra += `\n⬆️ Nível aumentado: *${xpResult.newLevel}*`;
  }

  scheduleSave();

  await send(
    sock,
    jid,
    `🌒 *EXPLORAÇÃO // ${player.location}*\n\n${event.text}${extra}\n\n⚡ Energia: *${player.energy}/100*`,
    msg
  );
}

function classifyAction(text = '') {
  const normalized = text.toLowerCase();

  const groups = [
    {
      attribute: 'intelecto',
      words: ['observo', 'analiso', 'padrão', 'sistema', 'falha', 'planejo', 'estudo', 'hack']
    },
    {
      attribute: 'reflexo',
      words: ['desvio', 'corro', 'rápido', 'esquivo', 'salto', 'flanco', 'silêncio']
    },
    {
      attribute: 'força',
      words: ['ataco', 'quebro', 'empurro', 'enfrento', 'força', 'derrubo', 'golpe']
    },
    {
      attribute: 'vontade',
      words: ['resisto', 'protejo', 'mantenho', 'concentro', 'coragem', 'ignoro']
    },
    {
      attribute: 'anomalia',
      words: ['eco', 'anomalia', 'energia', 'relíquia', 'ruptura', 'sinal', 'portal']
    }
  ];

  let best = { attribute: 'vontade', score: 0 };

  for (const group of groups) {
    const score = group.words.filter((word) => normalized.includes(word)).length;
    if (score > best.score) best = { attribute: group.attribute, score };
  }

  return best.attribute;
}

async function resolveAction(sock, jid, msg, args) {
  const player = getPlayer(msg);

  if (!player) {
    await send(sock, jid, 'Crie seu Viajante com *!rpg criar Nome*.', msg);
    return;
  }

  const encounter = player.pendingEncounter;

  if (!encounter) {
    await send(sock, jid, 'Não há um encontro ativo. Use *!explorar*.', msg);
    return;
  }

  const actionText = args.trim();

  if (actionText.length < 4) {
    await send(sock, jid, 'Descreva sua ação. Ex.: *!acao procuro uma falha na sentinela*.', msg);
    return;
  }

  encounter.attempts += 1;
  const attribute = classifyAction(actionText);
  const attributeValue = Number(player.attributes[attribute] || 0);
  const originBonus =
    (player.origin === 'Tecnomante' && attribute === 'intelecto') ||
    (player.origin === 'Espectro' && attribute === 'reflexo') ||
    (player.origin === 'Caçador de Ecos' && attribute === 'força') ||
    (player.origin === 'Oráculo' && attribute === 'anomalia') ||
    (player.origin === 'Arquiteto' && attribute === 'intelecto')
      ? 2
      : 0;

  const roll = Math.floor(Math.random() * 10) + 1;
  const total = roll + attributeValue + originBonus;
  const success = total >= encounter.difficulty;

  state.world.decisions.push({
    id: `DEC-${String(state.world.decisions.length + 1).padStart(5, '0')}`,
    player: player.name,
    at: now(),
    encounter: encounter.title,
    action: actionText.slice(0, 180),
    attribute,
    success
  });

  if (state.world.decisions.length > 250) {
    state.world.decisions = state.world.decisions.slice(-250);
  }

  if (success) {
    addItem(player, encounter.reward, 1);
    const xpResult = addXp(player, 32 + encounter.difficulty * 2);
    addHistory(
      player,
      `Superou ${encounter.title} usando ${attribute}: ${actionText.slice(0, 120)}`
    );

    if (
      player.mission?.id === 'sinal_vesper' &&
      !player.mission.completed &&
      player.location === 'Estação Vesper'
    ) {
      player.mission.progress += 2;
    }

    player.pendingEncounter = null;
    scheduleSave();

    await send(
      sock,
      jid,
      `✅ *AÇÃO BEM-SUCEDIDA*\n\n` +
        `Estratégia: ${actionText}\n` +
        `Atributo usado: *${attribute}*\n` +
        `Resultado: *${total}* vs dificuldade *${encounter.difficulty}*\n\n` +
        `🎒 Recompensa: *${encounter.reward}*\n` +
        `✨ XP recebido: *${32 + encounter.difficulty * 2}*` +
        (xpResult.leveled ? `\n⬆️ Novo nível: *${xpResult.newLevel}*` : ''),
      msg
    );
    return;
  }

  const conditions = ['Exausto', 'Desorientado', 'Instável'];
  const condition = randomItem(conditions);

  if (!player.conditions.includes(condition)) {
    player.conditions.push(condition);
  }

  player.energy = clamp(player.energy - 8, 0, 100);

  if (encounter.attempts >= 3) {
    player.pendingEncounter = null;
    addHistory(player, `Recuou de ${encounter.title} após três tentativas.`);
    scheduleSave();

    await send(
      sock,
      jid,
      `↩️ *RECUO*\n\nSua estratégia não abriu uma oportunidade segura. Após três tentativas, você recua.\n` +
        `Estado adquirido: *${condition}*.\nUse *!explorar* novamente quando estiver pronto.`,
      msg
    );
    return;
  }

  scheduleSave();

  await send(
    sock,
    jid,
    `⚠️ *A AÇÃO NÃO SAIU COMO ESPERADO*\n\n` +
      `Atributo usado: *${attribute}*\n` +
      `Resultado: *${total}* vs dificuldade *${encounter.difficulty}*\n` +
      `Estado: *${condition}*\n\n` +
      `Você ainda pode tentar outra abordagem com *!acao ...*.`,
    msg
  );
}

async function showMission(sock, jid, msg) {
  const player = getPlayer(msg);

  if (!player) {
    await send(sock, jid, 'Crie seu Viajante com *!rpg criar Nome*.', msg);
    return;
  }

  const mission = player.mission;

  if (mission.completed) {
    await send(
      sock,
      jid,
      `✅ *MISSÃO CONCLUÍDA*\n${mission.name}\n\nNovas missões chegarão conforme o mundo mudar.`,
      msg
    );
    return;
  }

  const ready = mission.progress >= 3;

  if (ready) {
    mission.completed = true;
    player.credits += 180;
    player.fragments += 3;
    player.echoes += 1;
    addItem(player, 'Célula Vesper', 1);
    addXp(player, 120);
    addHistory(player, 'Concluiu a missão O Sinal de Vesper.');
    scheduleSave();

    await send(
      sock,
      jid,
      `✅ *MISSÃO CONCLUÍDA // O SINAL DE VESPER*\n\n` +
        `Você reuniu sinais suficientes para provar que a Estação Vesper está transmitindo para outro Eco.\n\n` +
        `💳 +180 créditos\n◈ +3 fragmentos\n◉ +1 Eco\n✨ +120 XP\n\n` +
        `Uma nova mensagem apareceu no Núcleo 01:\n_"Não deixem o Portão IX abrir novamente."_ `,
      msg
    );
    return;
  }

  await send(
    sock,
    jid,
    `📡 *MISSÃO // O SINAL DE VESPER*\n\n` +
      `Investigue a Estação Vesper e reúna evidências do sinal impossível.\n\n` +
      `Progresso: *${mission.progress}/3*\n` +
      `Dica: descubra a estação, viaje até ela e explore.`,
    msg
  );
}

async function travel(sock, jid, msg, args) {
  const player = getPlayer(msg);

  if (!player) {
    await send(sock, jid, 'Crie seu Viajante com *!rpg criar Nome*.', msg);
    return;
  }

  const query = args.trim().toLowerCase();

  if (!query) {
    await send(sock, jid, 'Use *!viajar nome-do-local*. Veja *!mapa*.', msg);
    return;
  }

  const destination = Object.keys(LOCATIONS).find((name) =>
    name.toLowerCase().includes(query)
  );

  if (!destination) {
    await send(sock, jid, '❌ Local não reconhecido. Veja *!mapa*.', msg);
    return;
  }

  const known =
    state.world.discovered.includes(destination) ||
    player.codex.locations.includes(destination);

  if (!known) {
    await send(sock, jid, '🔒 Esse local ainda não foi descoberto.', msg);
    return;
  }

  if (destination === player.location) {
    await send(sock, jid, `Você já está em *${destination}*.`, msg);
    return;
  }

  if (!spendEnergy(player, 6)) {
    await send(sock, jid, '⚡ Energia insuficiente para viajar.', msg);
    return;
  }

  player.location = destination;
  player.pendingEncounter = null;
  addHistory(player, `Viajou para ${destination}.`);
  scheduleSave();

  await send(
    sock,
    jid,
    `🧭 *VIAGEM CONCLUÍDA*\n\nVocê chegou a *${destination}*.\n${LOCATIONS[destination].description}\n\n⚡ Energia: *${player.energy}/100*`,
    msg
  );
}

function abilitiesText(player) {
  const a = player.attributes;

  return (
    `⚡ *ATRIBUTOS // ${player.name}*\n\n` +
    `Força: *${a.força}*\n` +
    `Reflexo: *${a.reflexo}*\n` +
    `Intelecto: *${a.intelecto}*\n` +
    `Vontade: *${a.vontade}*\n` +
    `Anomalia: *${a.anomalia}*\n\n` +
    `Origem: *${player.origin || 'não revelada'}*\n` +
    `Suas ações em encontros usam automaticamente o atributo mais coerente com o texto.`
  );
}

function factionText(player) {
  return (
    `🏛️ *FACÇÕES DE ARKAN*\n\n` +
    FACTIONS.map((faction) =>
      `*${faction.name}*\n${faction.text}\nReputação: *${player.reputation[faction.name] || 0}*`
    ).join('\n\n')
  );
}

function reputationText(player) {
  return (
    `⚖️ *REPUTAÇÃO // ${player.name}*\n\n` +
    Object.entries(player.reputation)
      .map(([name, value]) => `• ${name}: *${value >= 0 ? '+' : ''}${value}*`)
      .join('\n')
  );
}

function historyText(player) {
  const lines = player.history
    .slice(-8)
    .reverse()
    .map((entry, index) => `${index + 1}. ${entry.text}`);

  return `📖 *HISTÓRIA // ${player.name}*\n\n${lines.join('\n')}`;
}

function codexText(player) {
  const locations = player.codex.locations.join(', ') || 'nenhum';
  const relics = Object.keys(player.inventory)
    .filter((item) => ['Chave de Oris', 'Vidro Mnêmico', 'Selo do Portão IX'].includes(item))
    .join(', ') || 'nenhuma';

  return (
    `📚 *CODEX // ${player.name}*\n\n` +
    `Locais: *${locations}*\n` +
    `Relíquias conhecidas: *${relics}*\n` +
    `Criaturas catalogadas: *${player.codex.creatures.length}*`
  );
}

function eventText() {
  const latest = state.world.events.slice(-5).reverse();

  if (!latest.length) {
    return (
      `📡 *EVENTOS DO MUNDO*\n\n` +
      `Nenhum evento global foi registrado ainda.\n` +
      `Explore Arkan. O mundo muda quando alguém encontra algo novo.`
    );
  }

  return (
    `📡 *EVENTOS DO MUNDO*\n\n` +
    latest.map((event, index) => `${index + 1}. ${event.text}`).join('\n')
  );
}

async function ranking(sock, jid, msg) {
  const ranking = Object.values(state.players)
    .filter((player) => !player.originSetup?.active)
    .sort((a, b) => b.level - a.level || b.xp - a.xp)
    .slice(0, 10);

  if (!ranking.length) {
    await send(sock, jid, 'Ainda não há Viajantes no ranking.', msg);
    return;
  }

  const lines = ranking.map(
    (player, index) =>
      `${index + 1}. *${player.name}* — Nv. ${player.level} • ${player.xp} XP • ${player.origin}`
  );

  await send(sock, jid, `🏆 *RANKING // NOX*\n\n${lines.join('\n')}`, msg);
}

export function isNoxCommand(command) {
  return [
    'rpg',
    'personagem',
    'inventario',
    'mapa',
    'explorar',
    'acao',
    'missao',
    'viajar',
    'habilidades',
    'faccoes',
    'reputacao',
    'historia',
    'rankingrpg',
    'codex',
    'evento'
  ].includes(command);
}

export async function handleNoxCommand(sock, jid, msg, command, args = '') {
  if (command === 'rpg') {
    const [subcommand, ...rest] = args.trim().split(/\s+/);
    const sub = (subcommand || '').toLowerCase();
    const restText = rest.join(' ');

    if (sub === 'criar') {
      await handleCreate(sock, jid, msg, restText);
      return true;
    }

    if (sub === 'escolher') {
      await handleOriginChoice(sock, jid, msg, restText);
      return true;
    }

    if (sub === 'mundo') {
      await send(sock, jid, worldPanel(), msg);
      return true;
    }

    const player = getPlayer(msg);

    if (!player) {
      await send(
        sock,
        jid,
        `🌑 *NOX // ECOS DO ÚLTIMO MUNDO*\n\n` +
          `Um RPG persistente onde as descobertas de um jogador mudam o mapa para todos.\n\n` +
          `Comece com *!rpg criar NomeDoPersonagem*.\n\n${rpgHelp()}`,
        msg
      );
      return true;
    }

    await send(sock, jid, `${playerPanel(player)}\n\n${rpgHelp()}`, msg);
    return true;
  }

  const player = getPlayer(msg);

  if (!player) {
    await send(sock, jid, '🌑 Você ainda não é um Viajante. Use *!rpg criar Nome*.', msg);
    return true;
  }

  if (command === 'personagem') {
    await send(sock, jid, playerPanel(player), msg);
  } else if (command === 'inventario') {
    await send(sock, jid, inventoryText(player), msg);
  } else if (command === 'mapa') {
    await send(sock, jid, mapText(player), msg);
  } else if (command === 'explorar') {
    await explore(sock, jid, msg);
  } else if (command === 'acao') {
    await resolveAction(sock, jid, msg, args);
  } else if (command === 'missao') {
    await showMission(sock, jid, msg);
  } else if (command === 'viajar') {
    await travel(sock, jid, msg, args);
  } else if (command === 'habilidades') {
    await send(sock, jid, abilitiesText(player), msg);
  } else if (command === 'faccoes') {
    await send(sock, jid, factionText(player), msg);
  } else if (command === 'reputacao') {
    await send(sock, jid, reputationText(player), msg);
  } else if (command === 'historia') {
    await send(sock, jid, historyText(player), msg);
  } else if (command === 'rankingrpg') {
    await ranking(sock, jid, msg);
  } else if (command === 'codex') {
    await send(sock, jid, codexText(player), msg);
  } else if (command === 'evento') {
    await send(sock, jid, eventText(), msg);
  }

  scheduleSave();
  return true;
}
