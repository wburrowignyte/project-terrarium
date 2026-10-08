// Generates a synthetic large ERD.md (contract format) for load/layout testing. Usage: node gen-large.mjs [n=150] > out.md
export function genLarge(n = 150, seed = 7) {
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const kinds = ['Core', 'Core', 'Core', 'Reference', 'Junction', 'History/Audit'];
  const ents = Array.from({ length: n }, (_, i) => {
    const kind = i < 12 ? 'Reference' : kinds[Math.floor(rnd() * kinds.length)];
    return { id: i + 1, kind, table: `SYN_${kind === 'Reference' ? 'REF' : 'ENT'}_${String(i + 1).padStart(3, '0')}`, sens: rnd() < 0.15 ? 'PII' : 'None' };
  });
  const rels = [];
  ents.forEach((e, i) => {
    e.fk = [];
    if (i < 12) return;
    const k = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < k; j++) { const p = rnd() < 0.3 ? Math.floor(rnd() * 12) : Math.floor(rnd() * i); if (p !== i && !e.fk.includes(p)) { e.fk.push(p); rels.push([i, p]); } }
  });
  let md = `# Synthetic ERD (${n})\n\n| | |\n|---|---|\n| Version | 1 |\n| Last updated | 2026-10-08 |\n| Application prefix | SYN |\n| Target database | Oracle |\n| Status | Draft |\n\n## Summary\nGenerated.\n\n## Diagram\n\n\`\`\`mermaid\nerDiagram\n`;
  for (const [c, p] of rels) md += `    ${ents[p].table} ||--o{ ${ents[c].table} : "has"\n`;
  md += '```\n\n## Entities\n\n';
  for (const e of ents) {
    md += `### E-${e.id} Entity ${e.id} (\`${e.table}\`)\n- **Purpose:** Synthetic entity ${e.id}.\n- **Kind:** ${e.kind}\n- **Est. volume:** unknown\n- **Sensitivity:** ${e.sens}\n- **Sources:** CONVENTION\n\n| Field | Column | Type | Req | Key | Description | Sources |\n|---|---|---|---|---|---|---|\n| id | ID | Integer | Y | PK | Surrogate key | CONVENTION |\n`;
    for (const p of e.fk) md += `| ref${p + 1}Id | REF${p + 1}_ID | Integer | ${rnd() < 0.5 ? 'Y' : 'N'} | FK→E-${p + 1} | Parent | CONVENTION |\n`;
    const extra = 2 + Math.floor(rnd() * 10);
    for (let f = 0; f < extra; f++) md += `| attr${f} | ATTR_${f} | ${['Text', 'Date', 'Decimal', 'Boolean'][f % 4]} | N | | Attribute ${f} | CONVENTION |\n`;
    md += '\n';
  }
  md += '## Relationships\n\n| ID | From (many/child side) | To (one/parent side) | Cardinality | FK field | Description | Sources |\n|---|---|---|---|---|---|---|\n';
  rels.forEach(([c, p], i) => (md += `| R-${i + 1} | E-${c + 1} Entity ${c + 1} | E-${p + 1} Entity ${p + 1} | many-to-one | ref${p + 1}Id | Child has parent | CONVENTION |\n`));
  md += '\n## Assumptions\n| ID | Assumption | Affects | Why |\n|---|---|---|---|\n\n## Open questions\n| ID | Question for stakeholders | Affects | Raised by |\n|---|---|---|---|\n| Q-1 | Is this synthetic? | E-1 | test |\n';
  return { md, entities: n, relationships: rels.length };
}
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(genLarge(+process.argv[2] || 150).md);
