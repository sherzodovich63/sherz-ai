// node apply_schema_solutions.mjs [path/to/schema.prisma]
// Appends the two shared-learning models (SharedSolution, SolutionConfirmation) to prisma/schema.prisma. Safe to run twice.
// Then run:  npx prisma db push   and   npx prisma generate   and restart the server.
import fs from 'node:fs';
const file = process.argv[2] || 'prisma/schema.prisma';
const src = fs.readFileSync(new URL('./prisma/SharedSolutions.prisma.txt', import.meta.url), 'utf8');
const models = src.slice(src.indexOf('model SharedSolution {')).trim();
if (!models.startsWith('model SharedSolution {')) { console.error('prisma/SharedSolutions.prisma.txt not found or damaged'); process.exit(1); }
let schema = fs.readFileSync(file, 'utf8');
if (/^model\s+SharedSolution\s*\{/m.test(schema)) { console.log('already in ' + file + ' — nothing to do'); process.exit(0); }
fs.writeFileSync(file + '.bak', schema);                       // backup next to it
fs.writeFileSync(file, schema.replace(/\s*$/, '\n\n') + '// ── Shared learning (opt-in) ──\n' + models + '\n');
console.log('added SharedSolution and SolutionConfirmation to ' + file + ' (backup: ' + file + '.bak)');
