'use strict';
const D=structuredClone(window.OPERATIONS_DATA||{groups:[]}), $=id=>document.getElementById(id);let tab='all';
let W=window.SNAPSHOT_GUARD.restore('weekly_business',window.WEEKLY_BUSINESS_DATA||null);
function applyBusinessWeeks(){
 if(!W)return;
 for(const g of D.groups){const b=W.groups[g.manager];if(!b)continue;
  for(const key of ['asof','weekly_cutoff','monthly_cutoff','weekly_complete','monthly_coverage'])if(g['pricing_'+key]==null)g['pricing_'+key]=g[key];
  g.pricing_report_verified=g.pricing_report_verified??g.report_verified;
  g.periods=[...(g.periods||[]).filter(p=>p.kind!=='week'),...b.periods.map(p=>({...g.periods?.find(x=>x.kind==='week'&&x.start===p.start&&x.end===p.end),...p}))];
  g.weekly_cutoff=b.weekly_cutoff;g.weekly_complete=b.weekly_complete;
  g.stale=!b.latest_complete;g.refresh_failed=false;
  g.status=b.latest_complete?'周经营数据已核验':'本周数据待核，保留上一有效周';
 }
 D.generated_at=W.generated_at;
}
applyBusinessWeeks();
// BEGIN SHARED COUNTRIES: fixed public component; source account keys stay unchanged.
const OperatingCountries=(()=>{
 const names={US:'美国',UK:'英国',DE:'德国',FR:'法国',IT:'意大利',ES:'西班牙',CA:'加拿大',MX:'墨西哥',BR:'巴西',BE:'比利时',IE:'爱尔兰',NL:'荷兰',PL:'波兰',SE:'瑞典',IN:'印度',JP:'日本',AU:'澳大利亚',SG:'新加坡',AE:'阿联酋',SA:'沙特阿拉伯',TR:'土耳其',ZA:'南非',EG:'埃及'};
 const accounts={A:'US',C:'US'};
 function parse(raw){
  const key=String(raw??'').trim().toUpperCase(),match=/^(.+?)[：:_/\s-]+([A-Z]{2})$/.exec(key);
  let country=match?match[2]:names[key]||key==='GB'?key:accounts[key];
  if(country==='GB')country='UK';if(!names[country])return null;
  return {country,identity:match?match[1]+':'+country:accounts[key]?'ACCOUNT:'+key+':'+country:'UNASSIGNED:'+country};
 }
 // Each raw market is a disjoint source partition, including unassigned-account US.
 // Alias keys for the same account are counted once; conflicting aliases fail closed.
 function entries(map,country){
  if(!map||typeof map!=='object')return null;
  const seen=new Map();
  for(const [key,row] of Object.entries(map)){
   const parsed=parse(key);if(!parsed||parsed.country!==country)continue;
   const id=parsed.identity.replace(/^ACCOUNT:/,'');
   if(seen.has(id)&&JSON.stringify(seen.get(id).row)!==JSON.stringify(row))return null;
   seen.set(id,{key,row});
  }
  return [...seen.values()];
 }
 const divide=(a,b)=>a!=null&&b?a/b:null;
 const add=(rows,key,knownOnly=false)=>{
  const values=rows.map(r=>r?.[key]);
  if(!knownOnly&&values.some(v=>typeof v!=='number'||!Number.isFinite(v)))return null;
  const nums=values.filter(v=>typeof v==='number'&&Number.isFinite(v));
  return nums.length?nums.reduce((a,b)=>a+b,0):null;
 };
 function financial(map,country,valid){
  const items=entries(map,country);if(!items?.length||items.some(e=>!valid(e.row)))return null;
  const rows=items.map(e=>e.row),out={};
  for(const key of ['orderProductSales','discountCostSales','unitsOrdered','salesNetProfit','adsSpend','adjusted_sales_cny','adjusted_net_profit_cny'])out[key]=add(rows,key);
  out.asp=divide(out.discountCostSales,out.unitsOrdered);out.margin=divide(out.salesNetProfit,out.orderProductSales);
  out.ad_rate=divide(out.adsSpend,out.orderProductSales);out.adjusted_net_margin=divide(out.adjusted_net_profit_cny,out.adjusted_sales_cny);
  return out;
 }
 function operational(map,country,patch){
  const base=entries(map,country),live=patch?entries(patch,country):[];if(!base||!live)return null;
  const records=new Map(base.map(e=>[parse(e.key).identity.replace(/^ACCOUNT:/,''),e.row]));
  for(const e of live){const key=parse(e.key).identity.replace(/^ACCOUNT:/,'');records.set(key,{...records.get(key),...e.row});}
  const rows=[...records.values()];if(!rows.length)return null;
  const out={},keys=new Set(rows.flatMap(r=>Object.keys(r)));
  for(const key of keys)if(rows.some(r=>typeof r[key]==='number'||r[key]===null))out[key]=add(rows.filter(r=>Object.hasOwn(r,key)),key,key==='verified_increment_cny');
  for(const key of ['grades','execution_states']){
   const labels=key==='grades'?['A','B','C','D']:[...new Set(rows.flatMap(r=>Object.keys(r[key]||{})))];
   out[key]=Object.fromEntries(labels.map(label=>[label,rows.every(r=>r[key])?rows.reduce((n,r)=>n+(r[key][label]||0),0):null]));
  }
  const completedRows=rows.filter(r=>Object.hasOwn(r,'completed_count')),completed=add(completedRows,'completed_count');
  const wins=completedRows.every(r=>r.completed_count===0||Number.isFinite(r.success_rate))?completedRows.reduce((n,r)=>n+Math.round((r.success_rate||0)*r.completed_count),0):null;
  out.success_rate=divide(wins,completed);out.cleanup_progress=rows.length===1?rows[0].cleanup_progress??null:null;
  return out;
 }
 return {names,parse,entries,financial,operational};
})();
// END SHARED COUNTRIES
window.OPERATING_COUNTRIES=OperatingCountries;
function initCountrySelector(){
 const select=$('site');select.replaceChildren(new Option('全部国家','all'));
 for(const [code,name] of Object.entries(OperatingCountries.names))select.add(new Option(name+'（'+code+'）',code));
 try{const saved=sessionStorage.getItem('operations-selected-country');if(OperatingCountries.names[saved])select.value=saved;}catch{}
 select.addEventListener('change',()=>{try{sessionStorage.setItem('operations-selected-country',select.value);}catch{}});
}
function countryEmpty(g,id,exit=false){
 if($('site').value==='all'||!g.report_verified)return false;
 const p=matchedPeriod(g,id),items=OperatingCountries.entries(p?.[exit?'site_exit_cohort_metrics':'sites'],$('site').value);
 return completeMetrics(p?.metrics,p)&&items?.length===0;
}
function countryStateEmpty(g){
 if($('site').value==='all')return false;
 const base=OperatingCountries.entries(g.site_operational,$('site').value),map=window.EXECUTION_DATA?.groups?.[g.manager]?.site_operational,live=map?OperatingCountries.entries(map,$('site').value):[];
 return base?.length===0&&live?.length===0;
}
function countryCoverage(){
 const country=$('site').value,box=$('countryCoverage');if(tab==='warnings')return;
 box.hidden=country==='all';if(box.hidden)return;
 const present=groups().filter(g=>tab==='all'?period(g,$('period').value):op(g)).length;
 box.textContent=OperatingCountries.names[country]+'（'+country+'）：'+(present?'已匹配 '+present+' 位负责人；按原始账号分区去重汇总。':'所选国家、负责人及周期暂无对应完整数据；不回退全部国家或旧数据。');
}
// BEGIN SHARED CALENDAR: independent of every business snapshot.
const OperatingCalendar=(()=>{
 const dayMs=86400000,historyStart='2026-05-01';
 const iso=d=>d.toISOString().slice(0,10),date=s=>new Date(s+'T00:00:00Z');
 const shift=(s,n)=>iso(new Date(date(s).getTime()+n*dayMs));
 const today=(now=new Date())=>{
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day;
 };
 const make=(kind,start,end)=>({id:kind+'_'+start+'_'+(end||'pending')+'_CNY',kind,start,end});
 const month=(start,delta=0)=>{const d=date(start);return iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+delta,1)));};
 const fullMonth=start=>make('month',start,shift(month(start,1),-1));
 const weekEnd=current=>shift(current,-((date(current).getUTCDay()+6)%7+1));
 function parse(id){
  const m=/^(week|month)_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2}|pending)_CNY$/.exec(id||'');
  if(!m||!Number.isFinite(+date(m[2]))||iso(date(m[2]))!==m[2])return null;
  const end=m[3]==='pending'?null:m[3];
  if(end&&(!Number.isFinite(+date(end))||iso(date(end))!==end||end<m[2]))return null;
  if(m[1]==='week'&&(!end||date(m[2]).getUTCDay()!==1||shift(m[2],6)!==end))return null;
  if(m[1]==='month'&&(m[2].slice(8)!=='01'||end&&end.slice(0,7)!==m[2].slice(0,7)))return null;
  return make(m[1],m[2],end);
 }
 function generate(now=new Date()){
  const current=today(now),lastSunday=weekEnd(current);
  const weeks=Array.from({length:12},(_,i)=>make('week',shift(lastSunday,-6-i*7),shift(lastSunday,-i*7)));
  const start=current.slice(0,7)+'-01',yesterday=shift(current,-1),mtd=make('month',start,yesterday>=start?yesterday:null),months=[];
  for(let m=month(start,-1);m>=historyStart;m=month(m,-1))months.push(fullMonth(m));
  return {today:current,weeks,mtd,months};
 }
 function previous(p){return p.kind==='week'?make('week',shift(p.start,-7),shift(p.end,-7)):fullMonth(month(p.start,-1));}
 function trend(p){
  return Array.from({length:p.kind==='week'?12:6},(_,i)=>p.kind==='week'?make('week',shift(p.start,-i*7),shift(p.end,-i*7)):i===0?p:fullMonth(month(p.start,-i))).reverse();
 }
 return {today,generate,parse,previous,trend,weeklyCutoff:(now=new Date())=>weekEnd(today(now))};
})();
// END SHARED CALENDAR
window.OPERATING_PERIODS=OperatingCalendar;
let periodCalendarDay='',periodUserSelected=false,periodAutoChange=false;
function selectedPeriod(){return OperatingCalendar.parse($('period').value);}
function refreshPeriodOptions(now=new Date()){
 if(OperatingCalendar.today(now)===periodCalendarDay)return false;
 const calendar=OperatingCalendar.generate(now);
 periodCalendarDay=calendar.today;
 let keep=periodUserSelected?$('period').value:null;
 if(!keep){try{keep=sessionStorage.getItem('operations-selected-period');periodUserSelected=!!OperatingCalendar.parse(keep);}catch{}}
 const pinned=OperatingCalendar.parse(keep);
 if(pinned&&(pinned.start>calendar.today||(pinned.end&&pinned.end>=calendar.today))){keep=null;periodUserSelected=false;}
 const select=$('period'),prior=select.value;select.replaceChildren();
 const append=(name,items,prefix='')=>{const group=document.createElement('optgroup');group.label=name;for(const p of items)group.append(new Option((prefix||(p.kind==='week'?'周 ':'月 '))+p.start+' — '+(p.end||'暂无完整自然日'),p.id));select.append(group);};
 append('最近12个完整自然周',calendar.weeks);append('当月累计（截至上一完整自然日）',[calendar.mtd],'当月累计 ');append('历史完整自然月',calendar.months);
 if(keep&&pinned&&![...select.options].some(o=>o.value===keep))append('保留已选区间（不延展统计日期）',[pinned]);
 select.value=keep&&[...select.options].some(o=>o.value===keep)?keep:calendar.weeks[0].id;
 return prior!==select.value;
}
function initPeriodSelector(){
 refreshPeriodOptions();
 $('period').addEventListener('change',()=>{if(!periodAutoChange){periodUserSelected=true;try{sessionStorage.setItem('operations-selected-period',$('period').value);}catch{}}});
 const update=()=>{if(refreshPeriodOptions()){periodAutoChange=true;$('period').dispatchEvent(new Event('change'));periodAutoChange=false;}};
 setInterval(update,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
}
function matchedPeriod(g,id){
 const wanted=OperatingCalendar.parse(id);if(!wanted?.end)return null;
 if(tab==='all'&&wanted.kind==='month'&&wanted.start.slice(0,7)===OperatingCalendar.today().slice(0,7)){
  const actual=window.OPERATIONS_TARGETS?.personal?.[wanted.start.slice(0,7)]?.[g.manager]?.actual;
  if(!actual||actual.start!==wanted.start||actual.cutoff!==wanted.end||actual.basis!=='adjusted_once_from_raw_erp'||Math.abs(actual.sales-actual.raw_sales*.9)>.011||Math.abs(actual.net_profit-actual.raw_net_profit*.85)>.011)return null;
  return {...wanted,daily:true,joint_pending:actual.joint_pending,metrics:{status:'verified',source_start:actual.start,source_end:actual.cutoff,
   orderProductSales:actual.raw_sales,salesNetProfit:actual.raw_net_profit,adsSpend:Math.abs(actual.raw_signed_ads),
   adjusted_sales_cny:actual.sales,adjusted_net_profit_cny:actual.net_profit,adjusted_net_margin:actual.net_margin,
   discountCostSales:null,unitsOrdered:null,ad_rate:actual.ad_burden}};
 }
 return (g.periods||[]).find(p=>p.kind===wanted.kind&&p.start===wanted.start&&p.end===wanted.end)||null;
}
function completeMetrics(row,p){
 if(!row||!p||row.complete===false||p.complete===false||(row.status&&row.status!=='verified'))return false;
 if(row.source_start&&row.source_start!==p.start||row.source_end&&row.source_end!==p.end)return false;
 return (p.daily?['orderProductSales','salesNetProfit','adsSpend','adjusted_sales_cny','adjusted_net_profit_cny']:['orderProductSales','discountCostSales','unitsOrdered','salesNetProfit','adsSpend','adjusted_sales_cny','adjusted_net_profit_cny']).every(k=>typeof row[k]==='number'&&Number.isFinite(row[k]));
}
function periodCoverage(gs){
 renderWeeklyDifferences();
 const p=selectedPeriod(),kind=p?.kind||'week',cutoffs=gs.map(g=>g.manager+' '+(kind==='week'?g.weekly_cutoff:g.monthly_cutoff||'待接入')).join('；');
 if(tab==='all'&&W&&kind==='week'){
  const dept=W.department_periods.find(x=>x.start===p.start&&x.end===p.end),count=gs.filter(g=>period(g,$('period').value)||countryEmpty(g,$('period').value)).length;
  const gaps=W.issues.filter(i=>i.start===p.start&&(!i.manager||gs.some(g=>g.manager===i.manager)));
  const missing=gaps.some(i=>i.reason.startsWith('source_excluded_rows_unverified:'));
  $('periodCoverage').textContent='所选完整周 '+p.start+' — '+p.end+'。'+(dept&&$('manager').value==='all'?(dept.retained_previous?'保留原已发布范围的快照，未重新认证部门全量。':'部门数据已核验；共管记录仅在部门计入一次，个人不拆分。'):'')+'负责人'+(dept?.retained_previous?'原快照覆盖 ':'完整覆盖 ')+count+'/'+gs.length+'。'+(gaps.length?(missing?'原缓存存在未留存明细的无 ASIN 记录，无法确认部门完整范围；新增周指标暂不发布。':'存在待核归属或取数缺口，本周缺失指标暂不发布。'):'')+' 上一有效周截止：'+cutoffs+'。';
  return;
 }
 const selected='所选周期 '+(p?p.start+' — '+(p.end||'暂无完整自然日'):'待选择')+'。';
 if(tab==='all'){
  const any=gs.some(g=>period(g,$('period').value)),count=any?gs.filter(g=>period(g,$('period').value)||countryEmpty(g,$('period').value)).length:0;
  $('periodCoverage').textContent=selected+(count===gs.length&&count?'已匹配全部负责人该周期真实数据。':'该周期暂无完整数据（已匹配 '+count+'/'+gs.length+' 位负责人；汇总不使用缺失数据）。实际统计截止：'+cutoffs+'。');
 }else if(tab!=='warnings'){
  const dates=gs.map(g=>g.manager+' '+(cardScope(g,tab).asof||'待接入')).join('；');
  $('periodCoverage').textContent=selected+'该周期暂无完整数据：'+(tab==='price'?'提价机会、执行状态及理论增量':'库存与清理状态')+'为独立状态快照，不支持所选周/月回溯。实际快照截止：'+dates+'。'+(tab==='exit'?'退出产品销售额、净毛利另按所选周期精确匹配，缺失留空；经营实际统计截止：'+cutoffs+'。':'执行状态以「执行表截至」为准，不计作所选周期成果。');
 }
}
function renderWeeklyDifferences(){
 let box=$('weeklyDifferences');if(!box){box=document.createElement('div');box.id='weeklyDifferences';box.className='notice';box.setAttribute('role','status');$('periodCoverage').insertAdjacentElement('afterend',box);}
 const p=selectedPeriod(),d=W?.differences;
 box.hidden=tab!=='all'||p?.kind!=='week'||d?.start!==p.start||d?.end!==p.end;
 if(box.hidden)return;
 const u=d.department_confirmed_unassigned,ref=d.reference,parts=[];
 if(u?.records)parts.push(`未归属负责人（部门归属已确认，个人未分配）：${u.records}条，ERP原始销售额 ¥${num(u.raw_sales,2)}、原始净毛利 ¥${num(u.raw_net_profit,2)}。`+(u.formal_week_inclusion?'已在部门计入一次，不重复加到个人。':'本周整体校验未通过，暂未计入正式周指标。'));
 if(ref){const c=ref.classification||{},four=c.department_confirmed_mapping_missing,other=c.other_manager_mapping,unknown=c.department_unverified;
  parts.push(`无ASIN对照：${ref.measurement_start}—${ref.measurement_end}月累计缓存含${ref.records}条虚拟MSKU、零销售负利润记录；四组产品映射${four?.records||0}条、净毛利 ¥${num(four?.raw_net_profit,2)}；其他负责人映射${other?.records||0}条、¥${num(other?.raw_net_profit,2)}；部门待核${unknown?.records||0}条、¥${num(unknown?.raw_net_profit,2)}。具体费用类型及本周原始金额未核实，月累计金额不能替代周金额。`);
 }
 box.textContent='部门差异说明（不分配给个人）：'+parts.join(' ');
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(x,d=0)=>x===null||x===undefined?'—':Number(x).toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d});
const money=x=>x===null||x===undefined?'—':(Math.abs(x)>=10000?num(x/10000,2)+'万':num(x,2));const pct=x=>x==null?'—':num(x*100,1)+'%';
const sum=(rows,key)=>rows.length&&rows.every(r=>r&&r[key]!=null)?rows.reduce((s,r)=>s+r[key],0):null;
const ratio=(a,b)=>a!=null&&b? a/b:null;
const metric=(h,v,n='')=>`<div class="metric"><h3>${h}</h3><div class="value ${String(v).startsWith('-')?'neg':''}">${v}</div><small>${n}</small></div>`;
function groups(){return D.groups.filter(g=>$('manager').value==='all'||g.manager===$('manager').value)}
function displayMetrics(m){return m&&{...m,erp_orderProductSales:m.orderProductSales,orderProductSales:m.adjusted_sales_cny??null,salesNetProfit:m.adjusted_net_profit_cny??null,margin:m.adjusted_net_margin??null}}
function period(g,id){const p=matchedPeriod(g,id),row=$('site').value==='all'?p?.metrics:OperatingCountries.financial(p?.sites,$('site').value,r=>completeMetrics(r,p));return g.report_verified&&completeMetrics(row,p)?displayMetrics(row):null;}
function op(g){return $('site').value==='all'?g.operational:OperatingCountries.operational(g.site_operational,$('site').value);}
function totals(gs,id){
 const wanted=OperatingCalendar.parse(id);
 if(W&&wanted?.kind==='week'&&$('manager').value==='all'){
  const p=W.department_periods.find(p=>p.start===wanted.start&&p.end===wanted.end);
  const raw=$('site').value==='all'?p?.metrics:OperatingCountries.financial(p?.sites,$('site').value,r=>completeMetrics(r,p));
  if(!completeMetrics(raw,p))return {};
  return displayMetrics(raw);
 }
 const rows=gs.filter(g=>!countryEmpty(g,id)).map(g=>period(g,id));let x={};for(const f of ['orderProductSales','erp_orderProductSales','discountCostSales','unitsOrdered','salesNetProfit','adsSpend'])x[f]=sum(rows,f);x.asp=ratio(x.discountCostSales,x.unitsOrdered);x.margin=ratio(x.salesNetProfit,x.orderProductSales);x.ad_rate=ratio(x.adsSpend,x.erp_orderProductSales);return x
}
function options(){for(const g of D.groups)$('manager').add(new Option(g.manager,g.manager));initCountrySelector();initPeriodSelector();}
function expectedWeeklyCutoff(now=new Date()){return OperatingCalendar.weeklyCutoff(now);}
function cardScope(g,tab){
 if(tab==='price'&&g.pricing_report_verified)return {...g,asof:g.pricing_asof,weekly_cutoff:g.pricing_weekly_cutoff,monthly_cutoff:g.pricing_monthly_cutoff,weekly_complete:g.pricing_weekly_complete,monthly_coverage:g.pricing_monthly_coverage,stale:g.pricing_weekly_cutoff<expectedWeeklyCutoff(),refresh_failed:false,status:'已核验发布'};
 if(tab==='all'&&typeof selectedPeriod==='function'&&selectedPeriod()?.kind==='month'){
  const p=matchedPeriod(g,$('period').value);
  if(p?.daily)return {...g,monthly_cutoff:p.end,stale:false,refresh_failed:false,status:p.joint_pending?'每日播报已同步；共管未分配':'每日播报已同步'};
 }
 return g;
}
function render(){
 refreshPeriodOptions();periodCoverage(groups());countryCoverage();
 const warningActive=tab==='warnings';
 for(const id of ['metrics','cardsPanel','alertsPanel'])$(id).hidden=warningActive;
 document.querySelector('footer').hidden=warningActive;
 $('period').disabled=false;
 if(window.renderAlerts)window.renderAlerts();
 if(warningActive){$('departmentGoals').hidden=$('personalGoals').hidden=true;$('trendPanel').style.display='none';return;}
for(const g of D.groups)if(g.report_verified)g.stale=Boolean(g.stale||g.weekly_cutoff<expectedWeeklyCutoff());const gs=groups(),id=$('period').value,m=totals(gs,id),ops=gs.filter(g=>!countryStateEmpty(g)).map(op),p0=selectedPeriod();const pending=gs.reduce((s,g)=>s+(matchedPeriod(g,id)?.joint_pending||0),0);const scoped=gs.map(g=>cardScope(g,tab)),published=scoped.filter(g=>g.report_verified).length;
 $('freshness').innerHTML=`${published}/${gs.length}组报表已核验 · ${!published?'等待数据发布':scoped.some(g=>g.stale)?'存在过期数据':'上一完整周'}<br>汇总生成 ${esc(((tab==='price'?D.pricing_updated_at:null)||D.generated_at||'').slice(0,19).replace('T',' '))} 北京时间`;
 $('notice').textContent=tab==='all'?`展示可明确归属的真实经营金额。${pending?'该周期仍有共管记录待分配，未计入下列金额。':'跨组汇总按同一实际周期计算。'} 部分月不与完整月直接比较。`:tab==='price'?'机会与执行状态为本次刷新快照；经营周期筛选不回溯重建历史分层。理论增量为模型情景，与已验证净毛利分开展示。':'按产品实际退出状态识别所有负责人；库存是ERP查询时快照。缺少确认的库存占用金额、清仓活动业绩与清理进度留空。';
 let html='';if(tab==='all'){const prev=p0?.end?OperatingCalendar.previous(p0).id:null,b=prev?totals(gs,prev):{};const partial=p0?.kind==='month'&&new Date(new Date(p0.end+'T12:00:00Z').getTime()+86400000).getUTCDate()!==1;const wow=partial||m.orderProductSales==null||b.orderProductSales==null?null:ratio(m.orderProductSales-b.orderProductSales,Math.abs(b.orderProductSales));html=metric('调整后销售额 · CNY',money(m.orderProductSales),(partial?'部分月，环比不比较':'销售额环比 '+pct(wow)))+metric('调整后净毛利 · CNY',money(m.salesNetProfit),'已包含广告及促销费用')+metric('调整后净毛利率',pct(m.margin),'合计净毛利 / 合计销售额')+metric('平均成交单价 · CNY',money(m.asp),'实际成交额 / 销量')+metric('广告费用率',pct(m.ad_rate),'广告 / ERP原始销售额')+metric('销量',num(m.unitsOrdered),'ERP真实子体销量');}
 else if(tab==='price'){const a=sum(ops.map(o=>o&&({a:o.grades.A!=null&&o.grades.B!=null?o.grades.A+o.grades.B:null})),'a');html=metric('A / B级机会SKU',num(a),'全部符合条件SKU，无数量上限')+metric('待核验SKU',num(sum(ops,'pending_verification')),'候选资格与执行资格分开')+metric('已核验待提价',num(sum(ops,'ready_count')),'六项核验与错峰排期均通过')+metric('测试中SKU',num(sum(ops,'active_count')),'已有测试不重复派发')+metric('理论14天增量 · CNY',money(sum(ops,'theoretical_increment_cny')),'预测：销量下降2%情景')+metric('已验证增量 · CNY',money(verifiedExecutionTotal(ops)),'需可比对照、证据及运营确认');}
 else html=metric('待淘汰SKU',num(sum(ops,'exit_skus')),'基于产品实际状态')+metric('待清理FBA库存',num(sum(ops,'exit_stock_qty')),'ERP查询时库存快照')+metric('库存占用金额 · CNY','—','字段估值范围待核验')+metric('ERP滞销库存',num(sum(ops,'unsalable_qty')),'原字段 unsalableQuantity')+metric('已确认进度记录',num(sum(ops,'confirmed_cleanup_records')),'无人工确认不计算进度')+metric('28天未推进',num(sum(ops,'no_progress_28d')),'仅对已登记最近推进日判断');
 $('metrics').innerHTML=html;if(tab!=='all')$('metrics').querySelectorAll('h3').forEach(h=>h.textContent+=' · 快照');$('trendPanel').style.display=tab==='all'?'':'none';renderModuleHeaders(gs,id);
 $('cards').innerHTML=gs.map(g=>{const v=cardScope(g,tab),x=period(g,id)||{},o=op(g),link=g.report_verified?`<a href="${esc(g.report_url)}" target="_blank" rel="noopener">${esc(g.manager)} ↗</a>`:esc(g.manager)+' · 未配置';let pairs=tab==='all'?[['调整后销售额',money(x.orderProductSales)],['调整后净毛利',money(x.salesNetProfit)],['调整后净毛利率',pct(x.margin)],['广告费率',pct(x.ad_rate)]]:tab==='price'?[['A / B / C / D',o?['A','B','C','D'].map(k=>num(o.grades[k])).join(' / '):'—'],['待提价',num(o?.ready_count)],['新增机会',num(o?.new_candidates)],['已完成 / 成功率',num(o?.completed_count)+' / '+pct(o?.success_rate)]]:[['待淘汰SKU',num(o?.exit_skus)],['FBA库存',num(o?.exit_stock_qty)],['清理进度','待运营确认'],['清仓活动业绩','待接入']];return `<article class="card"><h3>${link}</h3>${tab==='all'&&!period(g,id)?'<p class="subtle">该周期暂无完整数据</p>':''}<div class="status ${!v.report_verified||v.stale?'warn':''}">${esc(v.stale&&!v.refresh_failed?'数据过期':v.status||'未发布')}</div><dl>${pairs.map(([a,b])=>`<div><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl><div class="note">周 ${v.weekly_complete??0}/12 · 月 ${v.monthly_coverage??0}/6（含部分月）<br>周截止 ${esc(v.weekly_cutoff||'—')} · 月截止 ${esc(v.monthly_cutoff||'—')}<br>Excel周/月诊断保留ERP原始口径</div></article>`}).join('');
 const alerts=[];for(const g of gs){const o=op(g),view=cardScope(g,tab);if(!view.report_verified||view.stale)alerts.push([g.manager,g.report_verified?'数据已过期，刷新失败时仍保留上一有效报表。':'报表未发布，指标不参与正式汇总。']);if(g.weekly_complete<12)alerts.push([g.manager,`完整周仅${g.weekly_complete}/12，缺失数据未用月均摊填充。`]);if(o){if(o.pending_verification)alerts.push([g.manager,`${o.pending_verification}个候选待运营核验；${o.overdue_execution}项排期逾期，${o.overdue_review}项需复盘。`]);if(o.exit_skus)alerts.push([g.manager,`${o.exit_skus}个退出SKU；${o.confirmed_cleanup_records}条进度已确认，其余等待运营登记。`]);if(o.active_count===0&&tab==='price')alerts.push([g.manager,'尚无确认启动的实际测试；历史预填计划不计入测试成果。']);}}
 if(tab==='exit')alerts.push(['数据缺口','onInventory估值口径、清仓活动销售/利润归因未核验；无确认日期不推断长期未推进。']);if(tab==='price')alerts.push(['口径','首发时无上一版可比分层，“新增机会”留空。理论增量含负值，不能当作收益承诺。']);$('alerts').innerHTML=alerts.map(([a,b])=>`<div class="alert"><strong>${esc(a)}</strong><span>${esc(b)}</span></div>`).join('')||'<div class="subtle">当前无新增异常。</div>';
 $('foot').innerHTML=`规则 ${esc(D.rule_version||'未发布')}<br>${esc(D.hosting||'本机预览')}<br>时间 ${esc(p0?.start||'—')} — ${esc(p0?.end||'—')}`;if(tab==='all')chart(gs);}
function chart(gs){const selected=selectedPeriod(),kind=selected?.kind||'week',ps=selected?.end?OperatingCalendar.trend(selected):[],rows=ps.map(p=>totals(gs,p.id)),actualEnd=ps.filter((p,i)=>rows[i].orderProductSales!=null&&rows[i].salesNetProfit!=null).at(-1)?.end;$('trendDate').textContent=actualEnd?'实际经营截止 '+actualEnd:'该周期范围暂无完整数据';$('trendDescription').textContent=ps.length?'所选趋势区间截至'+ps[ps.length-1].end+'的最近'+ps.length+(kind==='month'?'个月（部分月单独标记）':'个完整自然周'):'所选周期无已缓存趋势';$('trendDescription').textContent+=' · 调整后销售额与净毛利（人民币）；缺失周期显示断点。';if(!ps.length){$('chart').innerHTML='<div class="empty">该历史周期没有已缓存的真实周度数据</div>';return}const vals=rows.flatMap(x=>[x.orderProductSales,x.salesNetProfit]).filter(x=>x!=null),min=Math.min(0,...vals),max=Math.max(1,...vals),range=max-min||1,W=1180,H=225,L=70,R=15,T=12,B=33,y=v=>T+(max-v)/range*(H-T-B),x=i=>L+i*(W-L-R)/Math.max(1,ps.length-1);let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="所选周期调整后销售额与净毛利趋势">`;for(let i=0;i<4;i++){const v=min+range*i/3;svg+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="#e9edf2"/><text x="${L-10}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="#8a98a7">${money(v)}</text>`}for(const [f,c] of [['orderProductSales','#2458ca'],['salesNetProfit','#119a89']]){let d='',open=false;rows.forEach((r,i)=>{if(r[f]==null){open=false;return}d+=(open?'L':'M')+x(i)+','+y(r[f])+' ';open=true;svg+=`<circle cx="${x(i)}" cy="${y(r[f])}" r="3" fill="${c}"><title>${ps[i].start} — ${ps[i].end} ${f==='orderProductSales'?'调整后销售额':'调整后净毛利'} ¥${num(r[f],2)}</title></circle>`});svg+=`<path d="${d}" fill="none" stroke="${c}" stroke-width="2.5"/>`}ps.forEach((p,i)=>svg+=`<text x="${x(i)}" y="${H-7}" text-anchor="middle" font-size="11" fill="#8a98a7">${kind==='month'?p.start.slice(0,7)+(new Date(new Date(p.end+'T12:00:00Z').getTime()+86400000).getUTCDate()!==1?'*':''):p.start.slice(5)}</text>`);$('chart').innerHTML=svg+'</svg>'}
options();for(const id of ['manager','site','period'])$(id).addEventListener('change',render);document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{tab=b.dataset.tab;document.querySelectorAll('nav button').forEach(n=>n.classList.toggle('active',n===b));render()}));render();
function periodNotes(){if(tab!=='all')return;const gs=groups(),id=$('period').value,p=selectedPeriod();if(!p?.end)return;const partial=p.kind==='month'&&new Date(new Date(p.end+'T12:00:00Z').getTime()+86400000).getUTCDate()!==1;const prev=OperatingCalendar.previous(p);const comparable=!partial&&prev&&gs.every(g=>{const a=matchedPeriod(g,id),b=matchedPeriod(g,prev.id);return (period(g,id)||countryEmpty(g,id))&&(period(g,prev.id)||countryEmpty(g,prev.id))&&!a.joint_pending&&!b.joint_pending});const a=totals(gs,id),b=prev?totals(gs,prev.id):{};const fields=['orderProductSales','salesNetProfit','margin','asp','ad_rate','unitsOrdered'];document.querySelectorAll('#metrics .metric small').forEach((n,i)=>{const f=fields[i],diff=a[f]!=null&&b[f]!=null?(a[f]-b[f]):null;const v=['margin','ad_rate'].includes(f)?(diff==null?'—':num(diff*100,1)+'个百分点'):pct(diff!=null&&b[f]?diff/Math.abs(b[f]):null);n.textContent=!comparable?(partial?'部分月；不与完整月直接比较':'缺可比归属基线；环比留空'):(p.kind==='week'?'周环比 ':'月环比 ')+v});}
function trendAlerts(){if(tab!=='all')return;const id=$('period').value;for(const g of groups()){const p=matchedPeriod(g,id);if(!period(g,id)||!p||p.kind!=='week')continue;const series=(g.periods||[]).filter(x=>x.kind==='week'&&x.end<=p.end).sort((a,b)=>b.end.localeCompare(a.end));let tags=[];for(const [f,label]of [['orderProductSales','销售额'],['unitsOrdered','销量'],['salesNetProfit','净毛利']]){let streak=0;for(let i=0;i<4;i++){const a=series[i]&&period(g,series[i].id),b=series[i+1]&&period(g,series[i+1].id);if(!a||!b||series[i].joint_pending||series[i+1].joint_pending||a[f]==null||b[f]==null||b[f]===0||a[f]>=b[f]||new Date(series[i].start)-new Date(series[i+1].start)!==604800000)break;streak++}if(streak>=2)tags.push(label+'连续'+streak+'周下滑')}const m=period(g,id);if(m?.salesNetProfit<0)tags.push('本周净毛利为负');if(m?.ad_rate>.3)tags.push('广告费用率超过30%');if(tags.length){const e=document.createElement('div');e.className='alert';e.innerHTML='<strong>'+esc(g.manager)+'</strong><span>'+esc(tags.join('；'))+'</span>';$('alerts').append(e)}}}
for(const id of ['manager','site','period'])$(id).addEventListener('change',()=>{periodNotes();trendAlerts()});document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{periodNotes();trendAlerts()}));periodNotes();trendAlerts();
function exitPerformance(){if(tab!=='exit')return;const id=$('period').value;const rows=groups().filter(g=>!countryEmpty(g,id,true)).map(g=>{const p=matchedPeriod(g,id),row=$('site').value==='all'?p?.exit_cohort_metrics:OperatingCountries.financial(p?.site_exit_cohort_metrics,$('site').value,r=>completeMetrics(r,p));return g.report_verified&&completeMetrics(row,p)?displayMetrics(row):null});$('metrics').insertAdjacentHTML('beforeend',metric('退出产品调整后销售额 · CNY',money(sum(rows,'orderProductSales')),'当前退出产品集合，非清仓活动归因')+metric('退出产品调整后净毛利 · CNY',money(sum(rows,'salesNetProfit')),'选定经营周期的真实结果'));}
for(const id of ['manager','site','period'])$(id).addEventListener('change',exitPerformance);document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',exitPerformance));
 if(location.protocol==='http:'||location.protocol==='https:')setInterval(async()=>{try{const r=await fetch('summary.json?t='+Date.now(),{cache:'no-store'});if(r.ok&&(await r.json()).pricing_updated_at!==D.pricing_updated_at)location.reload();const b=await fetch('weekly-business.json?t='+Date.now(),{cache:'no-store'});if(b.ok){W=window.SNAPSHOT_GUARD.accept('weekly_business',await b.json());applyBusinessWeeks();}}catch{}finally{render();periodNotes();trendAlerts();exitPerformance()}},60000);

