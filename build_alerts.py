"""Normalize already-calculated Google values only. Never evaluate source formulas.

Input is a private connector/reader result with source_id, read_at and named sheets.
Only the two alerts snapshots may be replaced; no ERP or source-sheet writes.
"""
import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path

SOURCE_ID = '1uDJEviG8276yK-5tZzrUxPxvIyKi1UdowMvPc1bpBM4'
SHEET_IDS = {'红榜':692394474,'黑榜':380856319,'广告风险榜':973656780,
             '连续在榜天数':241523783,'运营动作':1967088291}
TREND_NAMES = ['销量','订单CVR','小类排名','Sessions','销售额','销售净毛利','广告花费','CTR','ACOS']

def cell(row, col):
    return row[col] if col < len(row) and row[col] is not None else ''

def date_text(value):
    return datetime.strptime(str(value).split('~')[0], '%Y-%m-%d').date().isoformat()

def source_ref(sheet, row):
    return {'sheet':sheet,'gid':SHEET_IDS[sheet],'row':row}

def normalize(raw):
    if raw['source_id'] != SOURCE_ID:
        raise ValueError('unexpected_source')
    stamp = datetime.fromisoformat(raw['read_at'].replace('Z','+00:00'))
    sheets = {k:v['values'] for k,v in raw['sheets'].items()}
    warnings=[]
    for name in ['红榜','黑榜','广告风险榜','连续在榜天数','运营动作','周数据源','扉页-说明']:
        if not sheets.get(name): raise ValueError('missing_sheet:'+name)
        for number,row in enumerate(sheets[name],1):
            if any(str(v).startswith(('#REF!','#VALUE!','#N/A','#ERROR!','#DIV/0!','#NAME?','#NUM!')) for v in row if v):
                if name not in ('连续在榜天数','运营动作'):raise ValueError('source_error:'+name)
                warnings.append({'sheet':name,'row':number,'message':'原表字段存在公式错误，保留原值，不能认定归属或状态'})
    for name,index,col,label in [('红榜',2,4,'父单名'),('黑榜',2,6,'父单名'),
                                 ('广告风险榜',2,2,'父单名'),('连续在榜天数',1,0,'国家&父单'),
                                 ('运营动作',1,0,'日期'),('周数据源',0,1,'国家&父单')]:
        if cell(sheets[name][index],col)!=label:raise ValueError('header_changed:'+name)
    weekly = [r for r in sheets['周数据源'][2:] if cell(r,1) and cell(r,2)]
    latest = max(int(cell(r,0)) for r in weekly)
    periods = sorted({cell(r,2) for r in weekly if int(cell(r,0))==latest})
    if len(periods)!=1 or '~' not in periods[0]:raise ValueError('ambiguous_week')
    cutoff = date_text(periods[0].split('~')[1])
    identities = {}
    for row in weekly:
        key=cell(row,1)
        info=identities.setdefault(key,{'countries':set(),'latest_owners':set()})
        info['countries'].add(cell(row,9))
        if int(cell(row,0))==latest and cell(row,19) not in ('','-'):
            info['latest_owners'].add(cell(row,19))
    history = []
    headers=sheets['连续在榜天数'][1]
    date_cols=[(i,date_text(v)) for i,v in enumerate(headers) if i>=5 and v and str(v)[0:4].isdigit()]
    if not date_cols:raise ValueError('missing_status_dates')
    for n,row in enumerate(sheets['连续在榜天数'][2:],3):
        if not cell(row,0):continue
        history.append({'parent':cell(row,0),'recorded_owner':cell(row,1),'status':cell(row,2),
                        'needs_followup':cell(row,3),'completed':True if str(cell(row,4)).upper()=='TRUE' else False if str(cell(row,4)).upper()=='FALSE' else None,
                        'snapshots':[{'date':d,'board':cell(row,c) or None} for c,d in date_cols],
                        'computed_board':cell(row,13),'source':source_ref('连续在榜天数',n)})
    hist = {r['parent']:r for r in history}
    entries=[]
    # (sheet, board, parent, owner, trend-start, subtype, focus, action)
    blocks=[('红榜','成长榜',4,1,5,2,3,None),('红榜','效率榜',19,15,20,16,17,18),
            ('红榜','潜力榜',34,30,35,31,32,33),('黑榜','黑榜',6,1,7,2,3,5),
            ('广告风险榜','广告烧钱无效榜',2,1,3,None,None,None),
            ('广告风险榜','利润透支榜',14,13,15,None,None,None),
            ('广告风险榜','广告依赖榜',26,25,27,None,None,None)]
    for name,board,p,o,t,sub,focus,action in blocks:
        for n,row in enumerate(sheets[name][3:],4):
            key=cell(row,p)
            if not key or key.startswith(('暂无','无符合')):continue
            if key not in identities:raise ValueError('unmapped_parent:'+key)
            entry={'parent':key,'board':board,'kind':'growth' if name=='红榜' else 'risk',
                   'source_owner':cell(row,o),'subtype':cell(row,sub) if sub is not None else board,
                   'core_problem':cell(row,focus) if focus is not None else board,
                   'first_check':cell(row,4) if name=='黑榜' else '',
                   'suggested_action':cell(row,action) if action is not None else '',
                   'trends':dict(zip(TREND_NAMES,[cell(row,i) for i in range(t,t+9)])),
                   'source':source_ref(name,n)}
            if name=='广告风险榜':entry['suggested_action']=cell(sheets[name][1],t+6).replace('运营动作：','').strip()
            if name=='黑榜':
                timing=next((cell(r,4) for r in sheets['扉页-说明'] if cell(r,0)==entry['subtype']),'')
                entry['response_time']=timing
            entries.append(entry)
    parents=[]
    for key in dict.fromkeys(e['parent'] for e in entries):
        es=[e for e in entries if e['parent']==key]
        info=identities[key];h=hist.get(key)
        source_owners={e['source_owner'] for e in es if e['source_owner']}
        possible=source_owners|info['latest_owners']|({h['recorded_owner']} if h and h['recorded_owner'] else set())
        owner=next(iter(possible)) if len(possible)==1 else None
        country=next(iter(info['countries'])) if len(info['countries'])==1 else None
        parents.append({'parent':key,'owner':owner,'owner_status':'conflict' if len(possible)>1 else 'supplemented' if owner and not source_owners else 'source' if owner else 'missing',
                        'owner_candidates':sorted(possible),'country':country,
                        'labels':list(dict.fromkeys(e['board'] for e in es)),
                        'status':h['status'] if h else None,'needs_followup':h['needs_followup'] if h else None,
                        'completed':h['completed'] if h else None})
    actions=[]
    for n,row in enumerate(sheets['运营动作'][2:],3):
        if not any(cell(row,c) for c in [0,2,5]):continue
        key=cell(row,2);countries=identities.get(key,{}).get('countries',set())
        actions.append({'date':date_text(cell(row,0)) if cell(row,0) else None,'recorded_owner':cell(row,1),
                        'parent':key,'country':next(iter(countries)) if len(countries)==1 else None,
                        'current_status':cell(row,3),'issue':cell(row,4),'action':cell(row,5),'note':cell(row,6),
                        'source':source_ref('运营动作',n)})
    for row in history:
        countries=identities.get(row['parent'],{}).get('countries',set())
        row['country']=next(iter(countries)) if len(countries)==1 else None
    counts={b:len({e['parent'] for e in entries if e['board']==b}) for _,b,*_ in blocks}
    return {'schema':'alerts-v1','source_id':SOURCE_ID,'data_asof':cutoff+'T23:59:59+08:00',
            'business_cutoff':cutoff,'status_snapshot_date':max(d for _,d in date_cols),
            'latest_action_date':max((a['date'] for a in actions if a['date']),default=None),
            'last_success_at':stamp.isoformat(),'checked_at':stamp.isoformat(),'status':'ok',
            'sync_mode':'manual_verified_connector','automation':'awaiting_native_reader',
            'next_sync_due':(stamp+timedelta(days=7)).isoformat(),
            'warnings':warnings,'counts':counts,'parents':parents,'entries':entries,'history':history,'actions':actions}

def write_pair(data, output):
    output=Path(output)
    raw=json.dumps(data,ensure_ascii=False,separators=(',',':'))
    (output/'alerts.json').write_text(raw+'\n',encoding='utf-8')
    (output/'alerts-data.js').write_text('window.ALERTS_DATA='+raw+';\n',encoding='utf-8')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('input',type=Path);parser.add_argument('--output',type=Path,default=Path('.'))
    args=parser.parse_args();data=normalize(json.loads(args.input.read_text(encoding='utf-8')))
    from publication_guard import assert_no_regression
    previous=args.output/'alerts.json'
    if previous.exists():assert_no_regression('alerts',data,json.loads(previous.read_text(encoding='utf-8')))
    write_pair(data,args.output)
    print(json.dumps({'unique_parents':len(data['parents']),'counts':data['counts'],'actions':len(data['actions'])},ensure_ascii=False))
