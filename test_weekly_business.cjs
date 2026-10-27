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
const differenceBox={hidden:false,textContent:''};inputs.weeklyDifferences=differenceBox;
weekly.differences={start:'2026-10-19',end:'2026-10-25',department_confirmed_unassigned:{records:1,raw_sales:1212,raw_net_profit:47.46,formal_week_inclusion:false},
 reference:{measurement_start:'2026-10-01',measurement_end:'2026-10-25',records:48,classification:{department_confirmed_mapping_missing:{records:6,raw_net_profit:-2.42},other_manager_mapping:{records:34,raw_net_profit:-10.08},department_unverified:{records:8,raw_net_profit:-4.7}}}};
inputs.period.value='week_2026-10-19_2026-10-25_CNY';evaluate('renderWeeklyDifferences()');
assert.equal(differenceBox.hidden,false);assert(differenceBox.textContent.includes('1,212.00'));assert(differenceBox.textContent.includes('47.46'));
assert(differenceBox.textContent.includes('月累计金额不能替代周金额'));assert.equal(evaluate("totals(D.groups,$('period').value).orderProductSales==null"),true);
weekly.issues=[{start:'2026-10-19',reason:'full_week_captured_department_attribution_pending:378'}];
weekly.differences.recovery={full_source_rows:7755,no_asin_rows_retained:103,no_asin_types:{virtual_msku:97,other_or_account_adjustment:6},department_unverified_excluded:{records:378},reason_counts:{cross_department_joint:32}};
inputs.periodCoverage={textContent:''};evaluate('renderWeeklyDifferences();periodCoverage(D.groups)');
assert(differenceBox.textContent.includes('7,755'));assert(differenceBox.textContent.includes('跨部门共管32'));
assert(inputs.periodCoverage.textContent.includes('归属校验未通过'));assert.equal(evaluate("totals(D.groups,$('period').value).orderProductSales==null"),true);
weekly.differences.recovery.ownership_review={joint_source_records:32,joint_msku_reconciled:25,joint_outcome_counts:{personal_resolved:22},joint_contributions:{personal:{amounts:{orderProductSales:26378.23,salesNetProfit:4371.97}},department_unconfirmed:{amounts:{orderProductSales:1190.91,salesNetProfit:-347.55}}},rounding_amounts:{salesNetProfit:-.09}};
weekly.differences.recovery.monetary_validation={source_amount_partition_passed:true,financially_nonzero_unconfirmed_records:222,unconfirmed:{raw_sales:98287.85,raw_net_profit:23131.82}};
evaluate('renderWeeklyDifferences()');
assert(differenceBox.textContent.includes('25条已完成'));assert(differenceBox.textContent.includes('26,378.23'));assert(differenceBox.textContent.includes('暂不发布'));assert(differenceBox.textContent.includes('不能当作四组业绩'));
inputs.weeklyObservation={hidden:true,innerHTML:''};
weekly.observation_snapshot={start:'2026-10-19',end:'2026-10-25',status:'partially_verified',formal:false,complete:false,amount_reconciliation_passed:true,department_coverage_complete:false,
 generated_at:'2026-10-27T14:00:00+08:00',confirmed:{status:'partially_verified',complete:false,orderProductSales:863924.07,salesNetProfit:101289.72,adjusted_sales_cny:777531.663,adjusted_net_profit_cny:86096.262,adjusted_net_margin:86096.262/777531.663},
 department_confirmed_unassigned:{records:22,metrics:{orderProductSales:5077.83,salesNetProfit:898.17}},
 pending:{records:344,financially_nonzero_records:224,raw_sales:98466.78,raw_net_profit:23239.58},
 reconciliation_difference:{raw_net_profit_delta:-.09,compatible_with_two_decimal_rounding:true,components:[]},reference_week:p};
evaluate('renderWeeklyObservation();periodCoverage(D.groups)');
assert.equal(inputs.weeklyObservation.hidden,false);assert(inputs.weeklyObservation.innerHTML.includes('777,531.66'));assert(inputs.weeklyObservation.innerHTML.includes('86,096.26'));
assert(inputs.weeklyObservation.innerHTML.includes('非正式完整业绩'));assert(inputs.weeklyObservation.innerHTML.includes('不能全部加回四组'));assert(inputs.weeklyObservation.innerHTML.includes('尚未获ERP确认'));
assert(inputs.weeklyObservation.innerHTML.includes('2026-10-12 — 2026-10-18'));assert(inputs.periodCoverage.textContent.includes('部门覆盖校验未通过'));
assert.equal(evaluate("completeMetrics(W.observation_snapshot.confirmed,W.observation_snapshot)"),false);
assert.equal(evaluate("totals(D.groups,$('period').value).orderProductSales==null"),true);
assert.equal(evaluate("D.groups.every(g=>!g.periods.some(p=>p.end==='2026-10-25'))"),true);
inputs.manager.value=summary.groups[0].manager;evaluate('renderWeeklyObservation()');assert.equal(inputs.weeklyObservation.hidden,true);
inputs.manager.value='all';inputs.site.value='US';evaluate('renderWeeklyObservation()');assert.equal(inputs.weeklyObservation.hidden,true);inputs.site.value='all';
inputs.period.value='month_2026-10-01_2026-10-26_CNY';evaluate('renderWeeklyObservation()');assert.equal(inputs.weeklyObservation.hidden,true);
assert.equal(evaluate("totals(D.groups,$('period').value).orderProductSales"),summary.groups.length*90);
inputs.period.value='week_2026-10-19_2026-10-25_CNY';
evaluate("tab='price';renderWeeklyDifferences()");assert.equal(differenceBox.hidden,true);
evaluate('renderWeeklyObservation()');assert.equal(inputs.weeklyObservation.hidden,true);
console.log('Shared weeks: incomplete latest hidden, previous retained, independent pricing, daily MTD once-only amounts and missing country/volume fields passed.');
