'use strict';
// Pricing-only read model. Business metrics come from complete source weeks.
(function(root){
 const statusOrder={'无效':0,'需关注':1,'待核验':2,'待观察':3,'有效候选':4};
 const executionSheetIds={'1_cFtlAw32LfrSLhZGb8u45JRXZ5QCjRd':'2118716986','1eQ8q10c8AFXS5WeQur0Am-iVDUHu6OOP':'1912790854','1D_ecSV7gRw7LFA30nCnPyr7xzuJ_A5Z_':'1922718474','1TeLm-rAD8u5Tx9WKMt11QnHpVsFqtJQ0':'395136180'};
 function reportLink(g){
  if(!g.report_url)return null;
  try{const u=new URL(g.report_url),m=u.pathname.match(/\/spreadsheets\/d\/([^/]+)/),gid=m&&executionSheetIds[m[1]];
   if(u.hostname!=='docs.google.com'||!gid)return g.report_url;
   u.searchParams.set('gid',gid);u.hash='gid='+gid;return u.href;
  }catch{return null;}
 }
 const sign=b=>JSON.stringify((b.children||[]).map(c=>[c.child,c.start,c.original_price,c.actual_price]));
 function currentJudge(e,b){
  if(!e.before||!e.after)return e;
  if(e.status==='待核验'&&!String(e.reason||'').startsWith('需确认对照'))return e;
  if(b.children.some(c=>c.end&&c.end<e.observation_end))return {...e,status:'待核验',reason:'测试在观察期内结束或回退'};
  if(b.children.some(c=>!c.comparability_confirmed||!c.interference_confirmed))return {...e,status:'待核验',reason:'需确认对照及汇率、广告、促销、断货干扰'};
  const a=e.before,z=e.after;
  if(a.asp==null||z.asp==null||a.margin==null||z.margin==null)return {...e,status:'待核验',reason:'销量或销售额为零，无法计算可比均价或利润率'};
  if(e.profit_delta<=0)return {...e,status:'无效',reason:'父单净利润未增长'};
  if(z.asp<a.asp)return {...e,status:'需关注',reason:'净利润增长但ASP下降，提价贡献待核验'};
  if(z.margin<a.margin)return {...e,status:'需关注',reason:'净利润增长但利润率下降'};
  if(z.asp>a.asp&&z.margin>a.margin)return {...e,status:'有效候选',reason:'净利润、ASP和利润率均增长；仍需核验因果'};
  return {...e,status:'需关注',reason:'净利润增长，ASP或利润率改善不足'};
 }
 function view(events,weekly,filter){
  if(!filter.end||filter.end<filter.latestWeek)return {historyMissing:true,parents:[]};
  const all=(events||[]).filter(b=>b.site&&b.parent&&b.batch_week&&b.batch_week<=filter.end)
    .map(b=>({...b,children:(b.children||[]).filter(c=>c.start&&c.start<=filter.end)})).filter(b=>b.children.length);
  const latest=new Map();
  for(const b of all){
   const windowEnd=new Date(b.batch_week+'T00:00:00Z');windowEnd.setUTCDate(windowEnd.getUTCDate()+20);
   if(filter.start&&windowEnd.toISOString().slice(0,10)<filter.start)continue;
   if(filter.manager!=='all'&&!b.owners?.includes(filter.manager))continue;
   if(filter.country!=='all'&&filter.countryOf(b.site)!==filter.country)continue;
   const k=b.site+'\u0000'+b.parent,prev=latest.get(k);
   if(!prev||b.batch_week>prev.batch_week)latest.set(k,b);
  }
  const parents=[];
  for(const b of latest.values()){
   const stored=(weekly?.parents||[]).find(x=>x.site===b.site&&x.parent===b.parent&&x.batch_week===b.batch_week);
   let e=stored?.effect;
   const sameBatch=!!e&&JSON.stringify(e.signature)===sign(b);
   if(!sameBatch)e={status:'待观察',reason:'等待下次周二任务匹配完整周数据',before:null,after:null};
   else if(e.observation_end>filter.end)e={...e,status:'待观察',reason:'所选周期内观察期尚未完成',before:null,after:null,profit_delta:null,sales_delta:null,units_change:null};
   else if(all.some(x=>x!==b&&x.site===b.site&&x.parent===b.parent&&x.batch_week>=e.base_start&&x.batch_week<=e.observation_end))e={...e,status:'待核验',reason:'比较窗口内存在其他提价批次'};
   else e=currentJudge(e,b);
   if(b.ownership_unconfirmed)e={...e,status:'待核验',reason:'负责人归属未与已核验候选来源匹配',before:null,after:null,profit_delta:null,sales_delta:null,units_change:null};
   const related=all.filter(x=>{
    if(x.site!==b.site||x.parent!==b.parent)return false;
    const end=new Date(x.batch_week+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+20);
    return !filter.start||end.toISOString().slice(0,10)>=filter.start;
   });
   const unique=new Map();for(const x of related)for(const c of x.children)unique.set(JSON.stringify([c.child,c.start,c.original_price,c.actual_price]),c);
   parents.push({...b,owners:[...new Set(related.flatMap(x=>x.owners))].sort(),children:[...unique.values()],name:stored?.parent_name||null,
                 forecast_profit:related.length===1?(b.forecast_profit??(sameBatch?stored?.forecast_profit:null)??null):null,effect:e});
  }
  return {historyMissing:false,parents};
 }
 function sort(rows,mode){
  const rank=x=>statusOrder[x.effect.status]??3;
  return [...rows].sort((a,b)=>{
   if(mode==='status')return rank(a)-rank(b)||a.site.localeCompare(b.site);
   if(mode==='profit'||mode==='units'){
    const field=mode==='profit'?'profit_delta':'units_change',x=a.effect[field],y=b.effect[field];
    if(typeof x!=='number')return typeof y==='number'?1:rank(a)-rank(b);
    if(typeof y!=='number')return -1;return x-y||rank(a)-rank(b);
   }
   const ap=a.effect.profit_delta,bp=b.effect.profit_delta;
   return rank(a)-rank(b)||(typeof ap==='number'?ap:Infinity)-(typeof bp==='number'?bp:Infinity)||a.site.localeCompare(b.site);
  });
 }
 const api={view,sort,currentJudge};if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(typeof document==='undefined')return;
 let page=0,expanded=null,lastFilter='',data=root.PRICE_EFFECT_WEEKLY||null,fetchFailed=false;
 const id=s=>document.getElementById(s),finite=x=>typeof x==='number'&&Number.isFinite(x);
 const signed=x=>finite(x)?(x>0?'+':'')+money(x):'—';
 const rate=x=>finite(x)?pct(x):'—';
 const beforeAfter=(a,b,fn)=>a==null||b==null?'—':fn(a)+' → '+fn(b);
 const action=s=>s==='无效'?'检查销量及利润下滑，评估回退':s==='需关注'?'核验利润质量与商品替代':s==='有效候选'?'复核干扰与对照，审慎保留':'等待完整周数据及干扰核验';
 function render(){
  const active=tab==='price';id('parentEffectPanel').hidden=!active;id('priceReportsPanel').hidden=!active;if(!active)return;
  const state=root.EXECUTION_DATA||{},period=selectedPeriod(),manager=id('manager').value,country=id('site').value;
  const signature=[manager,country,id('period').value].join('|');if(signature!==lastFilter){page=0;expanded=null;lastFilter=signature;}
  const filtered=view(state.price_effect_events||[],data,{manager,country,start:period?.start,end:period?.end,latestWeek:expectedWeeklyCutoff(),countryOf:s=>OperatingCountries.parse(s)?.country});
  const rows=sort(filtered.parents,id('parentEffectSort').value);const unavailable=!Array.isArray(state.price_effect_events);
  const count=filtered.historyMissing||unavailable?null:rows.length;
  const comparable=rows.filter(x=>['无效','需关注','有效候选'].includes(x.effect.status));
  const measure=(label,value)=>`<div>${label}<strong>${value==null?'—':num(value)}</strong></div>`;
  id('parentEffectSummary').innerHTML=measure('已确认提价父单',count)+measure('可比较父单',count==null?null:comparable.length)+measure('净利润增长',count==null?null:comparable.filter(x=>x.effect.profit_delta>0).length)+measure('净利润下降',count==null?null:comparable.filter(x=>x.effect.profit_delta<0).length);
  const basisPending=groups().reduce((n,g)=>n+(state.groups?.[g.manager]?.price_basis_pending||0),0);
  const gap=filtered.historyMissing?'该历史周期没有保存可追溯的执行快照，当前快照不冒充历史数据。':unavailable?'执行明细正在等待下一次成功同步，当前父单数暂不可确认。':`本次已核验 ${data?.source_weeks_available?.length??0} 个周度全源；缺少前后各两周、父子归属不完整或存在干扰时标记待观察/待核验。`;
  id('parentEffectGap').textContent=gap+(basisPending?` 有 ${basisPending} 条记录的提价前价格依据待核验。`:'')+(fetchFailed?' 周度快照读取失败，保留上次有效数据。':'')+' 父单利润变化是实际经营变化，不能直接证明提价带来的因果收益。';
  id('parentEffectDate').textContent=`周数据截至 ${data?.weekly_cutoff||'待同步'} · 执行表读取 ${state.data_asof?.replace('T',' ').slice(0,19)||'待同步'} · 最近同步 ${state.last_success_at?.replace('T',' ').slice(0,19)||'待同步'}`;
  id('periodCoverage').textContent=filtered.historyMissing?'所选历史周期缺少可追溯执行快照。':`执行事实按所选周期截止 ${period?.end||'—'} 筛选；当前机会为周度快照。`;
  id('weeklyCoverageDetails').hidden=true;
  if(!filtered.historyMissing&&!unavailable){
   const ops=groups().map(op).filter(Boolean),children=new Set(rows.flatMap(b=>b.children.map(c=>b.site+'|'+c.child))).size;
   const active=new Set(rows.flatMap(b=>b.children.filter(c=>c.start<=period.end&&(!c.end||c.end>=period.end)&&['测试中','观察中','已启动','暂停','暂停复核'].includes(c.state)).map(c=>b.site+'|'+c.child))).size;
   const candidates=sum(ops.map(o=>({n:o.grades?.A!=null&&o.grades?.B!=null?o.grades.A+o.grades.B:null})),'n');
   id('metrics').innerHTML=metric('A / B级机会SKU',num(candidates),'最新机会快照')+metric('待核验SKU',num(sum(ops,'pending_verification')),'最新机会快照')+metric('已核验待提价',num(sum(ops,'ready_count')),'最新机会快照')+metric('已执行提价子ASIN',num(children),'按当前筛选去重')+metric('测试中SKU',num(active),'执行表实际启动状态')+metric('可比较父单',num(comparable.length),'前后各两个完整周');
  }else id('metrics').innerHTML=['A / B级机会SKU','待核验SKU','已核验待提价','已执行提价子ASIN','测试中SKU','可比较父单'].map(x=>metric(x,'—',filtered.historyMissing?'历史快照未保存':'等待同步')).join('');
  id('alertsTitle').textContent='03｜提价效果复盘';id('alertsDescription').textContent='按所选负责人、国家和周期汇总父单状态；实际利润变化不直接等同于提价因果收益。';
  const review=['有效候选','需关注','待观察','待核验','无效'];
  id('alerts').innerHTML=filtered.historyMissing||unavailable?'<div class="empty">暂无可追溯的执行快照</div>':`<div class="price-review-counts">${review.map(s=>`<span>${s} <strong>${rows.filter(b=>b.effect.status===s).length}</strong></span>`).join('')}</div>`+(rows.length?rows.map(b=>`<div class="alert"><strong>${esc(b.name||'父单名待补')}</strong><span>${esc(b.parent)} · ${esc(b.effect.status)}：${esc(action(b.effect.status))}</span></div>`).join(''):'<div class="empty">当前范围暂无符合证据条件的实际提价记录。</div>');
  id('priceReportLinks').innerHTML=groups().map(g=>{const u=reportLink(g);return u?`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(g.manager)} · 02｜提价执行与复盘 ↗</a>`:'';}).join('');
  const pages=Math.max(1,Math.ceil(rows.length/20));page=Math.min(page,pages-1);const visible=rows.slice(page*20,page*20+20);
  id('parentEffectCount').textContent=filtered.historyMissing?'历史快照待接入':`共 ${rows.length} 个父单`;
  id('parentEffectPage').textContent=`${page+1} / ${pages}`;id('parentEffectPrev').disabled=page===0;id('parentEffectNext').disabled=page>=pages-1;
  id('parentEffectRows').innerHTML=visible.length?visible.map((b,i)=>{
   const e=b.effect,a=e.before,z=e.after,index=page*20+i,countryCode=OperatingCountries.parse(b.site)?.country||'待核验',countryName=OperatingCountries.names[countryCode]||countryCode;
   const childCount=new Set(b.children.map(c=>c.child)).size;
   const line=`<tr data-effect-row="${index}" tabindex="0"><td>${esc(b.owners.join('、')||'待核验')}</td><td>${esc(countryName)}<small> ${esc(b.site)}</small></td><td><button type="button" data-effect-row="${index}" aria-expanded="${expanded===index}">${expanded===index?'收起':'展开'}</button> ${esc(b.name||'待补')}</td><td>${esc(b.parent)}</td><td>${childCount}</td><td>${signed(b.forecast_profit)}</td><td class="profit-change ${e.profit_delta<0?'negative':''}">${signed(e.profit_delta)}</td><td>${beforeAfter(a?.margin,z?.margin,rate)}</td><td>${beforeAfter(a?.asp,z?.asp,money)}</td><td>${rate(e.units_change)}</td><td>${signed(e.sales_delta)}</td><td>${esc(e.status||'待观察')}</td></tr>`;
   if(expanded!==index)return line;
   const children=b.children.map(c=>`${esc(c.child)}：${esc(c.currency||'')} ${num(c.original_price,2)} → ${num(c.actual_price,2)}（${pct((c.actual_price-c.original_price)/c.original_price)}），生效 ${esc(c.start)}`).join('<br>');
   const detail=`<tr class="effect-detail"><td colspan="12"><strong>实际提价子体</strong><br>${children}<br><strong>比较周期：</strong>${esc(e.base_start||'待同步')} — ${esc(e.base_end||'—')}；观察 ${esc(e.observation_start||'待同步')} — ${esc(e.observation_end||'—')}（生效周为过渡）。<br><strong>前 → 后：</strong>销售额 ${beforeAfter(a?.sales,z?.sales,money)}；销量 ${beforeAfter(a?.units,z?.units,num)}；净利润 ${beforeAfter(a?.profit,z?.profit,money)}；利润率 ${beforeAfter(a?.margin,z?.margin,rate)}；ASP ${beforeAfter(a?.asp,z?.asp,money)}。<br>预计销售额增量：—（未记录事前依据）；实际销售额变化：${signed(e.sales_delta)}；实际与预计利润差：${finite(e.profit_delta)&&finite(b.forecast_profit)?signed(e.profit_delta-b.forecast_profit):'—'}。<br><strong>判断：</strong>${esc(e.reason||'待观察')}；${esc(action(e.status))}。</td></tr>`;
   return line+detail;
  }).join(''):`<tr><td colspan="12" class="price-effect-empty">${filtered.historyMissing?'历史执行快照未保存':unavailable?'执行表同步待完成':'当前范围暂无符合证据条件的已提价父单'}</td></tr>`;
 }
 const toggle=e=>{const b=e.target.closest('[data-effect-row]');if(!b)return;const i=Number(b.dataset.effectRow);expanded=expanded===i?null:i;render();};
 id('parentEffectRows').addEventListener('click',toggle);
 id('parentEffectRows').addEventListener('keydown',e=>{if(e.target.tagName==='TR'&&(e.key==='Enter'||e.key===' ')){e.preventDefault();toggle(e);}});
 id('parentEffectPrev').addEventListener('click',()=>{page--;expanded=null;render();});id('parentEffectNext').addEventListener('click',()=>{page++;expanded=null;render();});
 id('parentEffectSort').addEventListener('change',()=>{page=0;expanded=null;render();});
 for(const k of ['manager','site','period'])id(k).addEventListener('change',render);
 document.querySelectorAll('.navigation-bar button').forEach(b=>b.addEventListener('click',render));
 root.PriceEffects={render};
 async function refresh(){try{const r=await fetch('price-effect-weekly.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('fetch');const n=await r.json();if(n.schema!=='price-effect-weekly-v1'||!Array.isArray(n.parents)||!n.weekly_cutoff||!n.generated_at)throw Error('schema');if(data&&(n.weekly_cutoff<data.weekly_cutoff||Date.parse(n.generated_at)<Date.parse(data.generated_at)))throw Error('stale');data=n;fetchFailed=false;}catch{fetchFailed=true;}render();}
 if(location.protocol==='http:'||location.protocol==='https:'){refresh();setInterval(refresh,60000);}
})(typeof window!=='undefined'?window:globalThis);
