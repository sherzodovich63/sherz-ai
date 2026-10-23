import test from 'node:test';
import assert from 'node:assert/strict';
import { patchAndroidManifest, patchInfoPlist } from './patch-native.mjs';

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="SHERZ">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTask">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>`;
test('android manifest: permissions + sherz://auth link added once, inside MainActivity', () => {
  const a = patchAndroidManifest(MANIFEST), b = patchAndroidManifest(a);
  assert.equal(a, b, 'idempotent');
  for (const p of ['RECORD_AUDIO', 'POST_NOTIFICATIONS', 'MODIFY_AUDIO_SETTINGS']) assert.match(a, new RegExp(`android.permission.${p}`));
  assert.equal((a.match(/android.permission.INTERNET/g) || []).length, 1, 'existing permission not doubled');
  assert.match(a, /android:scheme="sherz" android:host="auth"/);
  assert.ok(a.indexOf('android:scheme="sherz"') < a.indexOf('</activity>') && a.indexOf('android:scheme="sherz"') > a.indexOf('<activity'));
});
test('Info.plist: microphone text and sherz URL scheme added once', () => {
  const plist = '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleName</key>\n\t<string>App</string>\n</dict>\n</plist>\n';
  const a = patchInfoPlist(plist), b = patchInfoPlist(a);
  assert.equal(a, b); assert.match(a, /NSMicrophoneUsageDescription/); assert.match(a, /<string>sherz<\/string>/); assert.match(a, /<\/dict>\s*<\/plist>\s*$/);
});