// Only evidence-backed values contribute; absent verified tests remain blank.
function verifiedExecutionTotal(rows){const values=rows.map(r=>r?.verified_increment_cny).filter(v=>typeof v==='number'&&Number.isFinite(v));return values.length?values.reduce((a,b)=>a+b,0):null;}

// Presentation metadata only: source dates remain independent across modules.
function renderModuleHeaders(gs,id){
 const range=values=>{const ds=[...new Set(values.filter(Boolean))].sort();return ds.length?ds.length===1?ds[0]:ds[0]+' ～ '+ds[ds.length-1]:'待接入';};
 const periods=gs.filter(g=>!countryEmpty(g,id)).map(g=>period(g,id)?matchedPeriod(g,id):null);
 const financial=periods.every(Boolean)&&periods.length?'经营截止 '+range(periods.map(p=>p.end)):'该周期暂无完整数据 · 实际'+(selectedPeriod()?.kind==='month'?'月':'周')+'截止 '+range(gs.map(g=>selectedPeriod()?.kind==='month'?g.monthly_cutoff:g.weekly_cutoff));
 const snapshot='机会/库存快照 '+range(gs.map(g=>cardScope(g,tab).asof));
 const execution=gs.map(g=>window.EXECUTION_DATA?.groups?.[g.manager]);
 const sourceDate=v=>v?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v)):null;
 const executionDate='执行表截至 '+range(execution.map(x=>sourceDate(x?.data_asof)))+(execution.some(x=>!x?.data_asof||x.status!=='ok')?' · 部分待同步/保留旧值':'');
 $('cardsTitle').textContent=tab==='all'?'04｜各负责人经营表现':tab==='price'?'01｜提价机会与执行进度':'01｜库存退出与清理跟进';
 $('cardsDescription').textContent=tab==='all'?'按负责人查看所选周期经营表现；点击姓名打开独立报表。':tab==='price'?'查看各负责人提价机会、核验与测试执行进度；点击姓名打开独立报表。':'查看各负责人退出库存与清理跟进；点击姓名打开独立报表。';
 $('alertsTitle').textContent=tab==='all'?'05｜经营异常与待介入事项':'02｜需要关注';
 $('alertsDescription').textContent=tab==='all'?'汇总经营异常、数据缺口与需要人工介入的事项。':tab==='price'?'核查候选资格、逾期排期与复盘事项；售价及人工状态由运营确认。':'核查退出库存、清理进度与待补数据；清理进度以人工确认为准。';
 $('cardsDate').textContent=tab==='all'?financial:tab==='price'?snapshot+' · '+executionDate:snapshot;
 $('alertsDate').textContent=(tab==='all'?financial+' · '+snapshot+' · '+executionDate:tab==='price'?snapshot+' · '+executionDate:snapshot)+(gs.some(g=>cardScope(g,tab).stale||!g.report_verified)?' · 存在过期/未发布数据':'');
}

