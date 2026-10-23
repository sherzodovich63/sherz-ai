// apps/mobile/scripts/patch-native.mjs — adds what SHERZ needs to the native projects `cap add` generates (permissions, sherz:// link, microphone text).
// Idempotent: running it again changes nothing. Pure functions are exported for the tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIC_TEXT = 'SHERZ uses the microphone so you can talk to it.';
const PERMS = ['android.permission.INTERNET', 'android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.POST_NOTIFICATIONS', 'android.permission.ACCESS_NETWORK_STATE'];
const INTENT = `            <intent-filter>\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n                <data android:scheme="sherz" android:host="auth" />\n            </intent-filter>\n`;

export function patchAndroidManifest(xml) {
  let out = String(xml);
  for (const p of PERMS) if (!out.includes(`android:name="${p}"`)) out = out.replace(/<\/manifest>/, `    <uses-permission android:name="${p}" />\n</manifest>`);
  if (!out.includes('android:scheme="sherz"')) {
    // the intent filter belongs inside the MainActivity <activity> element
    out = out.replace(/(<activity[\s\S]*?android:name="[^"]*MainActivity"[\s\S]*?>)/, `$1\n${INTENT}`);
  }
  if (!/android:launchMode="singleTask"/.test(out)) out = out.replace(/(<activity[^>]*android:name="[^"]*MainActivity")/, '$1\n            android:launchMode="singleTask"');
  return out;
}

export function patchInfoPlist(plist) {
  let out = String(plist);
  if (!out.includes('NSMicrophoneUsageDescription')) out = out.replace(/<\/dict>\s*<\/plist>/, `\t<key>NSMicrophoneUsageDescription</key>\n\t<string>${MIC_TEXT}</string>\n</dict>\n</plist>`);
  if (!out.includes('<string>sherz</string>')) {
    out = out.replace(/<\/dict>\s*<\/plist>/, `\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>ai.sherz.app</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>sherz</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n</dict>\n</plist>`);
  }
  return out;
}

function patchFile(file, fn) {
  if (!fs.existsSync(file)) return false;
  const a = fs.readFileSync(file, 'utf8'), b = fn(a);
  if (a !== b) fs.writeFileSync(file, b);
  return true;
}

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
export function patchAll(root = ROOT) {
  const android = patchFile(path.join(root, 'android/app/src/main/AndroidManifest.xml'), patchAndroidManifest);
  const ios = patchFile(path.join(root, 'ios/App/App/Info.plist'), patchInfoPlist);
  return { android, ios };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = patchAll(); console.log(`[patch-native] android: ${r.android ? 'patched' : 'not created yet'} · ios: ${r.ios ? 'patched' : 'not created yet'}`);
}
