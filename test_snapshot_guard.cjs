const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const storage=new Map();
function load(){const context={window:{},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}};vm.createContext(context);vm.runInContext(fs.readFileSync('snapshot-guard.js','utf8'),context);return context.window.SNAPSHOT_GUARD;}
const target=cutoff=>({schema_version:1,departments:{'2026-10':{actual:{start:'2026-10-01',basis:'adjusted_once_from_raw_erp',cutoff,refreshed_at:'2026-10-26T11:00:00+08:00'}}},personal:{}});
const execution=stamp=>({schema:'execution-sync-v1',groups:{},data_asof:stamp,last_success_at:stamp});
let guard=load();guard.restore('targets',target('2026-10-22'));guard.accept('targets',target('2026-10-25'));
guard.restore('execution',execution('2026-10-26T10:00:00+08:00'));guard.accept('execution',execution('2026-10-26T11:00:00+08:00'));
assert.throws(()=>guard.accept('targets',target('2026-10-22')));
guard=load();assert.equal(guard.restore('targets',target('2026-10-22')).departments['2026-10'].actual.cutoff,'2026-10-25');
assert.equal(guard.restore('execution',execution('2026-10-26T10:00:00+08:00')).data_asof,'2026-10-26T11:00:00+08:00');
assert.throws(()=>guard.accept('execution',execution('2026-10-26T09:00:00+08:00')));
guard.accept('execution',execution('2026-10-26T12:00:00+08:00'));
assert.equal(guard.accept('targets',target('2026-10-25')).departments['2026-10'].actual.cutoff,'2026-10-25');
console.log('Browser freshness: forward/reverse module updates, stale response rejection and reload cache retention passed.');
