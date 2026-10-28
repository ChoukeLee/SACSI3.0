// Build a separate Mac candidate. Never overwrite a live connector or its state.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { VERSION, validateConfig } from '../operator-connector/core.mjs';

if (process.platform !== 'darwin') throw new Error('macos_required');
const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg) throw new Error('usage: node scripts/stage-mac-checkout-correction.mjs EXISTING_MAC_SOURCE NEW_CANDIDATE_DIRECTORY');
const source = realpathSync(sourceArg), target = resolve(targetArg);
if (existsSync(target)) throw new Error('existing_directory_preserved');
const { verifyPackage } = await import(pathToFileURL(join(source, 'verify-package.mjs')).href);
const config = validateConfig(JSON.parse(readFileSync(join(source, 'config.json'), 'utf8')));
if (config.localTest) throw new Error('review_production_configuration_first');
const upstream = fileURLToPath(new URL('../operator-connector/', import.meta.url));
mkdirSync(target, { recursive: true, mode: 0o700 });
// Keep the reviewed Keychain/session/pending adapters and publishable configuration.
// Sessions and encrypted pending records live outside this source and are never copied.
for (const entry of readdirSync(source, { withFileTypes: true })) {
  if (entry.isFile() && /\.(mjs|md|cmd|cs)$/.test(entry.name)) cpSync(join(source, entry.name), join(target, entry.name));
}
for (const name of ['core.mjs', 'mcp-tools.mjs', 'human-output.mjs']) {
  const content = readFileSync(join(upstream, name), 'utf8').replaceAll('login.cmd', 'login.command');
  writeFileSync(join(target, name), content, { mode: 0o600 });
}
writeFileSync(join(target, 'config.json'), JSON.stringify(config, null, 2)+'\n', { mode: 0o600 });
cpSync(process.execPath, join(target, 'node')); chmodSync(join(target, 'node'), 0o700);
for (const [name, command] of Object.entries({login:'login',check:'capabilities',logout:'logout',pending:'pending',capture:'capture','recover-lock':'recover-lock'})) {
  writeFileSync(join(target, `${name}.command`), '#!/bin/zsh\nset -euo pipefail\nSACSI_CONNECTOR_DIR="${0:A:h}"\nexec "$SACSI_CONNECTOR_DIR/node" "$SACSI_CONNECTOR_DIR/cli.mjs" '+command+' --human\n', { mode: 0o700 });
}
writeFileSync(join(target, 'CHECKOUT_CORRECTION.md'), 'Local development candidate: correct_checkout. Requires the reviewed database migration and matching app deployment. This build does not activate itself or execute business records. Wire compatibility remains 0.8.0; feature availability is discovered per operation.\n');
const checksums = Object.fromEntries(readdirSync(target).sort().map(name => [name, createHash('sha256').update(readFileSync(join(target, name))).digest('hex')]));
writeFileSync(join(target, 'manifest.json'), JSON.stringify({version:VERSION, platform:'darwin', adapterVersion:'1.1.0-checkout-correction',
  baseSourceCommit:'8e7f840eaa9e680a46e0153cc6a825865a3f852a', purpose:'Local development candidate; not activated or published', nodeVersion:process.version, checksums}, null, 2)+'\n', {mode:0o600});
console.log(JSON.stringify({directory:target, ...verifyPackage(target)}));
