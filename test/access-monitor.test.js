/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Monitor=require('../src/access-monitor');
const {completeAccess}=require('../cli');

const report=(extra={})=>({status:'ok',complete:true,truncated:false,
    endpoints:[{key:'shop:1',kind:'shop',ride:1,name:'Shop',status:'healthy'}],warnings:[],
    summary:{healthy:1,unknown:0,unreachable:0},unavailable:[],...extra});
const amenitySite=(ride=1,extra={})=>({key:'exit:'+ride+':0',kind:'ride_exit',ride,station:0,status:'advisories',complete:true,
    targets:{benches:7,bins:1},deficits:{benches:7,bins:1},counts:{usableBenches:0,usableBins:0},...extra});
const amenities=(extra={})=>({status:'advisories',complete:true,truncated:false,sites:[amenitySite()],
    observations:[{code:'local_bench_shortfall',ride:1,site:'exit:1:0'},{code:'local_bin_shortfall',ride:1,site:'exit:1:0'}],
    summary:{sites:1,sitesWithShortfalls:1,unknownSites:0},policy:{benchThreshold:250},unavailable:[],...extra});
function harness(options={}){
    let now=100;const timers=[],jobs=[];
    const context={mode:'normal',setTimeout:(fn,delay)=>{assert.equal(delay,1);timers.push(fn);}};
    const map={},metadata={};
    const inspector={create:(givenMap,givenMetadata)=>{
        assert.equal(givenMap,map);assert.equal(givenMetadata,metadata);
        if(options.createError)throw Error(options.createError);
        const job={steps:0,done:false,step:(units)=>{
            assert.equal(units,1024,'each timer advances a bounded work batch');
            if(options.stepError)throw Error(options.stepError);
            job.steps++;if(job.steps>=(options.steps||2))job.done=true;
        },status:()=>({phase:'fake',steps:job.steps}),result:()=>{
            if(options.resultError)throw Error(options.resultError);
            return report({marker:jobs.indexOf(job),...(options.report||{})});
        }};
        jobs.push(job);return job;
    }};
    const monitor=Monitor.create(context,map,metadata,inspector,{now:()=>now,maxAgeMs:50});
    function flush(){let left=200;while(timers.length&&left-->0)timers.shift()();assert(left>0,'scheduler must settle');}
    return {context,map,metadata,monitor,timers,jobs,flush,setNow:value=>{now=value;}};
}

test('an overview starts one yielding job and reuses its completed report within the TTL',()=>{
    const h=harness();assert.equal(h.monitor.overview().status,'checking');
    assert.equal(h.jobs.length,1);assert.equal(h.jobs[0].steps,0);assert.equal(h.timers.length,1);
    assert.equal(h.monitor.overview().status,'checking');assert.equal(h.jobs.length,1);
    h.timers.shift()();assert.equal(h.jobs[0].steps,1);assert.equal(h.monitor.overview().status,'checking');
    h.setNow(110);h.flush();
    const current=h.monitor.overview();assert.equal(current.status,'ok');assert.equal(current.checkedAt,110);assert.equal(current.elapsedMs,10);
    h.setNow(160);assert.equal(h.monitor.overview().status,'ok');assert.equal(h.jobs.length,1);
    h.setNow(161);assert.equal(h.monitor.overview().status,'checking');assert.equal(h.jobs.length,2);
});

test('simultaneous access requests share a pending job and receive the same completed evidence',()=>{
    const h=harness(),received=[];
    h.monitor.wait({},(error,value)=>received.push([error,value]));
    h.monitor.wait({},(error,value)=>received.push([error,value]));
    assert.equal(h.jobs.length,1);assert.equal(received.length,0);
    h.flush();assert.equal(received.length,2);assert.equal(received[0][0],null);
    assert.equal(received[0][1],received[1][1]);assert.equal(received[0][1].complete,true);
    assert.equal(h.monitor.ride(1).status,'ok');assert.equal(h.monitor.ride(999).status,'unknown');
});

test('refresh bypasses the cache while preserving one shared pending scan',()=>{
    const h=harness();h.monitor.overview();h.flush();
    const values=[];h.monitor.wait({refresh:true},(error,value)=>values.push(value));
    h.monitor.wait({refresh:true},(error,value)=>values.push(value));
    assert.equal(h.jobs.length,2);assert.equal(values.length,0);h.flush();
    assert.equal(values.length,2);assert.equal(values[0].marker,1);assert.equal(values[0],values[1]);
});

