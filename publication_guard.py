"""Publication only: module ownership, monotonic dates, optimistic Git writes.

No ERP, source workbooks, metric calculations or messaging APIs.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

MODULES = {
    'targets': ('targets.json', 'targets-data.js', 'window.OPERATIONS_TARGETS='),
    'execution': ('execution.json', 'execution-data.js', 'window.EXECUTION_DATA='),
    'alerts': ('alerts.json', 'alerts-data.js', 'window.ALERTS_DATA='),
    'weekly': ('summary.json', 'summary-data.js', 'window.OPERATIONS_DATA='),
    'weekly_business': ('weekly-business.json', 'weekly-business-data.js', 'window.WEEKLY_BUSINESS_DATA='),
}
STATIC = ('.nojekyll','index.html','style.css','app.js','summary.json','summary-data.js',
          'targets.json','targets-data.js','targets.js','execution.json',
          'execution-data.js','execution-sync.js','snapshot-guard.js',
          'alerts.json','alerts-data.js','alerts.js','alerts.css',
          'weekly-business.json','weekly-business-data.js')
LIVE = 'https://blackblancakeep62-crypto.github.io/operations-four-dashboard/'

class PublicationError(ValueError):
    pass

def versions(module, data):
    result = {}
    if module == 'weekly_business':
        if data.get('schema')!='weekly-business-v1' or data.get('financial_basis')!={'sales_factor':.9,'profit_factor':.85,'basis':'adjusted_once_from_raw_erp'}:
            raise PublicationError('invalid_shared_weekly_basis')
        if not isinstance(data.get('groups'),dict) or not isinstance(data.get('department_periods'),list):
            raise PublicationError('invalid_shared_weekly_groups')
        result['root']=data
        result.update({'group/'+k:v for k,v in data['groups'].items()})
        for entry in [data, *data['groups'].values()]:
            periods=entry.get('department_periods',entry.get('periods',[]))
            for p in periods:
                from datetime import date
                start,end=date.fromisoformat(p['start']),date.fromisoformat(p['end'])
                if start.weekday()!=0 or (end-start).days!=6 or p.get('complete') is not True:
                    raise PublicationError('invalid_shared_week')
                m=p['metrics']
                if p.get('formal') is False or m.get('status')=='partially_verified':raise PublicationError('observation_in_formal_period')
                import math
                fields=('orderProductSales','salesNetProfit','discountCostSales','unitsOrdered','orders','adsSpend','adjusted_sales_cny','adjusted_net_profit_cny')
                if not all(isinstance(m.get(k),(int,float)) and not isinstance(m[k],bool) and math.isfinite(m[k]) for k in fields):
                    raise PublicationError('invalid_shared_weekly_metrics')
                for raw,adjusted,factor in [('orderProductSales','adjusted_sales_cny',.9),('salesNetProfit','adjusted_net_profit_cny',.85)]:
                    if abs(m[raw]*factor-m[adjusted])>1e-6:raise PublicationError('double_weekly_adjustment')
                if m['adjusted_sales_cny'] and abs(m['adjusted_net_margin']-m['adjusted_net_profit_cny']/m['adjusted_sales_cny'])>1e-9:
                    raise PublicationError('invalid_shared_weekly_margin')
        display=data.get('weekly_display')
        if display is not None:
            if display.get('schema')!='shared-weekly-display-v1' or not isinstance(display.get('groups'),dict):raise PublicationError('invalid_weekly_display')
            import math
            from datetime import date
            for owner,entry in [('all',display),*display['groups'].items()]:
                result['display/'+owner]=entry;seen=set()
                for p in entry.get('periods',[]):
                    k=(p['start'],p['end'])
                    if k in seen or date.fromisoformat(k[0]).weekday()!=0 or (date.fromisoformat(k[1])-date.fromisoformat(k[0])).days!=6:raise PublicationError('invalid_weekly_display_period')
                    seen.add(k)
                    if p.get('formal') is not False or p.get('source_kind') not in ('shared_full_week','legacy_published'):raise PublicationError('invalid_weekly_display_scope')
                    if p['source_kind']=='shared_full_week' and not p.get('source_sha256'):raise PublicationError('missing_weekly_display_proof')
                    for m in [p['metrics'],*p.get('sites',{}).values()]:
                        if (m.get('source_start'),m.get('source_end'))!=k:raise PublicationError('weekly_display_metric_date_mismatch')
                        for f in ('orderProductSales','salesNetProfit','adjusted_sales_cny','adjusted_net_profit_cny','adsSpend'):
                            v=m.get(f)
                            if v is not None and (not isinstance(v,(int,float)) or isinstance(v,bool) or not math.isfinite(v)):raise PublicationError('invalid_weekly_display_metric')
                        for raw,adjusted,factor in [('orderProductSales','adjusted_sales_cny',.9),('salesNetProfit','adjusted_net_profit_cny',.85)]:
                            if m.get(raw) is not None and m.get(adjusted) is not None and abs(m[raw]*factor-m[adjusted])>1e-6:raise PublicationError('double_weekly_display_adjustment')
        o=data.get('observation_snapshot')
        if o is not None:
            from datetime import date
            if (o.get('schema')!='weekly-observation-v1' or o.get('status')!='partially_verified' or o.get('formal') is not False or
                o.get('complete') is not False or o.get('department_coverage_complete') is not False or o.get('amount_reconciliation_passed') is not True):
                raise PublicationError('invalid_weekly_observation_state')
            if date.fromisoformat(o['start']).weekday()!=0 or (date.fromisoformat(o['end'])-date.fromisoformat(o['start'])).days!=6:
                raise PublicationError('invalid_weekly_observation_period')
            if data.get('requested_cutoff')!=o['end'] or data.get('weekly_cutoff','')>=o['end']:
                raise PublicationError('observation_overwrites_formal_week')
            for flag in ('formal_department_targets','personal_performance','automatic_business_conclusions','replace_last_complete_week'):
                if o.get('eligibility',{}).get(flag) is not False:raise PublicationError('unsafe_weekly_observation_use')
            import math
            m=o['confirmed']
            if not all(isinstance(m.get(f),(int,float)) and not isinstance(m[f],bool) and math.isfinite(m[f]) for f in ('orderProductSales','salesNetProfit','adjusted_sales_cny','adjusted_net_profit_cny')):
                raise PublicationError('invalid_weekly_observation_amount')
            if abs(m['orderProductSales']*.9-m['adjusted_sales_cny'])>1e-6 or abs(m['salesNetProfit']*.85-m['adjusted_net_profit_cny'])>1e-6:
                raise PublicationError('double_weekly_observation_adjustment')
    elif module == 'weekly':
        if data.get('financial_basis',{}).get('schema')!='adjusted-display-v1':raise PublicationError('invalid_weekly_financial_basis')
        if not isinstance(data.get('groups'),list):raise PublicationError('invalid_weekly_groups')
        result['scope']={'rule_version':data.get('rule_version'),'financial_basis':data['financial_basis']}
        for group in data['groups']:
            if group.get('report_verified'):result['group/'+group['manager']]=group
    elif module == 'targets':
        if data.get('schema_version') != 1: raise PublicationError('invalid_targets_schema')
        for period, entry in data['departments'].items():
            if entry.get('actual'):
                result['department/'+period] = entry['actual']
        for period, people in data['personal'].items():
            for name, entry in people.items():
                if entry.get('actual'):
                    result['personal/'+period+'/'+name] = entry['actual']
    elif module == 'alerts':
        if data.get('schema') != 'alerts-v1': raise PublicationError('invalid_alerts_schema')
        if not all(isinstance(data.get(k),list) for k in ('parents','entries','history','actions')):
            raise PublicationError('invalid_alerts_rows')
        for key in ('business_cutoff','status_snapshot_date','last_success_at','checked_at'):
            if not data.get(key):raise PublicationError('missing_alerts_date:'+key)
        result['root'] = data
    else:
        if data.get('schema') != 'execution-sync-v1': raise PublicationError('invalid_execution_schema')
        result['root'] = data
        result.update({'group/'+k:v for k,v in data['groups'].items()})
    return result

def instant(value):
    parsed = datetime.fromisoformat(str(value).replace('Z','+00:00'))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)

def assert_no_regression(module, candidate, previous, allow_rollback=False, reason=''):
    if module in ('alerts','weekly_business') and previous is None:
        versions(module,candidate)
        return
    new, old = versions(module,candidate), versions(module,previous)
    if allow_rollback:
        if not reason.strip(): raise PublicationError('manual_rollback_reason_required')
        return
    for scope, before in old.items():
        after = new.get(scope)
        if after is None: raise PublicationError('missing_previous_scope:'+scope)
        if module == 'weekly_business':
            if before.get('weekly_cutoff') and (not after.get('weekly_cutoff') or after['weekly_cutoff']<before['weekly_cutoff']):
                raise PublicationError('older_shared_weekly_cutoff:'+scope)
            fields=('generated_at','last_success_at') if scope=='root' else ()
        elif module == 'weekly':
            if scope=='scope':
                if after!=before:raise PublicationError('weekly_statistical_basis_changed')
                continue
            for key in ('weekly_cutoff','monthly_cutoff','asof','pricing_weekly_cutoff','pricing_monthly_cutoff','pricing_asof'):
                if before.get(key) and (not after.get(key) or after[key]<before[key]):raise PublicationError('older_weekly_date:'+scope+'/'+key)
            fields=('generated_at','pricing_updated_at')
        elif module == 'targets':
            if (after.get('start'),after.get('basis')) != (before.get('start'),before.get('basis')):
                raise PublicationError('statistical_basis_changed:'+scope)
            if not after.get('cutoff') or after['cutoff'] < before['cutoff']:
                raise PublicationError('older_business_cutoff:'+scope)
            fields = ('refreshed_at',) if after['cutoff'] == before['cutoff'] else ()
        elif module == 'alerts':
            for key in ('business_cutoff','status_snapshot_date','latest_action_date'):
                if before.get(key) and (not after.get(key) or after[key] < before[key]):
                    raise PublicationError('older_alerts_date:'+key)
            fields = ('data_asof','last_success_at','checked_at')
        else:
            fields = ('data_asof','last_success_at','checked_at')
        for field in fields:
            if before.get(field) and (not after.get(field) or instant(after[field]) < instant(before[field])):
                raise PublicationError('older_snapshot_timestamp:'+scope+'/'+field)

def validate_pair(module, payload):
    name, script, prefix = MODULES[module]
    view = json.loads(payload[name].decode('utf-8-sig'))
    text = payload[script].decode('utf-8-sig').strip()
    if not text.startswith(prefix) or not text.endswith(';'):
        raise PublicationError('invalid_embedded_snapshot')
    if json.loads(text[len(prefix):-1]) != view:
        raise PublicationError('json_js_snapshot_mismatch')
    versions(module,view)
    return view

def git(repo, *args, stdin=None, env=None):
    result = subprocess.run(['git','-C',str(repo),*args],input=stdin,capture_output=True,
                            timeout=120,env={**os.environ,'GIT_TERMINAL_PROMPT':'0',
                            'GCM_INTERACTIVE':'never',**(env or {})})
    if result.returncode:
        raise PublicationError('git_'+args[0]+'_failed:'+result.stderr.decode('utf8','replace')[-350:])
    return result.stdout

def text(repo,*args,**kwargs):
    return git(repo,*args,**kwargs).decode('utf8').strip()

def committed_payload(repo, revision, module):
    return {name:git(repo,'show',revision+':'+name) for name in MODULES[module][:2]}

def publish_module(repo, module, payload=None, attempts=3, allow_rollback=False, reason=''):
    """Each attempt overlays only two owned blobs onto a freshly fetched main.

    A rejected non-force push retries from the new head and rechecks data dates.
    No checkout/reset/rebase of uncommitted source or another module's files.
    """
    payload = payload or {name:(Path(repo)/name).read_bytes() for name in MODULES[module][:2]}
    if set(payload) != set(MODULES[module][:2]): raise PublicationError('module_ownership_violation')
    candidate = validate_pair(module,payload)
    for attempt in range(attempts):
        git(repo,'fetch','origin','main')
        parent = text(repo,'rev-parse','origin/main')
        names=text(repo,'ls-tree','--name-only',parent).splitlines()
        previous = (None if module=='weekly_business' and MODULES[module][0] not in names
                    else validate_pair(module,committed_payload(repo,parent,module)))
        assert_no_regression(module,candidate,previous,allow_rollback,reason)
        with tempfile.TemporaryDirectory(prefix='dashboard-index-') as folder:
            env = {'GIT_INDEX_FILE':str(Path(folder)/'index')}
            git(repo,'read-tree',parent,env=env)
            for name, raw in payload.items():
                blob = text(repo,'hash-object','-w','--stdin',stdin=raw)
                git(repo,'update-index','--add','--cacheinfo','100644,'+blob+','+name,env=env)
            tree = text(repo,'write-tree',env=env)
        if tree == text(repo,'rev-parse',parent+'^{tree}'):
            return {'commit':parent,'changed':False,'attempts':attempt+1}
        message = 'Update '+module+' snapshot only'
        if allow_rollback: message += ' [manual rollback: '+reason.strip()+']'
        commit = text(repo,'-c','user.name=Operations Dashboard Sync','-c',
                      'user.email=dashboard-sync@users.noreply.github.com',
                      'commit-tree',tree,'-p',parent,'-m',message)
        try:
            git(repo,'push','origin',commit+':refs/heads/main')
            return {'commit':commit,'changed':True,'attempts':attempt+1}
        except PublicationError:
            if attempt == attempts-1: raise

def load_live(module):
    name = MODULES[module][0]
    request = urllib.request.Request(LIVE+name+'?publication_check='+uuid.uuid4().hex,
                                     headers={'Cache-Control':'no-cache'})
    try:
        with urllib.request.urlopen(request,timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if module not in ('alerts','weekly_business') or error.code != 404:raise
        # One-time onboarding only: the deployed manifest must prove this module
        # has never been packaged. Other HTTP/network failures stay fail-closed.
        with urllib.request.urlopen(LIVE+'publication.json?check='+uuid.uuid4().hex,timeout=30) as response:
            manifest=json.load(response)
        if MODULES[module][0] in manifest.get('hashes',{}):raise
        return None

def prepare_site(repo, output, live_reader=load_live, allow_rollback=False, reason=''):
    git(repo,'fetch','origin','main')
    head = text(repo,'rev-parse','origin/main')
    contents = {name:git(repo,'show',head+':'+name) for name in STATIC}
    data = {}
    for module in MODULES:
        data[module] = validate_pair(module,contents)
        # Fail closed if live state cannot be verified. Never deploy a cached
        # local build directory or an event SHA older than the published data.
        assert_no_regression(module,data[module],live_reader(module),allow_rollback,reason)
    html = contents['index.html'].decode('utf8')
    def version_asset(match):
        attr,path = match.groups()
        name = path.split('?')[0]
        if name not in contents or not name.endswith(('.js','.css')):return match.group(0)
        return attr+'="'+name+'?v='+hashlib.sha256(contents[name]).hexdigest()[:16]+'"'
    contents['index.html'] = re.sub(r'(src|href)="([^"]+)"',version_asset,html).encode()
    output = Path(output);output.mkdir(parents=True,exist_ok=False)
    for name,raw in contents.items():(output/name).write_bytes(raw)
    manifest = {'source_commit':head,'generated_at':datetime.now(timezone.utc).isoformat(),
                'hashes':{n:hashlib.sha256(b).hexdigest() for n,b in contents.items()},
                'business_cutoffs':{k:v['cutoff'] for k,v in versions('targets',data['targets']).items()},
                'execution_last_success':data['execution'].get('last_success_at'),
                'manual_rollback':bool(allow_rollback),'rollback_reason':reason if allow_rollback else None}
    (output/'publication.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    return manifest

def require_latest(repo, output):
    manifest = json.loads((Path(output)/'publication.json').read_text(encoding='utf8'))
    git(repo,'fetch','origin','main')
    if manifest['source_commit'] != text(repo,'rev-parse','origin/main'):
        raise PublicationError('main_advanced_after_packaging_defer_to_next_serial_run')

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=('publish','package','check-latest'))
    parser.add_argument('--repo',type=Path,default=Path('.'))
    parser.add_argument('--module',choices=tuple(MODULES))
    parser.add_argument('--output',type=Path,default=Path('_site'))
    parser.add_argument('--allow-rollback',action='store_true')
    parser.add_argument('--reason',default='')
    args=parser.parse_args()
    if args.action=='publish':
        if not args.module:parser.error('--module required')
        print(json.dumps(publish_module(args.repo,args.module,allow_rollback=args.allow_rollback,reason=args.reason)))
    elif args.action=='package':
        result=prepare_site(args.repo,args.output,allow_rollback=args.allow_rollback,reason=args.reason)
        print(json.dumps({'source_commit':result['source_commit'],'cutoffs':result['business_cutoffs']}))
    else:require_latest(args.repo,args.output)
