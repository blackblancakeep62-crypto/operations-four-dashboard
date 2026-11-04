'use strict';
// A separately labelled, fixed-week evidence snapshot; never replaces V4's
// last complete-week opportunity, execution, or financial data.
(function(){
 const rows=window.PARTIAL_PRICING_20261101||[], panel=document.getElementById('partialPricing');
 const names=['李漉','陈梦怡','陈芳志','陈晞'];
 function draw(){
  const period=selectedPeriod();
  const active=document.querySelector('[data-tab="price"]')?.classList.contains('active')&&period?.start<='2026-10-26'&&period?.end>='2026-11-01';
  panel.hidden=!active;if(!active)return;
  const manager=document.getElementById('manager').value, country=document.getElementById('site').value;
  const selected=rows.filter(r=>(manager==='all'||r.owners.includes(manager))&&(country==='all'||r.country===country));
  const n=(r,status)=>r.filter(x=>x.status===status).reduce((sum,x)=>sum+x.count,0);
  const excluded=n(selected,'excluded'),pending=n(selected,'pending');
  const table=names.filter(x=>manager==='all'||manager===x).map(name=>{
   const r=selected.filter(x=>x.owners.includes(name));
   return `<tr><td>${name}</td><td>${n(r,'excluded')}</td><td>${n(r,'pending')}</td><td>0</td></tr>`;
  }).join('');
  panel.innerHTML=`<details><summary>本周部分覆盖（10/26—11/01）：已核验 ${excluded} · 待核验 ${pending} · 已核验A/B机会 0</summary>
   <p>11月3日证据快照，已核验记录均为淘汰/库存退出，排除提价。待核验记录不计入机会及预计利润；此处为已观察国家＋ASIN组合，并非完整SKU总量。808条来源待核，原币周数据仅6/28页。</p>
   <div class="price-table-scroll"><table class="price-effect-table"><thead><tr><th>负责人</th><th>已核验排除</th><th>待核验</th><th>已核验 A/B 机会</th></tr></thead><tbody>${table}</tbody></table></div>
   <p>共管记录在相关负责人行分别显示，汇总按记录去重。下方机会卡片保留上一完整周快照，不代表本周新增机会；实际执行状态仍以各组02表同步为准。</p></details>`;
 }
 for(const id of ['manager','site','period'])document.getElementById(id).addEventListener('change',()=>setTimeout(draw,0));
 document.querySelectorAll('[data-tab]').forEach(x=>x.addEventListener('click',()=>setTimeout(draw,0)));
 draw();
})();
