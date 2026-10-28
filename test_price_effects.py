import unittest
from datetime import date
from price_effects import execution_batches,compare
from sync_execution import normalize_execution_headers,HEADERS

def row(child='CHILD',manager_site='A:US',start='2026-10-13',state='已完成'):
    r=[None]*26;r[:13]=['T-'+child,manager_site,'PARENT',child,'MSKU-'+child,'V4-001',10,10.5,10.5,'USD',start,'2026-11-04',state]
    r[16]='是';r[19]=True;r[23]='通过';return r

def week(sales=100,profit=10,units=10):return {'complete':True,'unresolved':False,'sales':sales,'profit':profit,'units':units}
def input_for(rows):
    queue=[]
    for r in rows:
        q=[None]*31;q[1:5]=r[1:5];queue.append(q)
    return {'rows':rows,'queue':queue,'asof':'2026-10-12'}

class PriceEffectsTest(unittest.TestCase):
    def setUp(self):
        self.today=date(2026,11,4)
        self.batches=execution_batches({'李漉':input_for([row()])},self.today)
        self.b=self.batches[0]
        self.weeks={'2026-09-28':week(),'2026-10-05':week(),'2026-10-19':week(150,20,10),'2026-10-26':week(150,20,10)}
    def test_actual_children_deduplicated_parent_across_owners(self):
        groups={'李漉':input_for([row(),row('OTHER')]),'陈梦怡':input_for([row()])}
        result=execution_batches(groups,self.today)
        self.assertEqual(len(result),1);self.assertEqual(len(result[0]['children']),2);self.assertEqual(result[0]['owners'],['李漉','陈梦怡'])
        self.assertNotIn('msku',result[0]['children'][0])
    def test_nonstarted_not_a_price_increase(self):
        entries=[row(state='填写中'),row('C2',state='待核验'),row('C3')];entries[2][8]=10
        self.assertEqual(execution_batches({'李漉':{'rows':entries,'queue':[]}},self.today),[])
    def test_adjusted_parent_profit_and_asp_once(self):
        e=compare(self.b,self.weeks,self.today,self.batches)
        self.assertEqual(e['status'],'有效候选');self.assertAlmostEqual(e['before']['sales'],180);self.assertAlmostEqual(e['before']['profit'],17)
        self.assertAlmostEqual(e['before']['asp'],9);self.assertAlmostEqual(e['after']['profit'],34);self.assertAlmostEqual(e['profit_delta'],17)
        self.assertAlmostEqual(e['after']['margin'],34/270)
    def test_profit_up_asp_down_requires_review(self):
        self.weeks['2026-10-19']=self.weeks['2026-10-26']=week(80,20,20)
        e=compare(self.b,self.weeks,self.today,self.batches)
        self.assertEqual(e['status'],'需关注');self.assertIn('ASP下降',e['reason'])
    def test_sales_up_profit_down_invalid(self):
        self.weeks['2026-10-19']=self.weeks['2026-10-26']=week(150,5,10)
        self.assertEqual(compare(self.b,self.weeks,self.today,self.batches)['status'],'无效')
    def test_observation_not_complete_and_missing_weeks(self):
        self.assertEqual(compare(self.b,self.weeks,date(2026,10,25),self.batches)['status'],'待观察')
        del self.weeks['2026-10-05'];self.assertEqual(compare(self.b,self.weeks,self.today,self.batches)['status'],'待观察')
    def test_unverified_comparability_and_scope(self):
        self.b['children'][0]['interference_confirmed']=False
        self.assertEqual(compare(self.b,self.weeks,self.today,self.batches)['status'],'待核验')
        self.weeks['2026-10-05']['unresolved']=True
        self.assertEqual(compare(self.b,self.weeks,self.today,self.batches)['status'],'待核验')
    def test_interfering_batch_not_double_counted(self):
        second=execution_batches({'李漉':input_for([row('OTHER',start='2026-10-20')])},self.today)[0]
        self.assertEqual(compare(self.b,self.weeks,self.today,[self.b,second])['status'],'待核验')
    def test_snapshot_price_alias_does_not_claim_actual_increase(self):
        headers=HEADERS.copy();headers[6]='现价原币（快照）';headers[7]='建议测试价原币'
        rows,pending=normalize_execution_headers(headers,[row()])
        self.assertEqual(pending,1);self.assertIsNone(rows[0][6]);self.assertEqual(execution_batches({'陈芳志':{'rows':rows,'queue':[]}},self.today),[])
    def test_owner_unmatched_is_not_assigned(self):
        batch=execution_batches({'陈芳志':{'rows':[row()],'queue':[],'asof':'2026-10-12'}},self.today)[0]
        self.assertEqual(batch['owners'],[]);self.assertTrue(batch['ownership_unconfirmed'])
        self.assertEqual(compare(batch,self.weeks,self.today,[batch])['status'],'待核验')

if __name__=='__main__':unittest.main()
