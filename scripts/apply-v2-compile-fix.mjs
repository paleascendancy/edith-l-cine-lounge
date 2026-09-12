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

await writeFile(path, src, 'utf8');
console.log('[V2] Ajustes de compilação TypeScript aplicados.');
