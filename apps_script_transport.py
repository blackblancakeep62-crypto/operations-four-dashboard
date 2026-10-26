"""Private Apps Script -> accepted execution calculator -> public aggregates.

No Google OAuth token, service account or ERP client. Authentication is a
dedicated transport key held only by Script Properties and GitHub Secrets.
"""
import base64
import copy
import hashlib
import hmac
import json
import os
import zlib
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sync_execution import HEADERS, TZ, day, dedupe, summaries, write_outputs


def baseline_key(key):
    return hashlib.sha256(('queue-baseline-v1:'+key).encode()).digest()


def encode_baseline(data,key):
    nonce=os.urandom(12)
    return nonce+AESGCM(baseline_key(key)).encrypt(nonce,zlib.compress(json.dumps(data,ensure_ascii=False,default=str).encode()),b'queue-baseline-v1')


def decode_baseline(raw,key):
    return json.loads(zlib.decompress(AESGCM(baseline_key(key)).decrypt(raw[:12],raw[12:],b'queue-baseline-v1')))


def verify_response(envelope,key):
    payload=envelope.get('payload')
    if not isinstance(payload,str):raise ValueError('response_not_signed')
    expected=base64.b64encode(hmac.new(key.encode(),payload.encode(),hashlib.sha256).digest()).decode()
    if not hmac.compare_digest(str(envelope.get('signature','')),expected):raise ValueError('invalid_signature')
    data=json.loads(payload)
    if data.get('schema')!='execution-input-v1' or data.get('ok') is not True:raise ValueError('source_read_failed')
    return data


def fetch_inputs(url,key):
    parsed=urlparse(url)
    if parsed.scheme!='https' or parsed.hostname!='script.google.com' or not parsed.path.startswith('/macros/s/') or not parsed.path.endswith('/exec') or parsed.query:raise ValueError('invalid_endpoint_url')
    import requests
    # The key is POSTed over TLS, not put in URLs, command arguments or logs.
    response=requests.post(url,json={'action':'read_execution','key':key},timeout=(30,300),allow_redirects=False)
    for _ in range(3):
        if response.status_code not in (301,302,303):break
        target=response.headers.get('Location','');p=urlparse(target)
        if p.scheme!='https' or p.hostname not in ('script.google.com','script.googleusercontent.com'):raise ValueError('unexpected_redirect')
        # Google ContentService redirects are read with GET; never forward key.
        response=requests.get(target,timeout=(30,90),allow_redirects=False)
    if response.status_code!=200:raise ValueError('endpoint_http_'+str(response.status_code))
    return verify_response(response.json(),key)


def calculate(state,payload,baseline,config,now):
    if not isinstance(payload.get('groups'),list) or len(payload['groups'])!=len(config['sources']):raise ValueError('source_count_mismatch')
    groups={g.get('file_id'):g for g in payload['groups']}
    if len(groups)!=len(config['sources']):raise ValueError('duplicate_source')
    read_at=datetime.fromisoformat(payload['read_at'].replace('Z','+00:00'))
    if read_at.tzinfo is None or abs((now-read_at).total_seconds())>900:raise ValueError('stale_or_future_response')
    inputs={}
    for source in config['sources']:
        manager,file_id=source['manager'],source['file_id'];group=groups.get(file_id,{})
        if group.get('status')!='ok' or group.get('headers')!=HEADERS:raise ValueError('source_schema_changed')
        if not isinstance(group.get('rows'),list) or any(not isinstance(r,list) or len(r)!=24 for r in group['rows']):raise ValueError('invalid_execution_rows')
        cached=baseline[manager]
        # Reuse the accepted queue snapshot; daily scope reads execution sheet
        # only and does not recalculate or rescan the opportunity universe.
        inputs[manager]={'rows':dedupe(group['rows']),'queue':cached['queue'],'asof':cached['asof']}
    measured=summaries(inputs,now.date())
    updated=copy.deepcopy(state)
    updated.update(schema='execution-sync-v1',status='ok',automation='apps_script_daily',interval_minutes=1440,daily_time='10:30',
                   checked_at=now.isoformat(),last_success_at=now.isoformat(),data_asof=read_at.astimezone(TZ).isoformat())
    updated.setdefault('groups',{})
    for source in config['sources']:
        name=source['manager'];group=groups[source['file_id']]
        updated['groups'][name]={**measured[name],'status':'ok','last_success_at':now.isoformat(),
                                'data_asof':read_at.astimezone(TZ).isoformat(),'source_modified_at':group['source_modified_at'],
                                'queue_snapshot_asof':baseline[name]['asof']}
    updated.pop('error',None)
    return updated


def run(root,fetcher=fetch_inputs,now=None):
    now=now or datetime.now(TZ)
    state=json.loads((root/'execution.json').read_text(encoding='utf8'))
    config=json.loads((root/'execution_sources.json').read_text(encoding='utf8'))
    try:
        url,key=os.environ['APPS_SCRIPT_EXECUTION_URL'],os.environ['APPS_SCRIPT_SYNC_KEY']
        if len(key)<48:raise ValueError('transport_not_configured')
        baseline=decode_baseline((root/'execution-queue-baseline.enc').read_bytes(),key)
        payload=fetcher(url,key)
        updated=calculate(state,payload,baseline,config,now)
    except Exception as error:
        # All-four atomic snapshot: unknown cross-group occupancy must not cause
        # partial new claims of readiness or comparable parent profit.
        updated=copy.deepcopy(state)
        updated.update(checked_at=now.isoformat(),status='failed_retaining_last_good',automation='apps_script_daily')
        for group in updated.get('groups',{}).values():group['status']='failed_retaining_last_good'
        updated['error']=str(error) if isinstance(error,ValueError) and str(error).replace('_','').isalnum() else type(error).__name__
    write_outputs(root,updated)
    print(json.dumps({'status':updated['status'],'last_success_at':updated.get('last_success_at'),
                      'groups':{k:v.get('operational',{}).get('registered_record_count') for k,v in updated.get('groups',{}).items()}}))
    return updated


if __name__=='__main__':run(Path(__file__).parent)
