import base64
import hashlib
import hmac
import json
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import apps_script_transport as transport
from sync_execution import HEADERS, TZ

KEY='isolated-transport-test-key-never-used-in-production-'*2
NOW=datetime(2026,10,26,11,0,tzinfo=TZ)


def payload():
    return {'ok':True,'schema':'execution-input-v1','read_at':NOW.isoformat(),'groups':[
        {'file_id':'TEST-ID','status':'ok','headers':HEADERS,'rows':[],'source_modified_at':NOW.isoformat()}]}


class TransportTests(unittest.TestCase):
    def test_signature_and_tampering(self):
        raw=json.dumps(payload());signature=base64.b64encode(hmac.new(KEY.encode(),raw.encode(),hashlib.sha256).digest()).decode()
        self.assertEqual(transport.verify_response({'payload':raw,'signature':signature},KEY),payload())
        with self.assertRaises(ValueError):transport.verify_response({'payload':raw+' ','signature':signature},KEY)

    def test_baseline_round_trip_and_wrong_key(self):
        value={'李漉':{'queue':[],'asof':'2026-10-23'}}
        encoded=transport.encode_baseline(value,KEY)
        self.assertEqual(transport.decode_baseline(encoded,KEY),value)
        with self.assertRaises(Exception):transport.decode_baseline(encoded,'different-key')

    def test_endpoint_allowlist(self):
        with self.assertRaises(ValueError):transport.fetch_inputs('http://example.invalid/',KEY)
        with self.assertRaises(ValueError):transport.fetch_inputs('https://example.invalid/exec',KEY)

    def test_calculation_metadata(self):
        result=transport.calculate({'groups':{}},payload(),{'李漉':{'queue':[],'asof':'2026-10-23'}},
                                   {'sources':[{'manager':'李漉','file_id':'TEST-ID'}]},NOW)
        self.assertEqual(result['groups']['李漉']['operational']['active_count'],0)
        self.assertEqual(result['data_asof'],NOW.isoformat())
        self.assertIsNone(result['groups']['李漉']['operational']['verified_increment_cny'])

    def test_stale_payload_rejected(self):
        p=payload();p['read_at']='2026-10-20T00:00:00+08:00'
        with self.assertRaises(ValueError):transport.calculate({},p,{}, {'sources':[{}]},NOW)

    def test_network_failure_retains_every_count_and_success_time(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            previous={'schema':'execution-sync-v1','last_success_at':'previous-good',
                      'groups':{'李漉':{'operational':{'active_count':3},'last_success_at':'previous-good'}}}
            (root/'execution.json').write_text(json.dumps(previous),encoding='utf8')
            (root/'execution_sources.json').write_text(json.dumps({'sources':[]}),encoding='utf8')
            (root/'execution-queue-baseline.enc').write_bytes(transport.encode_baseline({},KEY))
            with patch.dict(os.environ,APPS_SCRIPT_EXECUTION_URL='https://script.google.com/macros/s/TEST/exec',APPS_SCRIPT_SYNC_KEY=KEY):
                def failure(url,key):raise RuntimeError('network failed')
                result=transport.run(root,failure,NOW)
            self.assertEqual(result['groups']['李漉']['operational']['active_count'],3)
            self.assertEqual(result['last_success_at'],'previous-good')
            self.assertEqual(result['groups']['李漉']['last_success_at'],'previous-good')


if __name__=='__main__':unittest.main()
