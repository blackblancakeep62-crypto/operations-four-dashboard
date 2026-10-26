'use strict';
// Independent daily snapshot: weekly diagnostics and pricing never read it.
let G=window.OPERATIONS_TARGETS||null,targetNetworkError=false;
const tg=id=>document.getElementById(id);
const tx=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tn=(v,d=2)=>v==null?'—':Number(v).toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d});
const tp=v=>v==null?'—':tn(v*100,2)+'%';
const tv=(v,m)=>v==null?(m.key==='new_sales_2026'?'待提供新品名单':m.key==='exit_profit'?'口径待确认':m.key==='old_sales'?'待新品/老品划分':'待接入'):m.unit==='ratio'?tp(v):tn(v,m.unit==='待核验'?0:2)+(m.unit==='CNY'?' 元':m.unit==='待核验'?'（单位待核验）':'');
const timeText=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无成功同步';
function targetToday(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;}
function targetExpected(){const d=new Date(targetToday()+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
function goalStale(a,period){if(!a)return true;let end=period.endsWith('Q4')?period.slice(0,4)+'-12-31':new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),0)).toISOString().slice(0,10);return !!a.retained_stale||a.cutoff<(targetExpected()<end?targetExpected():end);}
function goalMetric(m){
 const amount=m.kind==='amount',rate=m.kind==='rate',reference=m.reference_level?(m.basis_pending?'参考档位：':'当前档位：')+m.reference_level:'暂不判档';
 const table=m.targets?`<div class="goal-scroll"><table class="goal-table"><thead><tr><th>档位</th><th>${m.key==='ad_burden'?'成本上限（原目标）':'目标'}</th>${amount?'<th>完成率</th><th>尚差金额</th><th>较时间进度</th>':'<th>实际－目标</th>'}</tr></thead><tbody>${m.targets.map((value,i)=>`<tr><td>${['生存','准','进阶'][i]}</td><td>${m.key==='ad_burden'?tx(tv(m.comparison_thresholds[i],m))+'（原 '+tx(tv(value,m))+'）':tx(tv(value,m))}</td>${amount?`<td>${tp(m.completion?.[i])}<div class="goal-track"><i style="width:${Math.max(0,Math.min(100,(m.completion?.[i]||0)*100))}%"></i></div></td><td>${m.target_gaps?.[i]==null?'—':tn(m.target_gaps[i])}</td><td>${m.time_gaps?.[i]==null?'—':tn(m.time_gaps[i]*100)+'pp'}</td>`:`<td>${rate&&m.threshold_gaps?.[i]!=null?tn(m.threshold_gaps[i]*100)+'pp':'待核验'}</td>`}</tr>`).join('')}</tbody></table></div>`:'<p class="goal-muted">该周期目标待配置，未按比例分摊。</p>';
 const note=m.key==='ad_burden'?'负号目标转成本负担绝对值后比较，越低越好；实际分母为ERP原始销售额。负差距表示低于成本上限。':m.kind==='rate'?'利润率直接比较阈值，不按自然日折算完成率。':amount?'尚差金额为目标－实际；负值表示超过目标。pp为百分点。':'专项指标的单位及考核规则待核验，不推定金额或百分比。';
 return `<article class="goal-metric"><div class="goal-metric-head"><h3>${tx(m.label)}${m.weight!=null?`<span class="goal-weight">权重 ${tp(m.weight)}</span>`:''}</h3><strong>${tx(tv(m.actual,m))}</strong></div>${table}<p class="goal-muted">${tx(reference)}${m.basis_pending?' · 正式口径待核验':''}。${tx(note)}</p></article>`;
}
function renderDepartment(){
 if(!G)return;const period=tg('goalPeriod').value,d=G.departments[period];
 if(!d){tg('departmentGoalBody').innerHTML='<p>目标待配置</p>';return;}
 const a=d.actual,amount=d.metrics.find(m=>m.key==='sales'),progress=amount?.time_progress;
 tg('departmentGoalStatus').textContent=`统计截止：${a?.cutoff||'待接入'} · 覆盖：${a?.coverage||'不足4/4同截止日'}${a?.joint_pending?'（另有'+a.joint_pending+'条多人归属未分摊）':''} · ${!a?'实际数据待接入':goalStale(a,period)?'已过期，保留上一有效快照':a.joint_pending?'单一归属范围完整，多人归属待核验':'数据完整'} · 最近成功同步：${timeText(G.last_successful_sync)}`;
 tg('departmentGoalBody').innerHTML=`<div class="goal-context"><span>${tx(d.note)}</span><strong>统计日进度 ${tp(progress)} · 当前自然日 ${tp(d.calendar_time_progress)}</strong></div><div class="goal-time-track" aria-label="数据对应时间进度"><i style="width:${Math.max(0,Math.min(100,(progress||0)*100))}%"></i></div><div class="goal-grid">${d.metrics.filter(m=>m.targets).map(goalMetric).join('')}</div>${d.metrics.some(m=>!m.targets)?'<p class="goal-muted">月度老品、新品目标待配置；相应实际待接入，未按销售额比例估算。</p>':''}`;
}
function renderPersonal(){
 if(!G)return;const period=tg('personalGoalMonth').value,people=G.personal[period]||{},opened=new Set([...tg('personalGoalBody').querySelectorAll('.personal-goal')].filter(e=>e.querySelector('details')?.open).map(e=>e.dataset.manager));
 tg('personalGoalBody').innerHTML=['李漉','陈梦怡','陈芳志','陈晞'].map(name=>{
  const p=people[name]||{target_status:'待配置',metrics:[]},a=p.actual,report=(window.OPERATIONS_DATA?.groups||[]).find(g=>g.manager===name),nameHtml=report?.report_verified?`<a href="${tx(report.report_url)}" target="_blank" rel="noopener">${tx(name)} ↗</a>`:tx(name),primary=p.metrics.find(m=>m.key==='sales'),summary=primary?`<strong>${tv(primary.actual,primary)}</strong><span>销售额完成率（准） ${tp(primary.completion?.[1])}</span>`:name==='陈晞'?'<strong>专项实际待接入</strong><span>清理及淘汰利润：单位与规则待核验</span>':'<strong>目标待配置</strong>';
  return `<article class="personal-goal" data-manager="${tx(name)}"><div class="goal-person-head"><h3>${nameHtml}</h3><span>${tx(p.target_status)}</span></div><div class="goal-person-summary">${summary}</div><p class="goal-muted">数据截至 ${a?.cutoff||'待接入'} · ${!a?'实际数据待接入':goalStale(a,period)?'过期/本次缺失，保留上一有效值':a.joint_pending?'单一归属金额已接入，多人归属待核验':'经营数据完整'}<br>最后有效更新时间 ${timeText(a?.refreshed_at)}</p><details ${opened.has(name)?'open':''}><summary>展开指标、权重与档位差距</summary>${p.metrics.length?p.metrics.map(m=>{const gap=m.next_gap==null?'—':m.unit==='ratio'?tn(m.next_gap*100)+'个百分点':tv(m.next_gap,m);return `${goalMetric(m)}<p class="goal-muted">距下一档 ${tx(gap)} · 较上月 ${m.previous_change==null?'待可比实际':tx(tv(m.previous_change,m))}${m.previous_actual!=null?` · 上月完成 ${tx(tv(m.previous_actual,m))}`:''}<br>${tx(m.previous_note)}</p>`;}).join(''):'<p class="goal-muted">本月个人目标待配置，未沿用10月目标。</p>'}</details><p class="goal-muted">${p.weight_total!=null?`已提供权重 ${tp(p.weight_total)}；仅展示核心指标，不计算完整绩效得分。`:'尚无该月个人绩效配置。'}</p></article>`;
 }).join('');
}
function renderTargets(){
 const active=document.querySelector('nav button.active')?.dataset.tab==='all';tg('departmentGoals').hidden=!active;tg('personalGoals').hidden=!active;
 if(!active)return;
 if(!G){tg('goalSyncStatus').textContent='每日目标快照尚未接入；现有经营诊断保持独立。';return;}
 const fail=G.last_attempt?.status==='failed'||G.last_attempt?.status==='partial';
 tg('goalSyncStatus').textContent=(targetNetworkError?'网页同步读取失败，保留上一有效展示。 ':fail?'最近同步异常，缺失负责人保留旧值，跨截止日不合计。 ':'')+G.basis_note+` 另有${G.validation_warnings.length}项目标加总差异，详见下方校验。`;
 tg('goalWarnings').innerHTML=G.validation_warnings.map(w=>`<li>${tx(({sales:'销售额月度合计',net_profit:'净利润月度合计',old_plus_new_sales:'Q4老品＋新品合计'})[w.metric])}（${tx(w.tier)}）：${tn(w.monthly_sum,0)}；Q4原目标 ${tn(w.q4_target,0)}；差异 ${tn(w.difference,0)} 元。保留原目标。</li>`).join('');
 renderDepartment();renderPersonal();
}
tg('goalPeriod').value=['2026-10','2026-11','2026-12'].includes(targetToday().slice(0,7))?targetToday().slice(0,7):'2026-Q4';
tg('personalGoalMonth').value=['2026-10','2026-11','2026-12'].includes(targetToday().slice(0,7))?targetToday().slice(0,7):'2026-10';
tg('goalPeriod').addEventListener('change',renderDepartment);tg('personalGoalMonth').addEventListener('change',renderPersonal);
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',renderTargets));renderTargets();
async function refreshTargets(){try{const r=await fetch('targets.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('target snapshot unavailable');const next=await r.json();if(next.schema_version!==1||!next.departments||!next.personal)throw Error('invalid target snapshot');G=next;targetNetworkError=false;}catch{targetNetworkError=true;}renderTargets();}
if(location.protocol.startsWith('http')){refreshTargets();setInterval(refreshTargets,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshTargets();});}
