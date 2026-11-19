import {spawnSync} from 'node:child_process';
const checks=[
 ['Provider matching, fallback, caching and adapters','npx',['-y','deno','test','--allow-env','--node-modules-dir=none','scripts/provider-integrations-test.ts']],
 ['Kora verified wallet SQL','node',['scripts/catalog/korapay-wallet-pglite-test.mjs']],
 ['Rental dispatch and refunds SQL','node',['scripts/sms-rental-routing-pglite-test.mjs']],
 ['SMM dispatch concurrency','node',['scripts/smm-create-order-race-test.mjs']],
 ['SMS purchase authorization','node',['scripts/customer-sms-purchase-boundary-test.mjs']],
 ['SMS allocation evidence','node',['scripts/sms-allocation-evidence-handler-test.mjs']],
 ['SMS status throttle and budget','node',['scripts/sms-status-refresh-throttle-test.mjs']],
 ['SMS atomic cancellation','node',['scripts/sms-atomic-cancellation-handler-test.mjs']],
 ['SMS sweeper','node',['scripts/sms-sweeper-handler-test.mjs']],
 ['Partner SMS/SMM adapters','node',['--experimental-transform-types','scripts/partner-sms-social-adapter-test.mjs']],
 ['Fragment current API transport','node',['scripts/istar-provider-runtime-test.mjs']],
];
let failed=false;
for(const [name,command,args]of checks){const win=process.platform==='win32'&&command==='npx';const r=spawnSync(win?'cmd.exe':command,win?['/d','/c','npx',...args]:args,{encoding:'utf8',timeout:120000});console.log(`${r.status===0?'PASS':'FAIL'} ${name}`);if(r.status!==0){failed=true;console.error((r.stdout+r.stderr).slice(-3500))}}
if(failed)process.exitCode=1;