test('invalidation revokes old waiters and prevents an already queued timer publishing a stale park',()=>{
    const h=harness(),old=[],fresh=[];
    h.monitor.wait({},(error,value)=>old.push([error,value]));
    const staleTick=h.timers.shift();
    h.monitor.invalidate('park changed');
    assert.equal(old.length,1);assert.match(old[0][0].message,/invalidated.*park changed/);assert.equal(old[0][1],null);
    h.monitor.wait({},(error,value)=>fresh.push([error,value]));
    staleTick();assert.equal(h.jobs[0].steps,0);assert.equal(fresh.length,0);
    h.flush();assert.equal(fresh.length,1);assert.equal(fresh[0][0],null);assert.equal(fresh[0][1].revision,1);
    assert.equal(fresh[0][1].marker,1);assert.equal(h.monitor.overview().revision,1);
});

test('geometry invalidation discards a completed report immediately',()=>{
    const h=harness();h.monitor.overview();h.flush();
    assert.equal(h.monitor.overview().status,'ok');h.monitor.invalidate('paths changed');
    assert.equal(h.monitor.ride(1).status,'checking');assert.equal(h.monitor.overview().status,'checking');assert.equal(h.jobs.length,2);
});

test('one subscriber throwing cannot prevent other subscribers receiving the audit',()=>{
    const h=harness();let delivered=0;
    h.monitor.wait({},()=>{throw Error('consumer failed');});
    h.monitor.wait({},()=>{delivered++;});h.flush();assert.equal(delivered,1);
});

test('pending access subscribers are bounded to 32 and all accepted waiters complete',()=>{
    const h=harness();let delivered=0;
    for(let i=0;i<32;i++)h.monitor.wait({},()=>{delivered++;});
    assert.throws(()=>h.monitor.wait({},()=>{}),/Too many pending access audits/);
    assert.equal(h.jobs.length,1);h.flush();assert.equal(delivered,32);
});

test('unsupported access arguments are rejected before scheduling work',()=>{
    for(const args of [[],{refresh:1},{maxPaths:1},{refresh:true,x:1}]){
        const h=harness();assert.throws(()=>h.monitor.wait(args,()=>{}),/optional boolean refresh/);assert.equal(h.jobs.length,0);
    }
});

test('inspector creation and execution failures become explicit unknown reports',()=>{
    for(const options of [{createError:'No map API'},{stepError:'Path API unavailable'},{resultError:'Result API unavailable'}]){
        const h=harness(options),values=[];
        h.monitor.wait({},(error,value)=>values.push([error,value]));h.flush();
        assert.equal(values.length,1);assert.equal(values[0][0],null);assert.equal(values[0][1].status,'unknown');
        assert.equal(values[0][1].complete,false);assert.match(values[0][1].unavailable.join(' '),/API/);
        assert.equal(h.monitor.overview().status,'unknown');
    }
});

test('leaving a playable context while the scan waits never produces a healthy report',()=>{
    const h=harness(),values=[];h.monitor.wait({},(error,value)=>values.push(value));
    h.context.mode='title';h.flush();assert.equal(h.jobs[0].steps,0);
    assert.equal(values[0].status,'unknown');assert.equal(values[0].complete,false);assert.match(values[0].unavailable[0],/no longer loaded/);
});

test('overview limits warning output to 64 while preserving total and omitted counts',()=>{
    const warnings=Array.from({length:70},(_,i)=>({code:'missing_path',ride:i}));
    const value=Monitor.summarize(report({status:'problems',warnings,checkedAt:123,revision:4}));
    assert.equal(value.warnings.length,64);assert.equal(value.warningCount,70);assert.equal(value.warningsOmitted,6);
    assert.equal(value.checkedAt,123);assert.equal(value.revision,4);assert.equal(value.detailsOperation,'path.access');
    assert.equal(warnings.length,70);
});

test('overview bounds local amenity sites and observations without folding them into access warnings',()=>{
    const sites=Array.from({length:70},(_,i)=>amenitySite(i)),observations=Array.from({length:74},(_,i)=>({code:'local_bench_shortfall',ride:i,site:'exit:'+i+':0'}));
    const local=amenities({sites,observations,summary:{sites:70,sitesWithShortfalls:70,unknownSites:0}}),before=JSON.stringify(local);
    const value=Monitor.summarize(report({amenities:local}));
    assert.equal(value.status,'ok');assert.equal(value.complete,true);assert.equal(value.warningCount,0);assert.equal(value.observationCount,0);
    assert.equal(value.amenities.status,'advisories');assert.equal(value.amenities.siteCount,70);assert.equal(value.amenities.sites.length,64);assert.equal(value.amenities.sitesOmitted,6);
    assert.equal(value.amenities.observationCount,74);assert.equal(value.amenities.observations.length,64);assert.equal(value.amenities.observationsOmitted,10);
    assert.equal(value.amenities.policy.benchThreshold,250);assert.equal(value.amenities.summary.sitesWithShortfalls,70);assert.equal(JSON.stringify(local),before);
});

