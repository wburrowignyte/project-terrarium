// Generates a synthetic large ERD.md (contract format) for load/layout testing. Usage: node gen-large.mjs [n=150] [--grouped] > out.md
// opts.grouped adds ## Groups, a Group bullet per entity, a SYN_LOOKUP table and FK→LOOKUP fields.
export function genLarge(n = 150, seed = 7, opts = {}) {
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const kinds = ['Core', 'Core', 'Core', 'Reference', 'Junction', 'History/Audit'];
  const ents = Array.from({ length: n }, (_, i) => {
    const kind = i < 12 ? 'Reference' : kinds[Math.floor(rnd() * kinds.length)];
    return { id: i + 1, kind, table: `SYN_${kind === 'Reference' ? 'REF' : 'ENT'}_${String(i + 1).padStart(3, '0')}`, sens: rnd() < 0.15 ? 'PII' : 'None' };
  });
  const rels = [];
  const ng = Math.max(3, Math.round(n / 12)), lkId = n + 1, lkRels = [];
  ents.forEach((e, i) => { e.group = `Group ${(i % ng) + 1}`; e.lk = []; });
  ents.forEach((e, i) => {
    e.fk = [];
    if (i < 12) return;
    const k = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < k; j++) { const p = rnd() < 0.3 ? Math.floor(rnd() * 12) : Math.floor(rnd() * i); if (p !== i && !e.fk.includes(p)) { e.fk.push(p); rels.push([i, p]); } }
  });
  if (opts.grouped) ents.forEach((e, i) => { if (i >= 12 && rnd() < 0.2) { const t = `T${1 + Math.floor(rnd() * 8)}`; e.lk.push(t); lkRels.push([i, t]); } });
  let md = `# Synthetic ERD (${n})\n\n| | |\n|---|---|\n| Version | 1 |\n| Last updated | 2026-10-08 |\n| Application prefix | SYN |\n| Target database | Oracle |\n| Status | Draft |\n\n## Summary\nGenerated.\n${opts.grouped ? '\n## Groups\n\n| Order | Group | Description |\n|---|---|---|\n' + Array.from({ length: ng }, (_, g) => `| ${g + 1} | Group ${g + 1} | Synthetic group ${g + 1} |`).join('\n') + '\n' : ''}\n## Diagram\n\n\`\`\`mermaid\nerDiagram\n`;
  for (const [c, p] of rels) md += `    ${ents[p].table} ||--o{ ${ents[c].table} : "has"\n`;
  md += '```\n\n## Entities\n\n';
  for (const e of ents) {
    md += `### E-${e.id} Entity ${e.id} (\`${e.table}\`)\n- **Purpose:** Synthetic entity ${e.id}.\n- **Kind:** ${e.kind}\n${opts.grouped ? `- **Group:** ${e.group}\n` : ''}- **Est. volume:** unknown\n- **Sensitivity:** ${e.sens}\n- **Sources:** CONVENTION\n\n| Field | Column | Type | Req | Key | Description | Sources |\n|---|---|---|---|---|---|---|\n| id | ID | Integer | Y | PK | Surrogate key | CONVENTION |\n`;
    for (const p of e.fk) md += `| ref${p + 1}Id | REF${p + 1}_ID | Integer | ${rnd() < 0.5 ? 'Y' : 'N'} | FK→E-${p + 1} | Parent | CONVENTION |\n`;
    for (const t of e.lk) md += `| ${t.toLowerCase()}Id | ${t}_ID | Integer | N | FK→LOOKUP:${t} | Code | CONVENTION |\n`;
    const extra = 2 + Math.floor(rnd() * 10);
    for (let f = 0; f < extra; f++) md += `| attr${f} | ATTR_${f} | ${['Text', 'Date', 'Decimal', 'Boolean'][f % 4]} | N | | Attribute ${f} | CONVENTION |\n`;
    md += '\n';
  }
  if (opts.grouped) md += `### E-${lkId} Lookup (\`SYN_LOOKUP\`)\n- **Purpose:** Shared code list.\n- **Kind:** Lookup\n- **Est. volume:** unknown\n- **Sensitivity:** None\n- **Sources:** CONVENTION\n\n| Field | Column | Type | Req | Key | Description | Sources |\n|---|---|---|---|---|---|---|\n| id | ID | Integer | Y | PK | Surrogate key | CONVENTION |\n| lookupType | LOOKUP_TYPE | Text | Y | | Code list | CONVENTION |\n| code | CODE | Text | Y | | Code | CONVENTION |\n\n`;
  md += '## Relationships\n\n| ID | From (many/child side) | To (one/parent side) | Cardinality | FK field | Description | Sources |\n|---|---|---|---|---|---|---|\n';
  rels.forEach(([c, p], i) => (md += `| R-${i + 1} | E-${c + 1} Entity ${c + 1} | E-${p + 1} Entity ${p + 1} | many-to-one | ref${p + 1}Id | Child has parent | CONVENTION |\n`));
  if (opts.grouped) {
    lkRels.forEach(([c, t], i) => (md += `| R-${rels.length + i + 1} | E-${c + 1} Entity ${c + 1} | E-${lkId} Lookup | many-to-one | ${t.toLowerCase()}Id | Code list | CONVENTION |\n`));
  }
  md += '\n## Assumptions\n| ID | Assumption | Affects | Why |\n|---|---|---|---|\n\n## Open questions\n| ID | Question for stakeholders | Affects | Raised by |\n|---|---|---|---|\n| Q-1 | Is this synthetic? | E-1 | test |\n';
  return { md, entities: n + (opts.grouped ? 1 : 0), relationships: rels.length + (opts.grouped ? lkRels.length : 0) };
}
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(genLarge(+process.argv[2] || 150, 7, { grouped: process.argv.includes('--grouped') }).md);
