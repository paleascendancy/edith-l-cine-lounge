import { readFile, writeFile } from 'node:fs/promises';

const registryPath = new URL('../src/v2/registry.ts', import.meta.url);
let registry = await readFile(registryPath, 'utf8');

const removals = [
  "v2('agenda', 'cinema'), ",
  "v2('agenda', 'cinema'),",
  "legacy('agenda', 'cinema'), ",
  "legacy('agenda', 'cinema'),"
];
for (const needle of removals) registry = registry.replace(needle, '');

const blockedNames = ['cortar', 'roteiro', 'liberar', 'cancelarlembrete', 'recorrente', 'alarme', 'tarefas', 'notas', 'calculadora', 'porcentagem', 'sorteioagendado'];
for (const name of blockedNames) {
  const patterns = [
    new RegExp(`\\s*legacy\\('${name}'[^\\n]*?\\),?`, 'g'),
    new RegExp(`\\s*v2\\('${name}'[^\\n]*?\\),?`, 'g')
  ];
  for (const pattern of patterns) registry = registry.replace(pattern, '');
}

await writeFile(registryPath, registry, 'utf8');
console.log('[REMOVALS] Comandos excluídos pelo dono foram removidos do registry V2.');
