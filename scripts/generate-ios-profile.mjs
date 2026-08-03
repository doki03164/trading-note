import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'ios/distribution/Trading-Journal.mobileconfig');
const webOutputPath = resolve(root, 'public/Trading-Journal.mobileconfig');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const icon = (await readFile(resolve(root, 'src-tauri/icons/icon.png'))).toString('base64');
const wrappedIcon = icon.match(/.{1,68}/g)?.join('\n          ') ?? icon;

const profile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key>
      <true/>
      <key>Icon</key>
      <data>
          ${wrappedIcon}
      </data>
      <key>IsRemovable</key>
      <true/>
      <key>Label</key>
      <string>Trading Journal</string>
      <key>PayloadDescription</key>
      <string>在主畫面加入 Trading Journal 安裝及版本入口。</string>
      <key>PayloadDisplayName</key>
      <string>Trading Journal</string>
      <key>PayloadIdentifier</key>
      <string>com.pulsegrid.app.webclip</string>
      <key>PayloadOrganization</key>
      <string>Trading Journal</string>
      <key>PayloadType</key>
      <string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key>
      <string>0CF47E9A-7FB4-4B11-8F6C-3B04AB18B317</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>Precomposed</key>
      <true/>
      <key>URL</key>
      <string>https://doki03164.github.io/trading-note/</string>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Trading Journal v${packageJson.version} 描述檔捷徑版；提供最新版本及 iOS 安裝入口。</string>
  <key>PayloadDisplayName</key>
  <string>Trading Journal</string>
  <key>PayloadIdentifier</key>
  <string>com.pulsegrid.app.profile</string>
  <key>PayloadOrganization</key>
  <string>Trading Journal</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>C43BC926-46F0-48EE-B809-A5F8F86B33FA</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, profile, 'utf8');
await writeFile(webOutputPath, profile, 'utf8');
console.log(`Generated ${outputPath} and ${webOutputPath}`);
