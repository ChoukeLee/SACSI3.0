import { readFile,writeFile } from 'node:fs/promises';
import * as prettier from 'prettier';

// A reviewed, explicit adoption scope. Legacy files are added when refactored;
// this avoids burying meaningful business changes under a repository-wide reflow.
const files = [
  'scripts/backup-disaster-recovery.mjs',
  'scripts/check-dr-archive.mjs',
  'scripts/check-dr-services.mjs',
  'scripts/enable-dr-email-login.mjs',
  'scripts/finalize-dr-drill.mjs',
  'scripts/inspect-dr-status.mjs',
  'scripts/restore-disaster-recovery.mjs',
  'scripts/upgrade-dr-storage.mjs',
  'scripts/verify-disaster-recovery.mjs',
  'scripts/lib/dr-archive.mjs',
  'scripts/lib/dr-local-runtime.mjs',
  'eslint.config.mjs',
  'src/features/business-actions/booking-operation-contract.ts',
  'src/features/business-actions/operator-booking-operation-http.ts',
  'src/features/business-actions/operator-booking-operation-panel.tsx',
  'src/features/daily-rentals/calendar-model.ts',
  'src/features/daily-rentals/calendar-finance-panel.tsx',
  'src/features/daily-rentals/calendar-view-parts.tsx',
  'src/features/daily-rentals/customer-summary.ts',
  'src/features/daily-rentals/booking-presentation.ts',
  'src/features/leases/actions.ts',
  'src/features/leases/lease-action-guards.ts',
  'src/features/leases/lease-contract-actions.ts',
  'src/features/leases/lease-payment-actions.ts',
  'src/features/leases/lease-moveout-actions.ts',
  'src/features/leases/lease-lifecycle-service.ts',
  'src/features/leases/lease-request-identity.ts',
  'tests/lease-lifecycle.native.ts',
  'tests/lease-lifecycle-actions.test.ts',
  'tests/lease-request-identity.test.ts',
  'tests/helpers/native-advisors.ts',
  'scripts/lib/application-rebuild.mjs',
  'tests/helpers/application-rebuild.ts',
  'tests/application-rebuild.native.ts',
  'tests/engineering-contract.test.ts',
  'tests/engineering-boundaries.test.ts',
  'tests/application-rebuild-plan.test.ts',
  'tests/calendar-finance-panel.test.tsx',
];
let invalid=0;
for(const filepath of files){
  const source=await readFile(filepath,'utf8');
  const options={...await prettier.resolveConfig(filepath),filepath};
  if(process.argv.includes('--write')) await writeFile(filepath,await prettier.format(source,options));
  else if(!await prettier.check(source,options)){ console.error(`Format required: ${filepath}`);invalid++; }
}
if(invalid)process.exitCode=1;
else console.log(`Formatting verified: ${files.length} governed files.`);
