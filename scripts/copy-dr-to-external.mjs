// One reviewed delivery: existing verified snapshot -> user's USB disk D:.
// Never copies .env, recovery keys, plaintext records, or unrelated disk files.
import assert from 'node:assert/strict';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { digest, unseal } from './lib/dr-archive.mjs';

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'outputs/disaster-recovery/backup-PNLJiW');
const destination = 'D:/SACSI-Backups/2026-09-23_191732Z_backup-PNLJiW';
const files = [
  'acceptance.json', 'ca.crt', 'database-verification.json', 'database.dump.aes',
  'edge-functions.json.aes', 'edge-verification.json', 'manifest.json.aes',
  'restore-loaded.json', 'restore-replay-1790191845899.json', 'restore-started.json',
  'restored-schema.sql.aes', 'schema-review.sql.aes', 'service-verification.json', 'summary.json',
];
try {
  assert.equal(process.platform, 'win32');
  assert.equal(realpathSync(source).toLowerCase(), source.toLowerCase());
  const acceptance = JSON.parse(readFileSync(join(source, 'acceptance.json')));
  assert.equal(acceptance.status, 'local-restore-drill-passed');
  const key = readFileSync(join(root, 'work/disaster-recovery-keys/backup-PNLJiW.key'));
  assert.equal(key.length, 32);
  assert.equal(existsSync(destination), false, 'Destination already exists; no overwrite permitted');
  const parent = 'D:/SACSI-Backups';
  if (!existsSync(parent)) mkdirSync(parent);
  assert.equal(realpathSync(parent).toLowerCase(), resolve(parent).toLowerCase());
  mkdirSync(destination);
  const checks = [];
  for (const name of files) {
    const input = readFileSync(join(source, name));
    // Validate protected payload before copying. Never write the plaintext to disk.
    if (name.endsWith('.aes')) unseal(input, key);
    copyFileSync(join(source, name), join(destination, name), constants.COPYFILE_EXCL);
    const output = readFileSync(join(destination, name));
    assert.equal(digest(output), digest(input));
    if (name.endsWith('.aes')) unseal(output, key);
    checks.push({ name, bytes: output.length, sha256: digest(output), encrypted: name.endsWith('.aes') });
  }
  const manifest = JSON.parse(unseal(readFileSync(join(destination, 'manifest.json.aes')), key));
  assert.equal(digest(unseal(readFileSync(join(destination, 'database.dump.aes')), key)), manifest.dumpSha256);
  const report = { status: 'copied-and-verified', verifiedAt: new Date().toISOString(),
    snapshotAt: acceptance.snapshotAt, source, destination, files: checks,
    ciphertextAndDecryptionVerified: true, recoveryKeyCopied: false,
    independentKeyCustody: 'pending', physicalOffsiteStorage: 'user-action-required',
    automaticBackups: 'not-configured', notes: 'Historical reports describe the original drill; this report records USB delivery.' };
  writeFileSync(join(destination, 'USB-DELIVERY.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  writeFileSync(join(destination, '先读我.txt'), '\uFEFF' + [
    'SACSI 加密备份 — USB 副本',
    '数据库恢复点：2026-09-23 19:17:32 UTC（阿比让时间）。不是每日自动更新。',
    '14 个源文件已逐个 SHA-256 比对，5 个加密文件已从本硬盘读取并通过解密验证。',
    '线上业务数据未修改，移动硬盘原有文件未删除或覆盖。',
    '',
    '重要：本硬盘不含解密密钥。密钥目前仅保存在原电脑：',
    'C:\\Users\\Chouke\\Desktop\\SACSI3.0\\work\\disaster-recovery-keys\\backup-PNLJiW.key',
    '必须另行保存密钥到独立可靠位置，否则原电脑丢失后可能无法恢复。不要把明文密钥放入本备份目录。',
    '加密格式 SACSI-DR-1 / AES-256-GCM；恢复需密钥及配套恢复工具。不要直接对生产库导入。',
    '恢复说明见随附 DISASTER_RECOVERY.md；版本和本地恢复结果见 acceptance.json。',
    '历史报告中的 offsiteCopy=not-configured 是当时状态；本次硬盘复制状态见 USB-DELIVERY.json。',
    '仅把副本复制到另一块盘不等于异地存放。完成后安全弹出，拔下并与电脑分开保管。',
  ].join('\r\n'), { flag: 'wx' });
  copyFileSync(join(root, 'docs/DISASTER_RECOVERY.md'), join(destination, 'DISASTER_RECOVERY.md'), constants.COPYFILE_EXCL);
  // Save the minimal decryptor alongside encrypted data; it contains no keys.
  copyFileSync(join(root, 'scripts/lib/dr-archive.mjs'), join(destination, 'dr-archive.mjs'), constants.COPYFILE_EXCL);
  console.log(JSON.stringify({ destination, filesVerified: checks.length,
    encryptedFilesVerified: checks.filter(f => f.encrypted).length,
    bytes: checks.reduce((n,f) => n+f.bytes, 0), snapshotAt: acceptance.snapshotAt,
    recoveryKeyCopied: false, independentKeyCustody: 'pending' }));
} catch (e) {
  console.error(JSON.stringify({ failed: true, code: typeof e.code === 'string' ? e.code : 'SAFE_FAILURE' }));
  process.exitCode = 1;
}