test('ride-local amenities filter by ride before bounding and remain separate from structural health',()=>{
    const sites=[...Array.from({length:70},(_,i)=>amenitySite(2,{key:'exit:2:'+i})),amenitySite(1)],observations=[
        ...Array.from({length:70},(_,i)=>({code:'local_bench_shortfall',ride:2,site:'exit:2:'+i})),{code:'local_bin_shortfall',ride:1,site:'exit:1:0'}];
    const input=report({endpoints:[{ride:1,status:'healthy'},{ride:2,status:'healthy'}],amenities:amenities({sites,observations})});
    const first=Monitor.forRide(input,1);assert.equal(first.status,'ok');assert.equal(first.warningCount,0);assert.equal(first.amenities.status,'advisories');
    assert.equal(first.amenities.siteCount,1);assert.equal(first.amenities.sites.length,1);assert.equal(first.amenities.sites[0].ride,1);assert.equal(first.amenities.observationCount,1);assert.equal(first.amenities.observations[0].ride,1);
    const second=Monitor.forRide(input,2);assert.equal(second.amenities.siteCount,70);assert.equal(second.amenities.sitesOmitted,6);assert.equal(second.amenities.observationsOmitted,6);
});

test('a known local site stays useful when another ride has unknown amenity demand',()=>{
    const local=amenities({status:'unknown',complete:false,sites:[amenitySite(1),amenitySite(2,{status:'unknown',complete:false,deficits:{benches:null,bins:null}})],
        observations:[{code:'local_bench_shortfall',ride:1},{code:'local_amenities_unknown',ride:2}]});
    const input=report({endpoints:[{ride:1,status:'healthy'},{ride:2,status:'healthy'}],amenities:local});
    const known=Monitor.forRide(input,1);assert.equal(known.status,'ok');assert.equal(known.amenities.status,'advisories');assert.equal(known.amenities.complete,true);
    const unknown=Monitor.forRide(input,2);assert.equal(unknown.status,'ok');assert.equal(unknown.amenities.status,'unknown');assert.equal(unknown.amenities.complete,false);
});

test('missing, failed, checking and truncated amenity evidence cannot become a clear ride amenity report',()=>{
    for(const value of [undefined,{status:'unknown',complete:false,sites:[],observations:[],unavailable:['Amenity module unavailable']},
        amenities({status:'checking',complete:false,sites:[],observations:[]}),amenities({truncated:true})]){
        const input=report(value===undefined?{}:{amenities:value}),local=Monitor.forRide(input,1);
        assert.equal(local.status,'ok');assert.equal(local.complete,true);assert.equal(local.amenities.complete,false);
        assert.equal(local.amenities.status,value?.status==='checking'?'checking':'unknown');
    }
    const irrelevant=Monitor.forRide(report({amenities:amenities({status:'ok',sites:[],observations:[]})}),1);
    assert.equal(irrelevant.amenities.status,'not_applicable');assert.equal(irrelevant.amenities.complete,true);
});

test('cached local amenities become checking on invalidation and unknown on an audit failure',()=>{
    const h=harness({report:{amenities:amenities()}});assert.equal(h.monitor.overview().amenities.status,'checking');h.flush();
    assert.equal(h.monitor.overview().amenities.status,'advisories');assert.equal(h.monitor.ride(1).amenities.sites.length,1);
    h.monitor.invalidate('native furniture edited');assert.equal(h.monitor.overview().amenities.status,'checking');assert.equal(h.monitor.ride(1).amenities.status,'checking');h.flush();
    assert.equal(h.monitor.overview().amenities.status,'advisories');assert.equal(h.monitor.overview().revision,1);
    const broken=harness({stepError:'Native graph unavailable'});broken.monitor.overview();broken.flush();
    assert.equal(broken.monitor.overview().amenities.status,'unknown');assert.equal(broken.monitor.ride(1).amenities.complete,false);
});

