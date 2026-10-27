'use strict';
// Source results only; no source rule evaluation and no source writes.
(()=>{
 let data=window.SNAPSHOT_GUARD.restore('alerts',window.ALERTS_DATA||null),networkError=false,lastRender='';
 const el=id=>document.getElementById(id),h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const time=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无成功同步';
 const get=(row,key)=>row[key]??'—';
 function filtered(rows,ownerKey='owner'){
  const country=el('site').value;
  return rows.filter(r=>(el('manager').value==='all'||r[ownerKey]===el('manager').value)&&(country==='all'||window.OPERATING_COUNTRIES.parse(r.country)?.country===country));
 }
 function source(s){return `<a href="https://docs.google.com/spreadsheets/d/${h(data.source_id)}/edit#gid=${s.gid}&range=A${s.row}" target="_blank" rel="noopener">原表第 ${s.row} 行 ↗</a>`;}
 const pills=labels=>labels.map(l=>`<span class="pill">${h(l)}</span>`).join('');
 function dates(){return `经营数据截至 ${data.business_cutoff} · 预警状态快照 ${data.status_snapshot_date} · 最新人工动作 ${data.latest_action_date||'无记录'} · 最后成功同步 ${time(data.last_success_at)}`;}
 function owner(p){return `${h(p.owner||'归属待核验')}${p.owner_status==='supplemented'?'<small>原榜空值，按历史及周源一致结果补充</small>':p.owner_status==='conflict'?`<small>原表归属冲突：${h(p.owner_candidates.join(' / '))}</small>`:''}`;}
 function table(headers,rows){return rows.length?`<div class="warning-scroll"><table class="warning-table"><thead><tr>${headers.map(x=>`<th>${h(x)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:'<p class="subtle">所选负责人、国家下无对应记录。</p>';}
 function details(entries){return `<details class="warning-evidence"><summary>展开详细依据与原表</summary>${entries.map(e=>`<div class="warning-evidence-item"><strong>${h(e.board)} · ${h(e.subtype)}</strong><p>原榜负责人：${h(e.source_owner||'空值')} ${e.first_check?' · 第一检查项：'+h(e.first_check):''}${e.response_time?' · 原表处理时效：'+h(e.response_time):''}</p><dl>${Object.entries(e.trends).map(([k,v])=>`<div><dt>${h(k)}</dt><dd>${h(v||'—')}</dd></div>`).join('')}</dl>${source(e.source)}</div>`).join('')}</details>`;}
 function list(parents,kind){
  const rows=parents.map(p=>{const es=data.entries.filter(e=>e.parent===p.parent&&e.kind===kind);if(!es.length)return '';
   return `<tr><td>${pills(es.map(e=>e.subtype))}${pills(p.labels)}</td><td>${owner(p)}</td><td class="warning-parent">${h(p.parent)}<small>${h(p.country||'国家待核验')}</small></td><td>${es.map(e=>`<p>${h(e.core_problem||'—')}</p>`).join('')}</td><td>${es.map(e=>`<p>${h(e.suggested_action||'原表未单列建议动作')}</p>`).join('')}${details(es)}</td><td>${h(p.status||'原表未覆盖')}<small>需跟进：${h(p.needs_followup||'未知')} · 完成：${p.completed===null?'未登记':p.completed?'已勾选':'未勾选'}</small></td></tr>`;
  }).filter(Boolean);
  return table(['风险／增长类型','负责人','父单','核心问题／运营重点','建议动作与依据','原表状态'],rows);
 }
 window.renderAlerts=function(){
  const active=document.querySelector('nav button.active')?.dataset.tab==='warnings';
  el('warningPage').hidden=!active;
  const summary=el('warningSummary');summary.hidden=document.querySelector('nav button.active')?.dataset.tab!=='all';
  if(!data){summary.textContent='预警尚无有效快照';if(active){el('freshness').textContent='预警尚无有效快照';el('periodCoverage').textContent='该周期暂无完整数据 · 预警实际统计截止：待同步。';}return;}
  const parents=filtered(data.parents),risk=parents.filter(p=>data.entries.some(e=>e.parent===p.parent&&e.kind==='risk')),growth=parents.filter(p=>data.entries.some(e=>e.parent===p.parent&&e.kind==='growth'));
  const late=Date.now()>Date.parse(data.next_sync_due),failed=networkError||data.status!=='ok';
  const signature=[document.querySelector('nav button.active')?.dataset.tab,el('manager').value,el('site').value,el('period').value,el('warningActionLimit').value,data.checked_at,late,failed].join('|');
  if(signature===lastRender)return;lastRender=signature;
  const status=failed?'同步失败，保留上次有效数据（已过期／待更新）':late?'快照已过期，保留上次有效数据':'首次真实数据已核验';
  summary.innerHTML=`<strong>运营预警：${parents.length} 个父单</strong> · 异常 ${risk.length} · 红榜 ${growth.length} · ${h(status)} <button type="button" id="openWarnings">查看运营预警 →</button><small>${h(dates())}</small>`;
  el('openWarnings').onclick=()=>document.querySelector('nav button[data-tab="warnings"]').click();
  if(!active)return;
  const country=el('site').value;el('countryCoverage').hidden=country==='all';el('countryCoverage').textContent=parents.length?'所选国家匹配 '+parents.length+' 个去重预警父单；保留原表统计含义。':'所选国家及负责人暂无对应预警数据；不回退全部国家。';
  el('freshness').textContent=dates();
  el('notice').textContent='按原表已计算结果展示；当前预警快照独立于经营周期筛选。原表记录由运营维护，网页只读。';
  const selected=window.OPERATING_PERIODS.parse(el('period').value);
  el('periodCoverage').textContent='所选周期 '+(selected?selected.start+' — '+(selected.end||'暂无完整自然日'):'待选择')+'。该周期暂无完整数据：运营预警为状态快照，不支持按所选周/月回溯；以下榜单、历史状态及人工动作保留原有统计含义。实际统计截止：'+dates()+'。';
  el('warningSync').textContent=status+'。'+(data.automation==='awaiting_native_reader'?'当前为一次真实读取快照；每周自动同步待原生 Sheets 读取器授权接入。':'每周读取原表已计算结果。')+(data.warnings?.length?` 原表 ${data.warnings.length} 条历史记录存在公式错误，详见历史状态。`:'');
  document.querySelectorAll('.warning-meta').forEach(n=>n.textContent=dates());
  el('warningOverviewBody').innerHTML=`<div class="metrics">${[['去重预警父单',parents.length],['异常父单',risk.length],['红榜父单',growth.length],['归属待核验',parents.filter(p=>!p.owner).length],['需跟进（源表）',parents.filter(p=>p.needs_followup==='是').length],['已勾选完成',parents.filter(p=>p.completed===true).length]].map(([k,v])=>`<div class="metric"><h3>${h(k)}</h3><div class="value">${v}</div></div>`).join('')}</div><p>${['成长榜','效率榜','潜力榜','黑榜','广告烧钱无效榜','利润透支榜','广告依赖榜'].map(b=>pills([b+' '+parents.filter(p=>p.labels.includes(b)).length])).join('')}</p><p class="subtle">同一父单全部标签保留，总数按“国家&父单”去重；各榜数量可能重叠。完成勾选不代表收益已验证。归属冲突记录保留在全部负责人范围。</p>`;
  el('warningRiskBody').innerHTML=list(risk,'risk');el('warningGrowthBody').innerHTML=list(growth,'growth');
  const histories=filtered(data.history,'recorded_owner');
  el('warningHistoryBody').innerHTML=`<p class="subtle">“连续在榜天数”原表实际保存日期快照，以下按原始记录展示，不换算自然日。负责人为该表原记录，可能与当前周源不同；状态不重算。</p>`+table(['父单／原记录负责人','原表状态','跟进／完成','日期快照与当前计算值'],histories.map(r=>`<tr><td>${h(r.parent)}<small>${h(r.recorded_owner||'未填写')}</small></td><td>${h(r.status||'未知')}</td><td>${h(r.needs_followup||'未知')} / ${r.completed===null?'未登记':r.completed?'已勾选':'未勾选'}</td><td><details><summary>展开历史日期与榜单</summary>${r.snapshots.map(s=>`<p>${h(s.date)}：${h(s.board??'缺失')}</p>`).join('')}<p>当前公式计算值（单榜）：${h(r.computed_board||'未知')}</p>${source(r.source)}</details></td></tr>`));
  if(data.warnings?.length)el('warningHistoryBody').insertAdjacentHTML('afterbegin',`<p class="goal-callout">${data.warnings.map(w=>h(w.sheet+' 第'+w.row+'行：'+w.message)).join('；')}</p>`);
  const actions=filtered(data.actions,'recorded_owner').slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')||b.source.row-a.source.row);
  const displayed=el('warningActionLimit')?.value==='all'?actions:actions.slice(0,40);
  el('warningActionBody').innerHTML=`<p class="subtle">共 ${actions.length} 条匹配记录，显示 ${displayed.length} 条。按动作记录负责人筛选；“最新状态”是原表当前查回状态，不是动作发生时状态或动作效果。</p>`+table(['动作日期','记录负责人','父单','问题','人工动作','当前查回状态／备注'],displayed.map(r=>`<tr><td>${h(r.date||'未填写')}</td><td>${h(r.recorded_owner||'未填写')}</td><td>${h(r.parent)}</td><td>${h(r.issue)}</td><td>${h(r.action)}</td><td>${h(r.current_status||'未知')}<details><summary>备注与原表</summary><p>${h(r.note||'未填写')}</p>${source(r.source)}</details></td></tr>`));
 };
 el('warningActionLimit').addEventListener('change',window.renderAlerts);
 window.renderAlerts();
 if(location.hash==='#operations-alerts')document.querySelector('nav button[data-tab="warnings"]').click();
 async function refresh(){
  try{const response=await fetch('alerts.json?t='+Date.now(),{cache:'no-store'});if(!response.ok)throw Error('fetch');data=window.SNAPSHOT_GUARD.accept('alerts',await response.json());networkError=false;}
  catch{networkError=true;}
  window.renderAlerts();
 }
 if(location.protocol.startsWith('http')){refresh();setInterval(refresh,60000);}
})();
