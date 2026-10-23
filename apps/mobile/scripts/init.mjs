// apps/mobile/scripts/init.mjs — creates the android/ and ios/ projects once (needs no Android Studio / Xcode just to generate them), patches them, copies the web app in.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchAll } from './patch-native.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (c) => execSync(c, { cwd: ROOT, stdio: 'inherit' });
if (!fs.existsSync(path.resolve(ROOT, '../www/index.html'))) { console.error('Run `npm run sync` in the apps folder first (it creates apps/www).'); process.exit(1); }
for (const p of ['android', 'ios']) {
  if (p === 'ios' && process.platform !== 'darwin' && !process.env.CI_FORCE_IOS) { console.log('[init] iOS project is created on a Mac only — skipped here.'); continue; }
  if (!fs.existsSync(path.join(ROOT, p))) run(`npx cap add ${p}`); else console.log(`[init] ${p}/ already exists`);
}
console.log(patchAll());
run('npx cap sync');
try {
  const flags = ['android', 'ios'].filter((p) => fs.existsSync(path.join(ROOT, p))).map((p) => `--${p}`).join(' ');
  run(`npx capacitor-assets generate ${flags} --iconBackgroundColor "#2f3cc8" --splashBackgroundColor "#070709"`);       // icons + splash from assets/
} catch { console.warn('[init] icon generation skipped (run `npm run assets` later)'); }
console.log('\nDone. Next: `npm run android:open` (apps folder) to open Android Studio, or `npm run ios:open` on a Mac.');
