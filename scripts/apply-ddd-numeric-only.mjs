import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/services/essential-utils.js', import.meta.url);
let src = await readFile(path, 'utf8');

if (src.includes('DDD_NUMERIC_ONLY_V1')) {
  console.log('[DDD] Numeric-only mode already applied.');
  process.exit(0);
}

const oldBlock = `    if (command === 'ddd') {\n      const input = String(args || '').trim();\n      if (!input) { await send(sock, jid, msg, '📞 Use *!ddd 95* ou *!ddd Boa Vista*.'); return true; }\n      let ddd;\n      let info;\n      if (/^\\d{2}$/.test(input)) {\n        ddd = Number(input);\n        info = await dddInfo(ddd);\n      } else {\n        const result = await searchDddByCity(input);\n        ddd = result.ddd;\n        info = result.info;\n      }\n      const uf = String(info?.state || '').toUpperCase();\n      const stateName = STATE_NAMES[uf] || uf;\n      const cities = (info?.cities || []).slice().sort((a, b) => a.localeCompare(b, 'pt-BR'));\n      const list = cities.map((city) => \`• \${city}\`).join('\\n');\n      await send(sock, jid, msg, \`📞 *DDD \${ddd}*\\n\\n📍 Estado: *\${stateName} — \${uf}*\\n🏙️ Cidades atendidas (\${cities.length}):\\n\${list}\`);\n      return true;\n    }`;

const newBlock = `    if (command === 'ddd') {\n      const DDD_NUMERIC_ONLY_V1 = true;\n      const input = String(args || '').trim();\n      if (!/^\\d{2}$/.test(input)) {\n        await send(sock, jid, msg, '📞 Use *!ddd 95*. Informe apenas os 2 números do DDD.');\n        return true;\n      }\n      const ddd = Number(input);\n      const info = await dddInfo(ddd);\n      const uf = String(info?.state || '').toUpperCase();\n      const stateName = STATE_NAMES[uf] || uf;\n      const cities = (info?.cities || []).slice().sort((a, b) => a.localeCompare(b, 'pt-BR'));\n      const list = cities.map((city) => \`• \${city}\`).join('\\n');\n      await send(sock, jid, msg, \`📞 *DDD \${ddd}*\\n\\n📍 Estado: *\${stateName} — \${uf}*\\n🏙️ Cidades atendidas (\${cities.length}):\\n\${list}\`);\n      return true;\n    }`;

if (!src.includes(oldBlock)) {
  console.error('[DDD] Could not locate existing DDD handler.');
  process.exit(1);
}

src = src.replace(oldBlock, newBlock);
await writeFile(path, src, 'utf8');
console.log('[DDD] !ddd agora aceita somente DDD numérico.');
