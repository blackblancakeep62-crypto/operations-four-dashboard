'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(__dirname+'/app.js','utf8');
const C=vm.runInNewContext(app.slice(app.indexOf('// BEGIN SHARED COUNTRIES'),app.indexOf('// END SHARED COUNTRIES'))+';OperatingCountries');
for(const raw of ['A:US','C:US','US','A','C','a_us'])assert.equal(C.parse(raw).country,'US');
assert.equal(C.parse('D:GB').country,'UK');assert.equal(C.parse('UNKNOWN'),null);
assert.equal(new Set(Object.keys(C.names)).size,Object.keys(C.names).length);
const row=(n)=>({orderProductSales:n,discountCostSales:n,unitsOrdered:2,salesNetProfit:n/10,adsSpend:n/5,adjusted_sales_cny:n*.9,adjusted_net_profit_cny:n*.085});
const first=row(100),second=row(300),financial=C.financial({'A:US':first,'A_US':first,'C:US':second,'US':row(50),'D:DE':row(900)},'US',()=>true);
assert.equal(financial.orderProductSales,450);assert.equal(financial.unitsOrdered,6);
assert.equal(financial.asp,75);assert.equal(financial.ad_rate,.2);
assert(Math.abs(financial.adjusted_net_margin-38.25/405)<1e-12);
assert.equal(C.financial({'A:US':row(1),'A_US':row(2)},'US',()=>true),null);
assert.equal(C.financial({'D:DE':row(100)},'US',()=>true),null);
const base={'A:US':{grades:{A:1,B:2,C:0,D:0},completed_count:2,success_rate:.5,active_count:2,verified_increment_cny:null},'C:US':{grades:{A:2,B:3,C:0,D:0},completed_count:10,success_rate:.9,active_count:4,verified_increment_cny:20}};
const result=C.operational(base,'US',{'A:US':{active_count:1}});
assert.equal(result.active_count,5);assert.equal(result.grades.B,5);assert.equal(result.success_rate,10/12);assert.equal(result.verified_increment_cny,20);
assert.equal(C.operational(base,'JP'),null);
const summary=JSON.parse(fs.readFileSync(__dirname+'/summary.json','utf8')),execution=JSON.parse(fs.readFileSync(__dirname+'/execution.json','utf8'));
const before=JSON.stringify([summary,execution]);
for(const g of summary.groups){
 const p=g.periods.find(p=>p.kind==='week');
 for(const country of ['US','UK','DE']){
  const original=Object.entries(p.sites).filter(([key])=>key.split(':').pop()===country).map(([,value])=>value);
  const actual=C.financial(p.sites,country,()=>true);
  if(original.length){assert(Math.abs(actual.adjusted_sales_cny-original.reduce((n,r)=>n+r.adjusted_sales_cny,0))<1e-7);assert.equal(actual.unitsOrdered,original.reduce((n,r)=>n+r.unitsOrdered,0));}
  const live=execution.groups[g.manager]?.site_operational;
  const state=C.operational(g.site_operational,country,live);
  const keys=Object.keys(g.site_operational).filter(key=>key.split(':').pop()===country);
  if(keys.length){assert.equal(state.exit_skus,keys.reduce((n,key)=>n+(g.site_operational[key].exit_skus||0),0));assert.equal(state.active_count,keys.reduce((n,key)=>n+(live?.[key]?.active_count??g.site_operational[key].active_count),0));}
 }
}
assert.equal(JSON.stringify([summary,execution]),before);
assert(!app.slice(app.indexOf('function options()'),app.indexOf('function expectedWeeklyCutoff')).includes('available_sites'));
assert(fs.readFileSync(__dirname+'/index.html','utf8').includes('<label>国家<select id="site">'));
console.log('Countries: stable options, account aliases, US/UK/DE partitions, rates, per-account execution overlay, absent-country handling and source immutability passed.');
