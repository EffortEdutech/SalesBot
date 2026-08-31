import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('../apps/bridge-api/src/server.ts', import.meta.url);
let source = await readFile(file, 'utf8');

const importLine = "import { registerOperatorRoutes } from './routes/operator-routes.js';";
if (!source.includes(importLine)) {
  const imports = [...source.matchAll(/^import .*?;\s*$/gm)];
  if (!imports.length)
    throw new Error('Could not find import block in apps/bridge-api/src/server.ts');
  const last = imports.at(-1);
  const pos = last.index + last[0].length;
  source = `${source.slice(0, pos)}\n${importLine}${source.slice(pos)}`;
}

const call = 'registerOperatorRoutes(app, pool);';
if (!source.includes(call)) {
  const listenIndex = source.search(/(?:await\s+)?app\.listen\s*\(/);
  if (listenIndex < 0)
    throw new Error('Could not find app.listen(...) in apps/bridge-api/src/server.ts');
  const lineStart = source.lastIndexOf('\n', listenIndex) + 1;
  source = `${source.slice(0, lineStart)}${call}\n\n${source.slice(lineStart)}`;
}

await writeFile(file, source, 'utf8');
console.log('Package 13 operator routes registered without replacing existing M1 server routes.');
