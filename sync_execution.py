"""Read-only Drive execution adapter. No ERP clients and no spreadsheet writes.

Only this module's execution.json / execution-data.js outputs are published.
Source workbooks and credentials stay in memory or private runner temp storage.
The accepted V4 start, completion, readiness and comparable-profit gates remain.
"""
import argparse
import base64
import copy
import hashlib
import io
import json
import math
import os
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

TZ = timezone(timedelta(hours=8))
ACTIVE = {'测试中', '观察中', '已启动', '暂停', '暂停复核'}
TERMINAL = {'已完成', '已回退', '已取消', '完成', '回退', '取消'}
HEADERS = ['测试ID','站点','父ASIN','子ASIN','执行MSKU','来源候选ID','原价原币','建议价原币','实际测试价原币','币种','实际开始日期','实际结束日期','测试状态','观察结果','父单基期净毛利CNY','父单测试期净毛利CNY','可比对照确认','父单净毛利变化CNY','最终保留或回退结论','执行证据链接','负责人','登记来源','记录更新日','FX广告促销断货核验']
XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


def day(v):
    if isinstance(v, datetime): return v.date()
    if isinstance(v, date): return v
    if isinstance(v, str):
        try: return date.fromisoformat(v.strip()[:10].replace('/', '-'))
        except ValueError: return None
    return None


