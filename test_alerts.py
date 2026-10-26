import copy
import json
import unittest
from pathlib import Path
import build_alerts as b
import publication_guard as p

class AlertsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=json.loads(Path('alerts.json').read_text(encoding='utf8'))

    def test_snapshot_counts_and_dates(self):
        d=self.data
        for board,count in d['counts'].items():
            self.assertEqual(count,len({r['parent'] for r in d['entries'] if r['board']==board}))
        self.assertEqual({r['parent'] for r in d['parents']},{r['parent'] for r in d['entries']})
        self.assertEqual(len({r['parent'] for r in d['parents']}),len(d['parents']))
        self.assertNotIn('natural_days',json.dumps(d))

    def test_dates_cannot_regress_even_with_newer_sync(self):
        for field,value in [('business_cutoff','2026-10-23'),('status_snapshot_date','2026-10-19'),('latest_action_date','2026-10-20')]:
            d=copy.deepcopy(self.data);d[field]=value;d['last_success_at']='2026-10-27T00:00:00Z'
            with self.assertRaises(p.PublicationError):p.assert_no_regression('alerts',d,self.data)

    def test_failed_check_keeps_old_success_and_rows(self):
        failed=copy.deepcopy(self.data);failed.update(status='read_failed',checked_at='2026-10-27T00:00:00Z')
        p.assert_no_regression('alerts',failed,self.data)
        self.assertEqual(failed['parents'],self.data['parents'])
        self.assertEqual(failed['last_success_at'],self.data['last_success_at'])

    def test_owned_files_and_public_boundary(self):
        self.assertEqual(p.MODULES['alerts'][:2],('alerts.json','alerts-data.js'))
        payload={k:Path(k).read_bytes() for k in p.MODULES['alerts'][:2]}
        self.assertEqual(p.validate_pair('alerts',payload),self.data)
        self.assertNotIn('build_alerts.py',p.STATIC)
        self.assertFalse(any('input' in name or 'source-audit' in name for name in p.STATIC))

    def test_raw_source_mapping_and_multi_label_retention(self):
        # Real private receipt is optional in CI. No private raw input is published.
        path=Path('../alert-integration-review/live-input.json')
        if not path.exists():self.skipTest('private local readback receipt only')
        raw=json.loads(path.read_text(encoding='utf8'))
        result=b.normalize(raw)
        self.assertEqual(result,self.data)
        self.assertEqual(len(result['parents']),15)
        self.assertEqual(len(result['actions']),378)
        self.assertEqual((result['business_cutoff'],result['status_snapshot_date'],result['latest_action_date']),('2026-10-24','2026-10-26','2026-10-21'))
        # Add a second source-listed tag for a real key without changing any rule.
        key=result['parents'][0]['parent']
        raw['sheets']['黑榜']['values'][3][6]=key
        multi=b.normalize(raw)
        self.assertEqual(len(multi['parents']),14)
        parent=next(r for r in multi['parents'] if r['parent']==key)
        self.assertEqual(set(parent['labels']),{'成长榜','黑榜'})
        self.assertEqual(len(multi['entries']),len(result['entries']))

if __name__=='__main__':unittest.main()
