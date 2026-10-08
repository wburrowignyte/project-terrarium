#!/usr/bin/env node
// ERD.md -> self-contained interactive HTML. No dependencies, no network.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseErd } from './lib/parse.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const USAGE = `Usage: node erd-view.mjs <ERD.md> [-o out.html] [--json] [--open]
  Converts an ERD.md (project-terrarium format) into one self-contained HTML viewer.
  -o, --out   output path (default: <input dir>/<input name>.html)
  --json      also print the parsed model to stdout instead of writing HTML
  --open      open the result in the default browser`;

export function render(md) {
  const model = parseErd(md);
  const tpl = readFileSync(join(here, 'lib', 'template.html'), 'utf8');
  // Escape characters that could terminate the inline <script> or be misread by the HTML parser.
  const json = JSON.stringify(model).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return { model, html: tpl.replace('/*__MODEL__*/null', () => json) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let input, out, open = false, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-o' || a === '--out') { out = args[++i]; if (!out || out.startsWith('-')) { console.error(`${a} needs a path\n${USAGE}`); process.exit(2); } }
    else if (a === '--open') open = true;
    else if (a === '--json') json = true;
    else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
    else if (!input) input = a;
    else { console.error(`Unexpected argument: ${a}\n${USAGE}`); process.exit(2); }
  }
  if (!input) { console.error(USAGE); process.exit(2); }
  if (!existsSync(input)) { console.error(`File not found: ${input}`); process.exit(2); }
  const { model, html } = render(readFileSync(input, 'utf8'));
  if (!model.entities.length) { console.error(`No entities found in ${input}. Expected "### E-n Name (\`TABLE\`)" sections or a mermaid erDiagram block.`); process.exit(1); }
  for (const w of model.warnings) console.error(`warning: ${w}`);
  if (json) { console.log(JSON.stringify(model, null, 2)); process.exit(0); }
  const dest = resolve(out ?? join(dirname(input), basename(input).replace(/\.md$/i, '') + '.html'));
  writeFileSync(dest, html);
  console.log(`${dest}\n${model.entities.length} entities, ${model.relationships.length} relationships, ${(html.length / 1024).toFixed(0)} KB`);
  if (open) spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open', process.platform === 'win32' ? ['/c', 'start', '', dest] : [dest], { stdio: 'ignore', detached: true }).unref();
}
