import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { inspectMigrationFiles } from './lib/local-migration-inventory.mjs';

// No database client, env loading, remote reference or SQL execution.
const directory = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const report = inspectMigrationFiles(readdirSync(directory).filter(name => name.endsWith('.sql'))
  .map(name => ({ name, sql: readFileSync(join(directory, name), 'utf8') })));
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Migration files: ${report.files}`);
  for (const group of report.duplicateVersions) {
    console.log(`DUPLICATE ${group.version}: ${group.names.join(', ')}`);
  }
  console.log(`Files with review signals: ${report.entries.filter(entry => entry.risks.length).length}`);
  console.log('All files require review before local execution; a clean scan is not approval.');
  console.log('Do not rename applied versions or replay the production migration directory blindly.');
}
if (report.duplicateVersions.length || report.entries.some(entry => !entry.version)) process.exitCode = 1;
