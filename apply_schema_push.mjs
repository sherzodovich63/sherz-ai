// node apply_schema_push.mjs [path/to/schema.prisma]
// Appends the PushSubscription model to prisma/schema.prisma. Safe to run twice.
// Then run:  npx prisma db push   and   npx prisma generate   and restart the server.
import fs from 'node:fs';
const file = process.argv[2] || 'prisma/schema.prisma';
const src = fs.readFileSync(new URL('./prisma/PushSubscriptions.prisma.txt', import.meta.url), 'utf8');
const model = src.slice(src.indexOf('model PushSubscription {')).trim();
if (!model.startsWith('model PushSubscription {')) { console.error('prisma/PushSubscriptions.prisma.txt not found or damaged'); process.exit(1); }
let schema = fs.readFileSync(file, 'utf8');
if (/^model\s+PushSubscription\s*\{/m.test(schema)) { console.log('already in ' + file + ' — nothing to do'); process.exit(0); }
fs.writeFileSync(file + '.bak', schema);
fs.writeFileSync(file, schema.replace(/\s*$/, '\n\n') + '// ── Web Push subscriptions ──\n' + model + '\n');
console.log('added PushSubscription to ' + file + ' (backup: ' + file + '.bak)');
