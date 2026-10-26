"""Real local bare-Git integration; no ERP, Drive, messages or production writes."""
import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import publication_guard as p

def target(cutoff='2026-10-25',stamp='2026-10-26T11:30:53+08:00'):
    a={'start':'2026-10-01','cutoff':cutoff,'basis':'adjusted_once_from_raw_erp',
       'refreshed_at':stamp,'sales':3019571.775,'net_profit':299412.228,'net_margin':.09915718198}
    return {'schema_version':1,'departments':{'2026-10':{'actual':a}},
            'personal':{'2026-10':{'李漉':{'actual':copy.deepcopy(a)}}}}

def execution(stamp='2026-10-26T11:27:58+08:00'):
    return {'schema':'execution-sync-v1','last_success_at':stamp,'checked_at':stamp,
            'data_asof':stamp,'groups':{'李漉':{'last_success_at':stamp,'data_asof':stamp,
                                             'operational':{'active_count':0,'verified_increment_cny':None}}}}

def pair(module,data):
    name,script,prefix=p.MODULES[module]
    raw=json.dumps(data,ensure_ascii=False).encode()
    return {name:raw,script:prefix.encode()+raw+b';'}

class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name)
        self.remote=self.base/'remote.git';self.a=self.base/'execution';self.b=self.base/'business'
        subprocess.run(['git','init','--bare',str(self.remote)],check=True,capture_output=True)
        self.clone(self.a)
        p.git(self.a,'checkout','-b','main')
        initial={**pair('targets',target('2026-10-22','2026-10-23T10:00:00+08:00')),
                 **pair('execution',execution('2026-10-26T10:00:00+08:00'))}
        for name in p.STATIC:
            if name not in initial:initial[name]=b'preserve-'+name.encode()
        initial['index.html']=b'<script src="targets-data.js"></script><script src="snapshot-guard.js"></script>'
        initial['summary.json']=b'{"keep":"ERP theory unchanged"}'
        for name,raw in initial.items():(self.a/name).write_bytes(raw)
        p.git(self.a,'add','.')
        p.git(self.a,'-c','user.name=Test','-c','user.email=test@example.com','commit','-m','initial')
        p.git(self.a,'push','origin','HEAD:main')
        self.clone(self.b)
        self.old=p.text(self.a,'rev-parse','HEAD')

    def tearDown(self):self.tmp.cleanup()

    def clone(self,path):
        subprocess.run(['git','clone',str(self.remote),str(path)],check=True,capture_output=True)

    def observed(self,module):
        p.git(self.a,'fetch','origin','main')
        return p.validate_pair(module,p.committed_payload(self.a,'origin/main',module))

    def test_business_then_execution_from_old_checkout(self):
        p.publish_module(self.b,'targets',pair('targets',target()))
        result=p.publish_module(self.a,'execution',pair('execution',execution()))
        self.assertEqual(self.observed('targets'),target())
        self.assertEqual(self.observed('execution'),execution())
        self.assertEqual(p.git(self.a,'show',result['commit']+':summary.json'),b'{"keep":"ERP theory unchanged"}')
        changed=p.text(self.a,'diff-tree','--no-commit-id','--name-only','-r',result['commit']).splitlines()
        self.assertEqual(set(changed),set(p.MODULES['execution'][:2]))

    def test_execution_then_business_from_old_checkout(self):
        p.publish_module(self.a,'execution',pair('execution',execution()))
        result=p.publish_module(self.b,'targets',pair('targets',target()))
        self.assertEqual(self.observed('targets'),target())
        self.assertEqual(self.observed('execution'),execution())
        changed=p.text(self.b,'diff-tree','--no-commit-id','--name-only','-r',result['commit']).splitlines()
        self.assertEqual(set(changed),set(p.MODULES['targets'][:2]))

    def test_real_concurrent_push_conflict_retries_on_new_main(self):
        original=p.git;injected=[]
        def racing(repo,*args,**kwargs):
            if Path(repo)==self.a and args[0]=='push' and not injected:
                injected.append(True)
                p.publish_module(self.b,'targets',pair('targets',target()))
            return original(repo,*args,**kwargs)
        with patch.object(p,'git',racing):
            result=p.publish_module(self.a,'execution',pair('execution',execution()))
        self.assertEqual(result['attempts'],2)
        self.assertEqual(self.observed('targets'),target())
        self.assertEqual(self.observed('execution'),execution())

    def test_concurrent_newer_business_rechecked_not_blindly_rebased(self):
        original=p.git;injected=[]
        def racing(repo,*args,**kwargs):
            if Path(repo)==self.a and args[0]=='push' and not injected:
                injected.append(True)
                p.publish_module(self.b,'targets',pair('targets',target('2026-10-26')))
            return original(repo,*args,**kwargs)
        with patch.object(p,'git',racing),self.assertRaisesRegex(p.PublicationError,'older_business_cutoff'):
            p.publish_module(self.a,'targets',pair('targets',target()))
        self.assertEqual(self.observed('targets')['departments']['2026-10']['actual']['cutoff'],'2026-10-26')

    def test_old_business_date_and_same_date_old_timestamp_rejected(self):
        p.publish_module(self.b,'targets',pair('targets',target()))
        for data in [target('2026-10-22'),target(stamp='2026-10-26T09:00:00+08:00')]:
            with self.assertRaises(p.PublicationError):p.publish_module(self.a,'targets',pair('targets',data))
        self.assertEqual(self.observed('targets'),target())

    def test_missing_person_or_changed_basis_rejected(self):
        for mutate in [lambda d:d['personal'].clear(),lambda d:d['departments']['2026-10']['actual'].update(basis='double_adjusted')]:
            data=target();mutate(data)
            with self.assertRaises(p.PublicationError):p.assert_no_regression('targets',data,target())

    def test_execution_timestamp_regression_rejected(self):
        with self.assertRaises(p.PublicationError):
            p.assert_no_regression('execution',execution('2026-10-26T10:00:00+08:00'),execution())

    def test_failure_state_can_retain_last_good_values(self):
        failure=execution();failure['status']='failed_retaining_last_good';failure['checked_at']='2026-10-27T11:00:00+08:00'
        p.assert_no_regression('execution',failure,execution())

    def test_pair_mismatch_and_other_module_writes_rejected(self):
        bad=pair('targets',target());bad['targets-data.js']=pair('targets',target('2026-10-22'))['targets-data.js']
        with self.assertRaisesRegex(p.PublicationError,'json_js_snapshot_mismatch'):p.validate_pair('targets',bad)
        bad=pair('execution',execution());bad['targets.json']=b'{}'
        with self.assertRaisesRegex(p.PublicationError,'ownership'):p.publish_module(self.a,'execution',bad)

    def test_package_uses_latest_git_blobs_not_dirty_or_old_checkout(self):
        result=p.publish_module(self.b,'targets',pair('targets',target()))
        (self.a/'targets.json').write_bytes(b'old local build must never be packaged')
        output=self.base/'site'
        live={'targets':target('2026-10-22','2026-10-23T10:00:00+08:00'),
              'execution':execution('2026-10-26T10:00:00+08:00')}
        manifest=p.prepare_site(self.a,output,live_reader=lambda module:live[module])
        self.assertEqual(manifest['source_commit'],result['commit'])
        self.assertEqual(json.loads((output/'targets.json').read_text(encoding='utf8')),target())
        self.assertIn('?v=',(output/'index.html').read_text())
        self.assertEqual(set(x.name for x in output.iterdir()),set(p.STATIC)|{'publication.json'})
        self.assertNotIn('execution-queue-baseline.enc',manifest['hashes'])
        p.require_latest(self.a,output)
        p.publish_module(self.b,'execution',pair('execution',execution()))
        with self.assertRaisesRegex(p.PublicationError,'main_advanced'):p.require_latest(self.a,output)

    def test_package_cannot_regress_live_business_or_reuse_directory(self):
        with self.assertRaisesRegex(p.PublicationError,'older_business_cutoff'):
            p.prepare_site(self.a,self.base/'site',live_reader=lambda module:target())
        self.assertFalse((self.base/'site').exists())

    def test_live_verification_failure_does_not_create_artifact(self):
        def unavailable(module):raise OSError('offline')
        with self.assertRaises(OSError):p.prepare_site(self.a,self.base/'site',live_reader=unavailable)
        self.assertFalse((self.base/'site').exists())

    def test_manual_rollback_requires_explicit_flag_and_reason(self):
        with self.assertRaises(p.PublicationError):p.assert_no_regression('targets',target('2026-10-22'),target(),True)
        p.assert_no_regression('targets',target('2026-10-22'),target(),True,'Explicit isolated test')

if __name__=='__main__':unittest.main()
