import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/v2/runtime.ts', import.meta.url);
let src = await readFile(path, 'utf8');

src = src.replace(
  "  if (results.length === 1) return { resolved: results[0] };",
  "  if (results.length === 1 && results[0]) return { resolved: results[0] };"
);

src = src.replace(
  `    let result: { title: string; votes: number } | null = null;\n    await s.mutate((state) => { const item = (state.groupSuggestions[ctx.jid] ?? []).find((entry) => entry.id === id); if (item) { if (!item.votes.includes(userId)) item.votes.push(userId); result = { title: item.title, votes: item.votes.length }; } });`,
  `    const result = await s.mutate((state): { title: string; votes: number } | null => { const item = (state.groupSuggestions[ctx.jid] ?? []).find((entry) => entry.id === id); if (!item) return null; if (!item.votes.includes(userId)) item.votes.push(userId); return { title: item.title, votes: item.votes.length }; });`
);

if (!src.includes("from './capabilities.js'")) {
  const anchor = "import { discoverMovie, searchTitles, tmdbConfigured, type TmdbTitle } from './tmdb.js';";
  src = src.replace(anchor, `${anchor}\nimport { handleCapabilityCommand } from './capabilities.js';`);
}

if (!src.includes("from './quiz.js'")) {
  const anchor = "import { handleCapabilityCommand } from './capabilities.js';";
  src = src.replace(anchor, `${anchor}\nimport { handleQuizCommand } from './quiz.js';`);
}

if (!src.includes('await handleCapabilityCommand({')) {
  const anchor = '  if (await handlePrivacy(ctx, def.name, parsed.args, userId)) return true;';
  const injected = `  if (await handleCapabilityCommand({ sock: ctx.sock, jid: ctx.jid, msg: ctx.msg, prefix: ctx.prefix, isVip: ctx.isVip, isOwner: ctx.isOwner }, def.name, parsed.args)) return true;\n${anchor}`;
  src = src.replace(anchor, injected);
}

if (!src.includes('await handleQuizCommand(currentStore()')) {
  const anchor = '  if (await handlePrivacy(ctx, def.name, parsed.args, userId)) return true;';
  const injected = `  if (def.name === 'quiz' && await handleQuizCommand(currentStore(), { sock: ctx.sock, jid: ctx.jid, msg: ctx.msg, prefix: ctx.prefix, isGroupAllowed: ctx.isGroupAllowed }, parsed.args, userId)) return true;\n${anchor}`;
  src = src.replace(anchor, injected);
}

await writeFile(path, src, 'utf8');
console.log('[V2] Ajustes de compilação, capacidades e quiz aplicados.');