// In-page navigation only: no changes to data, filters or rendering calculations.
(()=>{
 const guide=$('pageGuide'),disclosure=$('guideDisclosure'),links=$('guideLinks');
 const topbar=document.querySelector('.navigation-bar'),wide=matchMedia('(min-width:1560px)');
 let entries=[],frame=0;
 const offset=()=>topbar.getBoundingClientRect().height+(wide.matches?24:disclosure.querySelector('summary').getBoundingClientRect().height+24);
 function highlight(){
  frame=0;
  const bar=topbar.getBoundingClientRect();
  document.documentElement.style.setProperty('--guide-top',Math.max(bar.height,bar.bottom)+16+'px');
  const line=offset()+24;
  let current=entries[0];
  for(const entry of entries)if($(entry.id).getBoundingClientRect().top<=line)current=entry;
  if(scrollY>0&&innerHeight+scrollY>=document.documentElement.scrollHeight-2)current=entries[entries.length-1];
  for(const a of links.querySelectorAll('a')){
   if(a.hash==='#'+current?.id)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');
  }
  $('guideCurrent').textContent=current?.label||'经营指标概览';
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(highlight);}
 function measure(){
  document.documentElement.style.setProperty('--nav-height',topbar.getBoundingClientRect().height+'px');
  document.documentElement.style.setProperty('--guide-offset',offset()+'px');
  schedule();
 }
 function rebuild(){
  const all=document.querySelector('.navigation-bar button.active')?.dataset.tab==='all';
  const warnings=document.querySelector('.navigation-bar button.active')?.dataset.tab==='warnings';
  entries=warnings?[{id:'warningOverview',label:'01 预警总览'},{id:'warningRisk',label:'02 异常处理清单'},{id:'warningGrowth',label:'03 红榜增长机会'},{id:'warningHistory',label:'04 历史状态变化'},{id:'warningAction',label:'05 人工动作复盘'}]:[{id:'metrics',label:'↑ 经营指标概览'},...(all?[
   {id:'departmentGoals',label:'01 部门经营目标'},
   {id:'personalGoals',label:'02 个人绩效目标'},
   {id:'trendPanel',label:'03 近12周经营趋势'},
   {id:'cardsPanel',label:'04 各负责人经营表现'},
   {id:'alertsPanel',label:'05 经营异常与待介入事项'}
  ]:[{id:'cardsPanel',label:$('cardsTitle').textContent.replace('｜',' ')},{id:'alertsPanel',label:$('alertsTitle').textContent.replace('｜',' ')}])];
  links.innerHTML=entries.map(e=>`<a href="#${e.id}">${esc(e.label)}</a>`).join('');
  guide.hidden=false;disclosure.open=wide.matches;measure();
 }
 links.addEventListener('click',event=>{
  const a=event.target.closest('a');if(!a)return;
  event.preventDefault();
  if(!wide.matches)disclosure.open=false;
  const target=$(a.hash.slice(1));
  target.setAttribute('tabindex','-1');target.focus({preventScroll:true});
  window.scrollTo({top:Math.max(0,scrollY+target.getBoundingClientRect().top-offset()),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  schedule();
 });
 document.querySelectorAll('.navigation-bar button').forEach(b=>b.addEventListener('click',()=>requestAnimationFrame(rebuild)));
 wide.addEventListener('change',()=>{disclosure.open=wide.matches;measure();});
 disclosure.addEventListener('toggle',measure);
 addEventListener('scroll',schedule,{passive:true});addEventListener('resize',measure,{passive:true});
 new ResizeObserver(measure).observe(topbar);
 new ResizeObserver(schedule).observe(document.querySelector('main'));
 requestAnimationFrame(rebuild);
})();
