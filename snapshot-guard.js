'use strict';
// Publication freshness only. No metric or execution-state calculations.
window.SNAPSHOT_GUARD=(()=>{
  const known={};
  function versions(module,data){
    const out={};
    if(module==='targets'){
      if(data?.schema_version!==1||!data.departments||!data.personal)throw Error('snapshot schema');
      for(const [p,e] of Object.entries(data.departments))if(e.actual)out['department/'+p]=e.actual;
      for(const [p,people] of Object.entries(data.personal))for(const [n,e] of Object.entries(people))if(e.actual)out['personal/'+p+'/'+n]=e.actual;
    }else if(module==='alerts'){
      if(data?.schema!=='alerts-v1'||!['parents','entries','history','actions'].every(k=>Array.isArray(data[k])))throw Error('snapshot schema');
      for(const k of ['business_cutoff','status_snapshot_date','last_success_at','checked_at'])if(!data[k])throw Error('missing alerts date');
      out.root=data;
    }else{
      if(data?.schema!=='execution-sync-v1'||!data.groups)throw Error('snapshot schema');
      out.root=data;
      for(const [n,e] of Object.entries(data.groups))out['group/'+n]=e;
    }
    return out;
  }
  function check(module,next,previous){
    const a=versions(module,next),b=versions(module,previous);
    for(const [scope,old] of Object.entries(b)){
      const current=a[scope];if(!current)throw Error('missing scope');
      let fields;
      if(module==='targets'){
        if(current.start!==old.start||current.basis!==old.basis)throw Error('changed scope');
        if(!current.cutoff||current.cutoff<old.cutoff)throw Error('older business date');
        fields=current.cutoff===old.cutoff?['refreshed_at']:[];
      }else {
        if(module==='alerts')for(const k of ['business_cutoff','status_snapshot_date','latest_action_date'])if(old[k]&&(!current[k]||current[k]<old[k]))throw Error('older alerts date');
        fields=['data_asof','last_success_at','checked_at'];
      }
      for(const field of fields)if(old[field]&&(!current[field]||!Number.isFinite(Date.parse(current[field]))||Date.parse(current[field])<Date.parse(old[field])))throw Error('older snapshot time');
    }
    return true;
  }
  function save(module,data){try{localStorage.setItem('operations.last-good.'+module,JSON.stringify(data));}catch{}known[module]=data;return data;}
  function restore(module,seed){
    let cached=null;try{cached=JSON.parse(localStorage.getItem('operations.last-good.'+module));if(cached)versions(module,cached);}catch{cached=null;}
    if(cached){try{if(seed)check(module,seed,cached);else return save(module,cached);}catch{return save(module,cached);}}
    if(seed){versions(module,seed);return save(module,seed);}
    return null;
  }
  function accept(module,next){versions(module,next);if(known[module])check(module,next,known[module]);return save(module,next);}
  return {check,restore,accept};
})();
