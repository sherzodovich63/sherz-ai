// apps/scripts/doctor.mjs — tells you what this computer can build (nothing is installed or changed).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const run = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
const major = Number(process.versions.node.split('.')[0]);
const plat = process.platform;                                       // win32 | darwin | linux
const rows = [];
const add = (name, ok, hint) => rows.push({ name, ok, hint });

add('Node.js 20+', major >= 20, `found ${process.versions.node} — install the LTS from nodejs.org`);
add('npm', !!run('npm -v'), 'comes with Node.js');
const java = run('java -version 2>&1') || run('javac -version 2>&1');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
const xcode = plat === 'darwin' ? run('xcodebuild -version') : '';

console.log(`SHERZ apps · ${os.type()} ${os.release()} · ${plat}\n`);
console.log('Always needed'); rows.forEach((r) => console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ' — ' + r.hint}`));
const section = (title, items) => { console.log('\n' + title); items.forEach(([n, ok, h]) => console.log(`  ${ok ? '✓' : '✗'} ${n}${ok ? '' : ' — ' + h}`)); };
section('Windows .exe  (build on Windows, or on GitHub Actions)', [['running on Windows', plat === 'win32', 'use the GitHub workflow (.github/workflows/build-apps.yml) from any computer']]);
section('macOS .dmg  (needs a Mac, or GitHub Actions)', [['running on macOS', plat === 'darwin', 'use the GitHub workflow — no Mac needed']]);
section('Android .apk', [['Java 17+', !!java, 'install JDK 17 (adoptium.net)'], ['Android SDK (ANDROID_HOME)', !!sdk && fs.existsSync(sdk), 'install Android Studio, then set ANDROID_HOME']]);
section('iOS .ipa', [['running on macOS', plat === 'darwin', 'iOS apps can only be built on a Mac (or GitHub Actions macOS runner)'], ['Xcode', !!xcode, 'install Xcode from the App Store']]);
console.log('  i  a real iPhone / TestFlight also needs an Apple Developer account (99 USD / year)');
process.exit(rows.every((r) => r.ok) ? 0 : 1);