test('ride summaries require recognized, resolved endpoints before returning ok',()=>{
    for(const endpoints of [[],[{ride:1,status:'unknown'}],[{ride:2,status:'healthy'}]]){
        const value=Monitor.forRide(report({endpoints}),1);assert.equal(value.status,'unknown');assert.equal(value.complete,false);
    }
    assert.equal(Monitor.forRide(report({complete:false}),1).status,'unknown');
    const value=Monitor.forRide(report({warnings:[{ride:1,code:'missing_path'},{ride:2,code:'wrong_queue'}],
        endpoints:[{ride:1,status:'unreachable'},{ride:2,status:'unreachable'}]}),1);
    assert.equal(value.status,'problems');assert.equal(value.warningCount,1);assert.equal(value.endpoints.length,1);
});

test('automatic client completion waits for access and preserves all existing park fields',async()=>{
    const config={token:'unused-test-token'},park={name:'Synthetic Park',cash:123},currency={configuredCode:'USD'};
    const reply={id:'park-request',ok:true,result:{session:'test-session',park,currency,paused:true,access:{status:'checking'}}};
    let calls=0;
    const result=await completeAccess(reply,config,async(givenConfig,request)=>{
        assert.equal(givenConfig,config);assert.equal(request.op,'path.access');assert.deepEqual(request.args,{});
        assert.match(request.id,/^[a-z0-9-]{36}$/i);calls++;return {ok:true,result:report({checkedAt:77})};
    });
    assert.equal(calls,1);assert.equal(result,reply);assert.equal(result.result.park,park);assert.equal(result.result.currency,currency);
    assert.equal(result.result.session,'test-session');assert.equal(result.result.paused,true);assert.equal(result.result.access.status,'ok');assert.equal(result.result.access.checkedAt,77);
});

test('automatic client completion preserves ride inspection and filters access to that ride',async()=>{
    const inspection={fleet:{configuredTrains:3}},reply={ok:true,result:{id:1,name:'Synthetic Ride',inspection,access:{status:'checking'}}};
    await completeAccess(reply,{},async()=>({ok:true,result:report()}));
    assert.equal(reply.result.inspection,inspection);assert.equal(reply.result.name,'Synthetic Ride');assert.equal(reply.result.access.status,'ok');
    assert.equal(reply.result.access.endpoints.length,1);assert.equal(reply.result.access.endpoints[0].ride,1);
});

test('automatic client completion shares one audit for a ride list and preserves unrelated fields',async()=>{
    const list=[{id:1,name:'One',price:[10],access:{status:'checking'}},{id:2,name:'Two',status:'closed',access:{status:'checking'}}],reply={ok:true,result:list};
    let calls=0;await completeAccess(reply,{},async()=>{calls++;return {ok:true,result:report()};});
    assert.equal(calls,1);assert.equal(reply.result,list);assert.deepEqual(list[0].price,[10]);assert.equal(list[1].status,'closed');
    assert.equal(list[0].access.status,'ok');assert.equal(list[1].access.status,'unknown');
});

test('automatic CLI park completion preserves local advisories alongside healthy access and global furniture',async()=>{
    const local=amenities(),furniture={status:'ok',complete:true,summary:{benches:12,bins:8}},reply={ok:true,result:{park:{name:'Synthetic'},paused:true,access:{status:'checking'}}};
    await completeAccess(reply,{},async()=>({ok:true,result:report({amenities:local,furniture})}));
    assert.equal(reply.result.access.status,'ok');assert.equal(reply.result.access.warningCount,0);assert.equal(reply.result.access.furniture.summary.benches,12);
    assert.equal(reply.result.access.amenities.status,'advisories');assert.equal(reply.result.access.amenities.sites[0].deficits.benches,7);assert.equal(reply.result.paused,true);
});

test('one automatic CLI audit scopes local findings to each ride and preserves unknown coverage explicitly',async()=>{
    const local=amenities({status:'unknown',complete:false,sites:[amenitySite(1),amenitySite(2,{status:'unknown',complete:false,deficits:{benches:null,bins:null}})],
        observations:[{code:'local_bench_shortfall',ride:1},{code:'local_amenities_unknown',ride:2}]});
    const list=[{id:1,name:'Known',access:{status:'checking'}},{id:2,name:'Unknown',access:{status:'checking'}}],reply={ok:true,result:list};let audits=0;
    await completeAccess(reply,{},async()=>{audits++;return {ok:true,result:report({endpoints:[{ride:1,status:'healthy'},{ride:2,status:'healthy'}],amenities:local})};});
    assert.equal(audits,1);assert(list.every(r=>r.access.status==='ok'));
    assert.equal(list[0].access.amenities.status,'advisories');assert.equal(list[1].access.amenities.status,'unknown');assert.equal(list[1].access.amenities.complete,false);
    assert(list.every(r=>r.access.amenities.sites.every(s=>s.ride===r.id)));assert(list.every(r=>r.access.amenities.observations.every(s=>s.ride===r.id)));
});

