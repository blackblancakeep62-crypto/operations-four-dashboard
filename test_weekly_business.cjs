'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(__dirname+'/app.js','utf8');
const summary=JSON.parse(fs.readFileSync(__dirname+'/summary.json','utf8'));
const row={status:'verified',orderProductSales:100,salesNetProfit:10,discountCostSales:90,unitsOrdered:2,orders:2,adsSpend:5,
 adjusted_sales_cny:90,adjusted_net_profit_cny:8.5,adjusted_net_margin:8.5/90};
const p={id:'week_2026-10-12',kind:'week',start:'2026-10-12',end:'2026-10-18',complete:true,metrics:row,sites:{'A:US':row}};
const weekly={schema:'weekly-business-v1',generated_at:'2026-10-27T11:00:00+08:00',department_periods:[p],
 groups:Object.fromEntries(summary.groups.map(g=>[g.manager,{periods:[p],weekly_cutoff:'2026-10-18',weekly_complete:11,latest_complete:false}]))};
for(const g of summary.groups)Object.assign(g,{pricing_weekly_cutoff:'2026-10-25',pricing_report_verified:true});
const a={start:'2026-10-01',cutoff:'2026-10-26',basis:'adjusted_once_from_raw_erp',raw_sales:100,raw_net_profit:10,
 sales:90,net_profit:8.5,net_margin:8.5/90,raw_signed_ads:-5,ad_burden:.05};
const targets={personal:{'2026-10':Object.fromEntries(summary.groups.map(g=>[g.manager,{actual:a}]))}};
const inputs={manager:{value:'all'},site:{value:'all'},period:{value:'week_2026-10-19_2026-10-25_CNY'}};
const ctx={window:{OPERATIONS_DATA:summary,WEEKLY_BUSINESS_DATA:weekly,OPERATIONS_TARGETS:targets,
 SNAPSHOT_GUARD:{restore:(_,seed)=>seed}},document:{getElementById:id=>inputs[id]},structuredClone,Intl,
 Date:class extends Date{constructor(...a){super(...(a.length?a:['2026-10-27T04:00:00Z']));}}};
vm.createContext(ctx);
vm.runInContext(app.slice(0,app.indexOf('options();for(const id')),ctx);
const evaluate=code=>vm.runInContext(code,ctx);
assert.equal(evaluate("totals(D.groups,$('period').value).orderProductSales==null"),true);
assert.equal(evaluate("D.groups.every(g=>g.weekly_cutoff==='2026-10-18')"),true);
inputs.period.value='week_2026-10-12_2026-10-18_CNY';
const actual=evaluate("totals(D.groups,$('period').value).orderProductSales");
const expected=weekly.department_periods.find(p=>p.start==='2026-10-12').metrics.adjusted_sales_cny;
assert.equal(actual,expected);
const month=Object.keys(targets.personal).find(k=>Object.values(targets.personal[k]).some(p=>p.actual));
const person=Object.values(targets.personal[month]).find(p=>p.actual).actual;
inputs.period.value=`month_${person.start}_${person.cutoff}_CNY`;
assert.equal(evaluate("matchedPeriod(D.groups[0],$('period').value).daily"),true);
assert.equal(evaluate("period(D.groups[0],$('period').value).orderProductSales"),targets.personal[month][summary.groups[0].manager].actual.sales);
assert.equal(evaluate("totals(D.groups,$('period').value).unitsOrdered"),null);
assert.equal(evaluate("totals(D.groups,$('period').value).asp"),null);
inputs.site.value='US';assert.equal(evaluate("period(D.groups[0],$('period').value)"),null);
inputs.site.value='all';
assert.equal(JSON.stringify(ctx.window.OPERATIONS_DATA),JSON.stringify(summary));
assert.equal(JSON.stringify(ctx.window.OPERATIONS_TARGETS),JSON.stringify(targets));
assert.equal(evaluate("cardScope(D.groups[0],'price').weekly_cutoff"),'2026-10-25');
console.log('Shared weeks: incomplete latest hidden, previous retained, independent pricing, daily MTD once-only amounts and missing country/volume fields passed.');
