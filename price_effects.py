"""Execution facts and two-week comparison rules; no ERP or Drive clients."""
from collections import defaultdict
from datetime import date, timedelta
import math
from sync_execution import day, numeric, started, ACTIVE

def monday(d): return d-timedelta(days=d.weekday())

def execution_batches(inputs,today):
    parents=defaultdict(dict)
    for manager,data in inputs.items():
        queue=data.get('queue',[]);snapshot=day(data.get('asof'))
        for r in data.get('rows',[]):
            if r[12] not in ACTIVE|{'已完成','已回退','完成','回退'}:continue
            if not started(r,today) or not (numeric(r[6]) and numeric(r[8]) and r[8]>r[6]):continue
            site,parent,child=str(r[1]),str(r[2]),str(r[3]);start=day(r[10]);week=monday(start)
            key=(site,parent,week.isoformat());identity=(child,start.isoformat(),r[6],r[8])
            p=parents[key].setdefault(identity,{'child':child,'start':start.isoformat(),
              'original_price':r[6],'actual_price':r[8],'currency':r[9],
              'end':str(day(r[11])) if day(r[11]) else None,'state':r[12],'comparability_confirmed':r[16]=='是',
              'interference_confirmed':r[23]=='通过','updated':str(day(r[22])) if day(r[22]) else None,
              'owners':set(),'ownership_unconfirmed':False,'forecast_profit':None})
            owner_proved=bool(snapshot and any(len(q)>=5 and q[1:5]==r[1:5] for q in queue))
            if owner_proved:p['owners'].add(manager)
            else:p['ownership_unconfirmed']=True
            p['comparability_confirmed'] = p['comparability_confirmed'] and r[16]=='是'
            p['interference_confirmed'] = p['interference_confirmed'] and r[23]=='通过'
            if p['state']!=r[12] or p['end']!=(str(day(r[11])) if day(r[11]) else None):
                p['state']='状态冲突待核验';p['interference_confirmed']=False
            candidates=[q for q in queue if len(q)>=31 and q[1]==r[1] and q[3]==r[3] and q[4]==r[4] and str(q[26])==str(r[5])]
            if snapshot and snapshot<start and r[5] not in (None,'') and len(candidates)==1:
                q=candidates[0]
                if numeric(q[10]) and q[6]==r[6] and q[7]==r[8]:p['forecast_profit']=q[10]*.85
    batches=[]
    for (site,parent,week),children in parents.items():
        children=list(children.values())
        for c in children:c['owners']=sorted(c['owners'])
        children.sort(key=lambda x:(x['child'],x['start'],x['actual_price']))
        owners=sorted({x for c in children for x in c['owners']})
        forecasts=[c['forecast_profit'] for c in children]
        batches.append({'site':site,'parent':parent,'batch_week':week,'owners':owners,'children':children,
          'ownership_unconfirmed':any(c['ownership_unconfirmed'] for c in children),
          'forecast_profit':sum(forecasts) if all(numeric(x) for x in forecasts) else None})
    return sorted(batches,key=lambda x:(x['site'],x['parent'],x['batch_week']))

def signature(batch):
    return [[c['child'],c['start'],c['original_price'],c['actual_price']] for c in batch['children']]

def compare(batch,weekly,asof,other_batches=()):
    start=date.fromisoformat(batch['batch_week']);base=[start-timedelta(days=14),start-timedelta(days=7)]
    obs=[start+timedelta(days=7),start+timedelta(days=14)];end=start+timedelta(days=20)
    out={'base_start':str(base[0]),'base_end':str(start-timedelta(days=1)),
         'observation_start':str(obs[0]),'observation_end':str(end),
         'transition_start':str(start),'transition_end':str(start+timedelta(days=6)),
         'status':'待观察','reason':'观察期未完成','before':None,'after':None,'profit_delta':None,
         'sales_delta':None,'units_change':None,'signature':signature(batch)}
    if len({c['child'] for c in batch['children']})!=len(batch['children']):
        out.update(status='待核验',reason='同一子ASIN在批次中存在多次或不同实际售价');return out
    if batch.get('ownership_unconfirmed'):
        out.update(status='待核验',reason='负责人归属未与已核验候选来源匹配');return out
    if any(b is not batch and b['site']==batch['site'] and b['parent']==batch['parent'] and
           base[0]<=date.fromisoformat(b['batch_week'])<=end for b in other_batches):
        out.update(status='待核验',reason='多个提价批次在比较窗口内相互干扰');return out
    if end>asof:return out
    if any(c['end'] and date.fromisoformat(c['end'])<end for c in batch['children']):
        out.update(status='待核验',reason='测试在观察期内结束或回退');return out
    periods=[]
    for week in base+obs:
        v=weekly.get(week.isoformat())
        if not v or not v.get('complete'):
            out.update(status='待观察',reason='缺完整自然周的全父单经营数据');return out
        if v.get('unresolved'):
            out.update(status='待核验',reason='账号/父ASIN归属或子体范围待核验');return out
        if not all(numeric(v.get(k)) for k in ('sales','profit','units')):
            out.update(status='待核验',reason='周度销售、净利润或销量缺失');return out
        periods.append(v)
    def total(pair):
        sales=sum(x['sales'] for x in pair)*.9;profit=sum(x['profit'] for x in pair)*.85;units=sum(x['units'] for x in pair)
        return {'sales':sales,'profit':profit,'units':units,'asp':sales/units if units else None,'margin':profit/sales if sales else None}
    before,after=total(periods[:2]),total(periods[2:]);out.update(before=before,after=after,
      profit_delta=after['profit']-before['profit'],sales_delta=after['sales']-before['sales'],
      units_change=(after['units']-before['units'])/before['units'] if before['units'] else None)
    if any(not c['comparability_confirmed'] or not c['interference_confirmed'] for c in batch['children']):
        out.update(status='待核验',reason='需确认对照及汇率、广告、促销、断货干扰');return out
    if before['asp'] is None or after['asp'] is None or before['margin'] is None or after['margin'] is None:
        out.update(status='待核验',reason='销量或销售额为零，无法计算可比均价或利润率');return out
    if out['profit_delta']>0:
        if after['asp']<before['asp']:out.update(status='需关注',reason='净利润增长但ASP下降，提价贡献待核验')
        elif after['margin']<before['margin']:out.update(status='需关注',reason='净利润增长但利润率下降')
        elif after['asp']>before['asp'] and after['margin']>before['margin']:out.update(status='有效候选',reason='净利润、ASP和利润率均增长；仍需核验因果')
        else:out.update(status='需关注',reason='净利润增长，ASP或利润率改善不足')
    else:out.update(status='无效',reason='父单净利润未增长')
    return out
