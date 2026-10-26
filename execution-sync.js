'use strict';
// Overlay execution counts only; keep all ERP financials and pricing theory.
const executionBaseOp=op;
op=function(g){
  const base=executionBaseOp(g), live=window.EXECUTION_DATA?.groups?.[g.manager];
  const patch=$('site').value==='all'?live?.operational:live?.site_operational?.[$('site').value];
  return base&&patch?{...base,...patch}:base;
};
function executionStatus(){
  const state=window.EXECUTION_DATA||{};
  const hostingNote=Array.from($('foot').childNodes).find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent===D.hosting);
  if(hostingNote&&state.automation==='apps_script_daily')hostingNote.textContent='GitHub Pages公开只读快照；经营与目标沿用已有快照，提价执行每日自动同步';
  const box=$('executionSyncStatus');
  box.hidden=document.querySelector('nav button.active')?.dataset.tab!=='price';
  if(box.hidden)return;
  const selected=groups();
  const fmt=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无成功同步';
  const authorization=String(state.automation||'').startsWith('awaiting_')||state.status==='authorization_required';
  const details=selected.map(g=>{const x=state.groups?.[g.manager],late=!authorization&&(!x?.last_success_at||Date.now()-Date.parse(x.last_success_at)>36*60*60000);return g.manager+'：数据截至 '+(x?.data_asof?fmt(x.data_asof):'待同步')+'，最近成功同步 '+fmt(x?.last_success_at)+(x?.status&&x.status!=='ok'?'（同步失败/待授权，保留上次有效值）':late?'（同步超时，保留上次有效值）':'');}).join('；');
  const incomplete=selected.reduce((n,g)=>n+(state.groups?.[g.manager]?.operational?.incomplete_execution_records||0),0);
  box.textContent=(authorization?'执行表每日同步待 Apps Script 授权验证；当前保留上一有效快照。':'执行表每天北京时间10:30左右同步；网页每60秒读取同步结果。')+' '+details+'。'+(incomplete?' 有'+incomplete+'条记录缺实际启动证据，不计入实际测试。':'')+' 理论增量与已验证增量分开；已验证增量仍需对照、证据及FX/广告/促销/断货核验。';
}
function renderExecution(){render();periodNotes();trendAlerts();exitPerformance();executionStatus();}
for(const id of ['manager','site','period'])$(id).addEventListener('change',executionStatus);
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',executionStatus));
renderExecution();
async function refreshExecution(){
  try{
    const response=await fetch('execution.json?t='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw Error('fetch');
    const next=await response.json();
    if(next.schema!=='execution-sync-v1'||!next.groups)throw Error('schema');
    window.EXECUTION_DATA=next;renderExecution();
  }catch{
    executionStatus();
    if(!$('executionSyncStatus').hidden)$('executionSyncStatus').textContent+=' 网页获取同步结果失败，保留上次有效数据。';
  }
}
if(location.protocol==='https:'||location.protocol==='http:'){
  refreshExecution();
  setInterval(refreshExecution,60000);
}