test('client completion avoids another audit when evidence is final or the initial request failed',async()=>{
    for(const reply of [{ok:false,error:'Authentication failed'},{ok:true,result:{name:'Park'}},{ok:true,result:{access:{status:'unknown'}}},
        {ok:true,result:[]},{ok:true,result:{access:{status:'ok'}}}]){
        assert.equal(await completeAccess(reply,{},()=>{throw Error('unexpected audit');}),reply);
    }
});

test('automatic audit errors and transport failures reach the client instead of hiding access checking',async()=>{
    const reply=()=>({ok:true,result:{access:{status:'checking'}}});
    await assert.rejects(completeAccess(reply(),{},async()=>({ok:false,error:'API mismatch'})),/Automatic access audit: API mismatch/);
    await assert.rejects(completeAccess(reply(),{},async()=>{throw Error('connection closed');}),/connection closed/);
});

function pluginHarness(){
    const bundle=fs.readFileSync(path.join(__dirname,'../dist/agent-bridge.js'),'utf8'),config=require('../bridge.config.json');
    let onConnection;const hooks={},timers=[],sent=[],socketHandlers={},store={};let serial=20000000;
    const listener={on:(name,fn)=>{onConnection=fn;return listener;},listen:()=>listener};
    const context={mode:'normal',apiVersion:124,paused:true,gameSpeed:0,
        sharedStorage:{get:key=>store[key],set:(key,value)=>{store[key]=value;}},subscribe:(name,fn)=>{hooks[name]=fn;},
        setTimeout:fn=>timers.push(fn)};
    vm.runInNewContext(bundle,{context,objectManager:{getAllObjects:()=>[]},map:{size:{x:2,y:2},rides:[],getTile:()=>({elements:[]})},
        network:{mode:'none',createListener:()=>listener},park:{name:'Fixture Park',cash:1000,messages:[]},scenario:{name:'Fixture'},date:{day:1},
        console:{log:()=>{}},registerPlugin:registration=>registration.main()});
    onConnection({on:(name,fn)=>{socketHandlers[name]=fn;},write:line=>sent.push(JSON.parse(line)),end:()=>{}});
    function request(op,args={},extra={}){const req={id:String(++serial),op,args,token:config.token,...extra};socketHandlers.data(JSON.stringify(req)+'\n');return {req,get reply(){return sent.find(item=>item.id===req.id);}};}
    function flush(){let left=100;while(timers.length&&left-->0)timers.shift()();assert(left>0);}
    return {request,flush,hooks,context,sent,timers};
}

test('bundled path.access authenticates and works without arming; park starts and completes the audit',()=>{
    const h=pluginHarness();
    assert.equal(h.request('path.access',{}, {token:'incorrect'}).reply.ok,false);assert.equal(h.timers.length,0);
    const park=h.request('park').reply;assert.equal(park.ok,true);assert.equal(park.result.access.status,'checking');assert.equal(park.result.park.name,'Fixture Park');
    const audit=h.request('path.access');assert.equal(audit.reply,undefined);h.flush();
    assert.equal(audit.reply.ok,true);assert.equal(audit.reply.result.status,'unknown');assert.equal(audit.reply.result.complete,false);
    const ready=h.request('park').reply;assert.equal(ready.result.access.status,'unknown');assert.equal(ready.result.paused,true);
    assert.equal(h.request('hello').reply.result.armed,false);
});

test('bundled map resize and successful native actions invalidate cached access',()=>{
    const h=pluginHarness();h.request('park');h.flush();
    let revision=h.request('park').reply.result.access.revision;
    for(const hook of ['map.resize','action.execute']){
        h.hooks[hook](hook==='action.execute'?{result:{error:0}}:undefined);
        const checking=h.request('park').reply.result.access;assert.equal(checking.status,'checking');assert.equal(checking.revision,++revision);h.flush();
    }
    h.hooks['action.execute']({result:{error:1}});assert.equal(h.request('park').reply.result.access.revision,revision);
});

test('bundled map changes revoke pending audit replies before the old scan can finish',()=>{
    const h=pluginHarness(),pending=h.request('path.access');assert.equal(pending.reply,undefined);
    h.hooks['map.change']();assert.equal(pending.reply.ok,false);assert.match(pending.reply.error,/invalidated/);
    h.flush();assert.equal(h.sent.filter(reply=>reply.id===pending.req.id).length,1);
    const fresh=h.request('park').reply.result.access;
    assert.equal(fresh.status,'unknown');assert.equal(fresh.complete,false);assert.equal(fresh.revision,1);
});
