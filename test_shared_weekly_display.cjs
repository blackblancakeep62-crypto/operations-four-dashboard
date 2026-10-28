'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(__dirname+'/app.js','utf8'),summary=JSON.parse(fs.readFileSync(__dirname+'/summary.json','utf8'));
function metric(s,start,end){return {source_start:start,source_end:end,orderProductSales:s,salesNetProfit:s*.1,discountCostSales:s*.9,unitsOrdered:s/10,orders:s/10,adsSpend:s*.05,adjusted_sales_cny:s*.9,adjusted_net_profit_cny:s*.1*.85,adjusted_net_margin:.1*.85/.9,status:'partially_verified'};}
function week(s,owner,start='2026-10-19',end='2026-10-25',complete=false){return {id:`week_${start}_${end}_CNY`,start,end,kind:'week',formal:false,complete,coverage_complete:complete,owner_scope:owner,source_kind:'shared_full_week',source_sha256:'same-source',comparison_basis:'shared-preselection-all-products-CNY-v1',metrics:metric(s,start,end),sites:{'A:US':metric(s*.6,start,end),'A:UK':metric(s*.4,start,end)}};}
const old=(s,owner)=>week(s,owner,'2026-10-12','2026-10-18',true),names=summary.groups.map(g=>g.manager);
const display={schema:'shared-weekly-display-v1',generated_at:'2026-10-28T10:00:00+08:00',periods:[old(800,'department'),week(1020,'department')],groups:Object.fromEntries(names.map((n,i)=>[n,{periods:[old((i+1)*80,n),week((i+1)*100,n)],weekly_cutoff:'2026-10-25',issues:[]}]))};
const formal={...old(800,'department'),complete:true};formal.metrics.status='verified';
const weekly={schema:'weekly-business-v1',generated_at:'2026-10-28T10:00:00+08:00',weekly_cutoff:'2026-10-18',department_periods:[formal],groups:Object.fromEntries(names.map(n=>[n,{periods:[formal],weekly_cutoff:'2026-10-18',weekly_complete:1,latest_complete:false}])),weekly_display:display,issues:[]};
const targets={personal:{'2026-10':Object.fromEntries(names.map(n=>[n,{actual:{start:'2026-10-01',cutoff:'2026-10-27',basis:'adjusted_once_from_raw_erp',raw_sales:100,raw_net_profit:10,sales:90,net_profit:8.5,net_margin:8.5/90,raw_signed_ads:-5,ad_burden:.05}}]))}};
const protectedSource=JSON.stringify(summary),protectedTargets=JSON.stringify(targets);
const inputs={manager:{value:'all'},site:{value:'all'},period:{value:'week_2026-10-19_2026-10-25_CNY'},chart:{innerHTML:''},trendDate:{textContent:''},trendDescription:{textContent:''}};
const ctx={window:{OPERATIONS_DATA:summary,WEEKLY_BUSINESS_DATA:weekly,OPERATIONS_TARGETS:targets,SNAPSHOT_GUARD:{restore:(_,s)=>s}},document:{getElementById:id=>inputs[id]},structuredClone,Intl,Date};
vm.createContext(ctx);vm.runInContext(app.slice(0,app.indexOf('options();for(const id')),ctx);const run=s=>vm.runInContext(s,ctx),id=inputs.period.value;
assert.equal(run('totals(D.groups,$("period").value).orderProductSales'),918);
assert.equal(run('confirmedCardMetrics().orderProductSales'),918);
for(let i=0;i<names.length;i++){
 assert.equal(run(`period(D.groups[${i}],$('period').value).orderProductSales`),(i+1)*90);
 const card=run(`sharedMemberCard(D.groups[${i}],$('period').value)`);assert(card.includes('2026-10-19 — 2026-10-25'));assert(card.includes('覆盖待核验'));assert(card.includes('广告费率'));
 assert.equal(run(`weeklyComparison(D.groups[${i}].manager,$('period').value).reason`),'前后周期覆盖范围未通过可比校验');
}
inputs.manager.value=names[0];assert.equal(run('totals(groups(),$("period").value).orderProductSales'),90);
inputs.site.value='UK';assert.equal(run('period(D.groups[0],$("period").value).orderProductSales'),36);
assert.equal(run('totals(groups(),$("period").value).orderProductSales'),36);
inputs.site.value='DE';assert.equal(run('period(D.groups[0],$("period").value)'),null);assert.equal(run('totals(groups(),$("period").value).orderProductSales'),undefined);
inputs.manager.value='all';inputs.site.value='all';
const sitesBefore=structuredClone(display.groups[names[0]].periods[1].sites);
display.groups[names[0]].periods[1].sites={'A:US':{...metric(100,'2026-10-19','2026-10-25'),adsSpend:5.,raw_signed_ads:-5.},'B:US':{...metric(100,'2026-10-19','2026-10-25'),adsSpend:15.,raw_signed_ads:15.}};
inputs.site.value='US';assert.equal(run('period(D.groups[0],$("period").value).ad_rate'),.05);
display.groups[names[0]].periods[1].sites=sitesBefore;inputs.site.value='all';
run('chart(D.groups)');assert(inputs.trendDate.textContent.includes('2026-10-25'));assert(inputs.trendDescription.textContent.includes('不可比'));
assert(!/<path d="[^"]*L/.test(inputs.chart.innerHTML));assert(inputs.chart.innerHTML.includes('white'));
display.periods[1].coverage_complete=true;run('chart(D.groups)');assert(/<path d="[^"]*L/.test(inputs.chart.innerHTML));
display.groups[names[0]].periods[1].coverage_complete=true;
assert.equal(run('weeklyComparison(D.groups[0].manager,$("period").value).sales'),.25);
const year=week(40,names[0],'2025-10-20','2025-10-26',true);display.groups[names[0]].periods.unshift(year);
assert.equal(run('weeklyComparison(D.groups[0].manager,$("period").value,52).sales'),1.5);
display.groups[names[0]].periods.pop();display.groups[names[0]].weekly_cutoff='2026-10-18';
assert.equal(run('period(D.groups[0],$("period").value)'),null);
const kept=run('sharedMemberCard(D.groups[0],$("period").value)');assert(kept.includes('保留上一有效数据'));assert(kept.includes('实际数据 2026-10-12 — 2026-10-18'));
assert.equal(run('period(D.groups[1],$("period").value).orderProductSales'),180);
display.groups[names[1]].periods[1].metrics.adsSpend=null;
assert.equal(run('period(D.groups[1],$("period").value).orderProductSales'),180);assert.equal(run('period(D.groups[1],$("period").value).ad_rate'),null);
inputs.period.value='month_2026-10-01_2026-10-27_CNY';assert.equal(run('period(D.groups[0],$("period").value).orderProductSales'),90);
assert.equal(JSON.stringify(summary),protectedSource);assert.equal(JSON.stringify(targets),protectedTargets);
assert.equal(weekly.department_periods.length,1);assert.equal(weekly.groups[names[0]].weekly_cutoff,'2026-10-18');
console.log('Three shared weekly modules: same source and dates, independent member failures, country/manager filters, comparable WoW/YoY, trend breaks, monthly isolation passed.');