def numeric(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def occupied(r, today):
    # Accepted V4 occupancy: incomplete registrations may block another task,
    # but do not count as an actual test or achieved result.
    return bool(r[1] and (r[3] or r[4])) and (r[12] in ACTIVE or (
        day(r[10]) is not None and day(r[10]) <= today and r[12] not in TERMINAL))


def started(r, today):
    return bool(all(r[i] not in (None, '') for i in (0,1,2,3,4,6,8,10,19))
                and numeric(r[6]) and numeric(r[8]) and day(r[10])
                and day(r[10]) <= today)


def completed(r, today):
    return bool(started(r, today) and r[12] in {'已完成','已回退','完成','回退'}
                and day(r[11]) and day(r[10]) <= day(r[11]) <= today
                and r[18] in {'保留','回退'})


def verified(r, today):
    return bool(completed(r, today) and r[16] == '是' and r[23] == '通过'
                and numeric(r[14]) and numeric(r[15]))


def ready_state(r, queue, ledger, asof, today):
    # Same sequence as accepted slim_v4.model_status; no new eligibility model.
    if any(occupied(e,today) and e[1] == r[1] and
           (e[3] == r[3] or e[4] == r[4]) for e in ledger): return '已在测试（不新建）'
    if r[12] != '符合': return '待补关键数据'
    def checks(x):
        return (all(v == '通过' for v in x[15:21]) and x[21]
                and day(x[22]) and asof <= day(x[22]) <= today and x[23]
                and numeric(x[29]) and x[29] == x[6])
    if not checks(r): return '待核验'
    if any(occupied(e,today) and e[1:3] == r[1:3] for e in ledger): return '等待同父测试结束'
    start,end = day(r[24]),day(r[25])
    sunday = asof - timedelta(days=asof.weekday()) + timedelta(days=6)
    if not start or not end or start < today or start > sunday or end < start: return '待排期'
    for x in queue:
        if x is r or x[1:3] != r[1:3] or not checks(x): continue
        a,b = day(x[24]),day(x[25])
        if a and b and a <= end and b >= start: return '排期冲突，需错峰'
    return '待提价'


def dedupe(rows):
    out,seen,ids = [],set(),{}
    for row in rows:
        r = (list(row) + [None] * 26)[:26]
        # Calculated R/Y/Z cells alone are not operator records.
        if not any(r[i] not in (None,'') for i in list(range(17))+list(range(18,24))): continue
        fingerprint = json.dumps(r[:17]+r[18:24],default=str,ensure_ascii=False)
        if fingerprint in seen: continue
        seen.add(fingerprint)
        if r[0]:
            key = str(r[0])
            if key in ids: raise ValueError('conflicting_test_id')
            ids[key] = fingerprint
        out.append(r)
    return out


def read_workbook(data, config):
    from openpyxl import load_workbook
    w = load_workbook(io.BytesIO(data),read_only=True,data_only=True)
    try:
        ex,q = w[config['sheet']],w[config['queue_sheet']]
        if [ex.cell(7,i+1).value for i in range(24)] != HEADERS: raise ValueError('execution_schema_changed')
        extra = 1 if q.cell(7,4).value == '父单名' else 0
        if [q.cell(7,i+(extra if i>=4 else 0)).value for i in (2,3,4,5,13,30)] != ['站点','父ASIN','子ASIN','执行MSKU','候选资格','已核现价原币']: raise ValueError('queue_schema_changed')
        rows = dedupe(ex.iter_rows(min_row=8,max_col=26,values_only=True))
        queue = []
        for row in q.iter_rows(min_row=8,max_col=31+extra,values_only=True):
            r = list(row)
            if extra: del r[3]
            if r[1] and (r[3] or r[4]): queue.append(r)
        asof = day(q.cell(3,2).value)
        if not asof: raise ValueError('queue_refresh_date_missing')
        return {'rows':rows,'queue':queue,'asof':str(asof)}
    finally: w.close()


def summaries(inputs, today):
    allrows = [r for data in inputs.values() for r in data['rows']]
    comparable = [r for r in allrows if verified(r,today)]
    # Same parent-period is not attributed separately to multiple child tests,
    # including across managers. Exact duplicate execution events are excluded.
    def safe(r):
        return not any(x is not r and x[1:3] == r[1:3]
                       and day(x[10]) <= day(r[11]) and day(x[11]) >= day(r[10]) for x in comparable)
    result = {}
    for manager,data in inputs.items():
        def one(site=None):
            rows = [r for r in data['rows'] if site is None or r[1] == site]
            queue = [r for r in data['queue'] if site is None or r[1] == site]
            starts = [r for r in rows if started(r,today)]
            complete = [r for r in rows if completed(r,today)]
            proofs = [r for r in rows if verified(r,today)]
            safe_proofs = [r for r in proofs if safe(r)]
            states = Counter(ready_state(r,data['queue'],allrows,day(data['asof']),today) for r in queue)
            return {'execution_states':dict(states),'ready_count':states['待提价'],
                    'pending_verification':states['待核验'],
                    'active_count':sum(occupied(r,today) for r in starts),
                    'registered_occupancy_count':sum(occupied(r,today) for r in rows),
                    'actual_started_count':len(starts),'completed_count':len(complete),
                    'success_rate':sum(r[18]=='保留' for r in complete)/len(complete) if complete else None,
                    'verified_increment_cny':sum(r[15]-r[14] for r in safe_proofs) if safe_proofs else None,
                    'verified_increment_excluded_overlaps':len(proofs)-len(safe_proofs),
                    'incomplete_execution_records':sum(not started(r,today) for r in rows),
                    'registered_record_count':len(rows),
                    'overdue_review':sum(occupied(r,today) and day(r[11]) is not None and day(r[11])<today for r in rows),
                    'overdue_execution':sum(r[12]=='符合' and day(r[24]) is not None and day(r[24])<today
                        and ready_state(r,data['queue'],allrows,day(data['asof']),today)!='已在测试（不新建）' for r in queue)}
        sites = sorted({r[1] for r in data['rows']+data['queue'] if r[1]})
        result[manager] = {'operational':one(),'site_operational':{s:one(s) for s in sites}}
    return result


class DriveReader:
    def __init__(self):
        import google.auth.transport.requests
        from google.oauth2 import service_account
        from google.oauth2.credentials import Credentials
        sa,oauth = os.getenv('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON'),os.getenv('GOOGLE_DRIVE_OAUTH_JSON')
        scopes=['https://www.googleapis.com/auth/drive.readonly']
        if sa: credentials=service_account.Credentials.from_service_account_info(json.loads(sa),scopes=scopes)
        elif oauth: credentials=Credentials.from_authorized_user_info(json.loads(oauth),scopes=scopes)
        else: raise ValueError('google_read_credentials_missing')
        self.session=google.auth.transport.requests.AuthorizedSession(credentials)

    def metadata(self, file_id):
        r=self.session.get('https://www.googleapis.com/drive/v3/files/'+file_id,
                           params={'fields':'id,mimeType,modifiedTime,version,size','supportsAllDrives':'true'},timeout=40)
        if not r.ok: raise ValueError('drive_metadata_http_'+str(r.status_code))
        return r.json()

    def download(self,file_id):
        r=self.session.get('https://www.googleapis.com/drive/v3/files/'+file_id,
                           params={'alt':'media','supportsAllDrives':'true'},timeout=60)
        if not r.ok: raise ValueError('drive_download_http_'+str(r.status_code))
        return r.content


def run(root, offline_dir=None, offline_meta=None, now=None):
    now = now or datetime.now(TZ)
    config = json.loads((root/'execution_sources.json').read_text(encoding='utf8'))
    path=root/'execution.json'
    previous=json.loads(path.read_text(encoding='utf8')) if path.exists() else {'groups':{}}
    state=copy.deepcopy(previous)
    state.update(schema='execution-sync-v1',checked_at=now.isoformat(),interval_minutes=1440,
                 automation='awaiting_appscript_authorization' if offline_dir else 'github_actions',
                 basis='V4 actual-start / completion / comparable-parent gates; theoretical profit unchanged')
    state.setdefault('groups',{})
    cachepath=root/('.execution-cache.json' if offline_dir else '.execution-cache.enc')
    cache={}
    if cachepath.exists():
        try:
            cached=cachepath.read_bytes()
            if not offline_dir:
                from cryptography.hazmat.primitives.ciphers.aead import AESGCM
                cached=AESGCM(cache_key()).decrypt(cached[:12],cached[12:],b'execution-cache-v1')
            cache=json.loads(cached)
        except Exception: pass  # Credential rotation / expired cache -> safe fresh reads.
    reader=None
    if not offline_dir:
        try: reader=DriveReader()
        except Exception:
            state['status']='authorization_required'
            for g in state['groups'].values():g['status']='authorization_required'
            write_outputs(root,state)
            return state
    inputs,metas,failures={},{},{}
    for source in config['sources']:
        name,file_id=source['manager'],source['file_id']
        try:
            if offline_dir:
                raw=(offline_dir/(file_id+'.xlsx')).read_bytes()
                meta={'id':file_id,'mimeType':XLSX,'modifiedTime':(offline_meta or {}).get(file_id,{}).get('modified_time'),'version':hashlib.sha256(raw).hexdigest()}
            else: meta=reader.metadata(file_id)
            if meta['mimeType']!=XLSX:raise ValueError('source_not_existing_xlsx')
            fingerprint=str(meta.get('version') or meta['modifiedTime'])
            if name in cache and cache[name]['fingerprint']==fingerprint:
                data=restore(cache[name]['input'])
            else:
                if not offline_dir:
                    raw=reader.download(file_id)
                    after=reader.metadata(file_id)
                    if after.get('version')!=meta.get('version'):raise ValueError('source_edited_during_read')
                data=read_workbook(raw,config)
                cache[name]={'fingerprint':fingerprint,'input':freeze(data)}
            inputs[name]=data;metas[name]=meta
        except Exception as e:
            # Do not emit provider responses, private notes or credential data.
            failures[name]=str(e) if isinstance(e,ValueError) and str(e).replace('_','').isalnum() else type(e).__name__
            if name in cache: inputs[name]=restore(cache[name]['input'])
    calculated=summaries(inputs,now.date())
    for source in config['sources']:
        name=source['manager'];old=state['groups'].get(name,{})
        if name in failures:
            state['groups'][name]={**old,'status':'failed_retaining_last_good','error':failures[name]}
        else:
            state['groups'][name]={**calculated[name],'status':'ok','last_success_at':now.isoformat(),
                                  'source_modified_at':metas[name].get('modifiedTime')}
    state['status']='partial_failure' if failures else 'ok'
    state['last_success_at']=now.isoformat() if not failures else previous.get('last_success_at')
    cached=json.dumps(cache,ensure_ascii=False,default=str).encode()
    if not offline_dir:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        nonce=os.urandom(12)
        cached=nonce+AESGCM(cache_key()).encrypt(nonce,cached,b'execution-cache-v1')
    cachepath.write_bytes(cached)
    write_outputs(root,state)
    return state


def freeze(data):
    return json.loads(json.dumps(data,default=str,ensure_ascii=False))


def cache_key():
    raw=os.getenv('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON') or os.getenv('GOOGLE_DRIVE_OAUTH_JSON')
    return hashlib.sha256(json.dumps(json.loads(raw),sort_keys=True,separators=(',',':')).encode()).digest()


def restore(data):
    # Date handling at the gate accepts both ISO text and workbook datetimes.
    return copy.deepcopy(data)


def write_outputs(root,state):
    for name,content in [('execution.json',json.dumps(state,ensure_ascii=False,separators=(',',':'))),
                         ('execution-data.js','window.EXECUTION_DATA='+json.dumps(state,ensure_ascii=False,separators=(',',':'))+';')]:
        tmp=root/(name+'.tmp');tmp.write_text(content,encoding='utf8');tmp.replace(root/name)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).parent)
    p.add_argument('--offline-dir',type=Path);p.add_argument('--offline-meta',type=Path)
    a=p.parse_args();meta=json.loads(a.offline_meta.read_text(encoding='utf8')) if a.offline_meta else None
    state=run(a.root,a.offline_dir,meta)
    print(json.dumps({'status':state['status'],'groups':{k:{'status':v['status'],'registered':v.get('operational',{}).get('registered_record_count')} for k,v in state['groups'].items()}}))
