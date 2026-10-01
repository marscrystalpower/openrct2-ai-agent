/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const bundle=fs.readFileSync(path.join(__dirname,'../dist/agent-bridge.js'),'utf8');
const config=require('../bridge.config.json');
function pathObjects(){return {
    footpath:[{type:'footpath',index:6,identifier:'legacy-path'}],
    footpath_surface:[{type:'footpath_surface',index:5,identifier:'modern-path',flags:0},{type:'footpath_surface',index:7,identifier:'modern-queue',flags:8}],
    footpath_railings:[{type:'footpath_railings',index:3,identifier:'modern-railings'}]
};}
function harness(options={}){
    let connection,serial=0;const sent=[],calls=[],queries=[],timers=[],store={},objects=options.objects||pathObjects();
    const objectManager={getObject:options.getObject||((type,index)=>(objects[type]||[]).find(o=>o.index===index)||null),getAllObjects:type=>objects[type]||[]};
    const listener={on:(e,fn)=>{connection=fn;return listener;},listen:()=>listener};
    const context={mode:'normal',apiVersion:122,sharedStorage:{get:k=>store[k],set:(k,v)=>{store[k]=JSON.parse(JSON.stringify(v));}},subscribe:()=>{},setTimeout:fn=>{timers.push(fn);},
        queryAction:(action,args,cb)=>{queries.push({action,args:JSON.parse(JSON.stringify(args))});if(options.onQuery)options.onQuery(objects);cb(options.rejectQuery?{error:1,errorMessage:'Clearance rejected'}:{cost:10});},
        executeAction:(action,args,cb)=>{calls.push({action,args:JSON.parse(JSON.stringify(args))});cb({cost:10});}};
    vm.runInNewContext(bundle,{context,objectManager,network:{mode:'none',createListener:()=>listener},map:{size:{x:128,y:128},rides:[],getTile:()=>({elements:options.elements||[]})},park:{cash:10000},scenario:{},date:{},console:{log:()=>{}},registerPlugin:m=>m.main()});
    const events={};connection({on:(e,fn)=>{events[e]=fn;},write:s=>sent.push(JSON.parse(s)),end:()=>{}});
    function request(op,args={},extra={}){const req={id:'path-test-'+(++serial),op,args,token:config.token,...extra};events.data(JSON.stringify(req)+'\n');return req;}
    function result(req){return sent.find(r=>r.id===req.id);}
    function flush(){let remaining=100;while(timers.length&&remaining--)timers.shift()();assert.ok(remaining>0);}
    const session=result(request('hello')).result.session;
    return {request,result,flush,session,arm:()=>request('arm',{}, {session}),objects,calls,queries,events,sent};
}
const place={action:'footpathplace',args:{x:2048,y:2048,z:64,direction:255,object:5,railingsObject:3,slopeType:0,slopeDirection:0,constructFlags:0}};
const withArgs=changes=>({...place,args:{...place.args,...changes}});
const legacy=withArgs({object:6,railingsObject:65535,constructFlags:2});
function query(h,action=place){return h.result(h.request('action.query',action));}
function execute(h,action=place){h.arm();const req=h.request('action.execute',{...action,maxCost:100},{session:h.session});h.flush();return h.result(req);}

test('pinned path schema keeps native object, railings and constructFlags fields',()=>{
    const h=harness(),schema=h.result(h.request('actions')).result.footpathplace;
    assert.deepEqual(schema,{x:'number',y:'number',z:'number',direction:'number',object:'number',railingsObject:'number',slopeType:'number',slopeDirection:'Direction',constructFlags:'number'});
});
test('modern regular and queue paths query and execute with unchanged native arguments',()=>{
    for(const action of [place,withArgs({object:7,constructFlags:1})]){
        const h=harness();assert.equal(query(h,action).ok,true);assert.equal(h.calls.length,0);
        assert.equal(execute(h,action).result.state,'completed');assert.deepEqual(h.calls,[action]);assert.deepEqual(h.queries,[action,action]);
    }
});
test('valid legacy paths and queues use combined objects with ignored railings',()=>{
    for(const constructFlags of [2,3])for(const railingsObject of [0,3,65535]){
        const action=withArgs({object:6,constructFlags,railingsObject}),h=harness();
        h.objects.footpath_surface=[];h.objects.footpath_railings=[];
        assert.equal(query(h,action).ok,true);assert.equal(execute(h,action).result.state,'completed');assert.deepEqual(h.calls,[action]);
    }
});
test('modern surfaces cannot be sent as legacy objects or legacy objects as modern surfaces',()=>{
    for(const action of [withArgs({constructFlags:2}),withArgs({object:7,constructFlags:3}),withArgs({object:6}),withArgs({object:6,constructFlags:1})]){
        const h=harness(),reply=query(h,action);assert.equal(reply.ok,false);assert.match(reply.error,/not loaded as footpath/);
        assert.equal(h.queries.length,0);assert.equal(h.calls.length,0);
    }
});
test('overlapping numeric indices resolve only within the explicit flag-selected family',()=>{
    const h=harness();h.objects.footpath.push({type:'footpath',index:5});
    assert.equal(query(h).ok,true);assert.equal(query(h,withArgs({constructFlags:2})).ok,true);
    // An overlapping legacy entry must not rescue an unloaded modern surface.
    h.objects.footpath_surface=[];
    assert.equal(query(h).ok,false);assert.equal(query(h,withArgs({constructFlags:2})).ok,true);assert.equal(h.queries.length,3);
});
test('the highest valid path-family slot 254 remains constructible',()=>{
    for(const type of ['footpath','footpath_surface','footpath_railings']){
        const h=harness();h.objects[type].push({type,index:254,flags:0});
        const args=type==='footpath'?{object:254,constructFlags:2}:type==='footpath_surface'?{object:254}:{railingsObject:254};
        assert.equal(execute(h,withArgs(args)).result.state,'completed');assert.equal(h.calls.length,1);
    }
});
test('native-style prototype getters provide object identities, queue flags and catalog fields',()=>{
    const h=harness();
    for(const type of Object.keys(h.objects))h.objects[type]=h.objects[type].map(values=>{
        const prototype={};for(const key of Object.keys(values))Object.defineProperty(prototype,key,{get:()=>values[key]});
        return Object.create(prototype);
    });
    for(const action of [place,withArgs({object:7,constructFlags:1}),legacy])assert.equal(execute(h,action).result.state,'completed');
    const surfaces=h.result(h.request('objects',{type:'footpath_surface'})).result;
    assert.deepEqual(surfaces.map(o=>[o.type,o.index,o.flags,o.isQueue]),[['footpath_surface',5,0,false],['footpath_surface',7,8,true]]);
});
test('unsupported and uint8-wrapped construction flags are rejected before native query',()=>{
    for(const constructFlags of [-1,-254,4,8,255,256,258,65536,1.5,null]){
        const h=harness(),reply=query(h,withArgs({constructFlags}));assert.equal(reply.ok,false,String(constructFlags));assert.equal(h.queries.length,0);
    }
});
test('path object IDs reject missing, sentinel, out-of-range and uint16-wrapped references',()=>{
    for(const constructFlags of [0,2])for(const object of [-1,0,255,65535,65536,65541,1.5,null]){
        const h=harness();assert.equal(query(h,withArgs({constructFlags,object})).ok,false,JSON.stringify({constructFlags,object}));assert.equal(h.queries.length,0);
    }
});
test('modern railings must be loaded railings objects rather than a surface or legacy index',()=>{
    for(const railingsObject of [-1,0,5,6,255,65535,65536,65539,1.5,null]){
        const h=harness(),reply=query(h,withArgs({railingsObject}));assert.equal(reply.ok,false,String(railingsObject));assert.equal(h.queries.length,0);
    }
});
test('legacy ignored railings still reject wrapping and malformed numbers',()=>{
    for(const railingsObject of [-1,65536,1.5,null]){
        const h=harness();assert.equal(query(h,withArgs({...legacy.args,railingsObject})).ok,false);assert.equal(h.queries.length,0);
    }
});
test('loaded object type and index must match the requested family and slot',()=>{
    for(const returned of [{type:'footpath',index:5},{type:'footpath_surface',index:4},{index:5}]){
        const h=harness({getObject:()=>returned});assert.equal(query(h).ok,false);assert.equal(h.queries.length,0);
    }
});
test('modern queue status uses surface flag bit 3 and must match action bit 0',()=>{
    for(const flags of [0,4,16,20,8,12,24,28])for(const constructFlags of [0,1]){
        const h=harness();h.objects.footpath_surface[0].flags=flags;
        const expected=!!(flags&8)===!!constructFlags,reply=query(h,withArgs({constructFlags}));
        assert.equal(reply.ok,expected,JSON.stringify({flags,constructFlags}));assert.equal(h.queries.length,expected?1:0);
        if(!expected)assert.match(reply.error,/queue flag does not match/);
    }
});
test('missing, unreadable and malformed queue metadata fails closed',()=>{
    for(const flags of [undefined,null,-1,256,1.5,'8']){
        const h=harness();h.objects.footpath_surface[0].flags=flags;const reply=query(h);
        assert.equal(reply.ok,false);assert.match(reply.error,/Cannot verify.*queue/);assert.equal(h.queries.length,0);
    }
    const h=harness();Object.defineProperty(h.objects.footpath_surface[0],'flags',{get:()=>{throw Error('unavailable');}});
    assert.match(query(h).error,/Cannot verify.*queue/);assert.equal(h.queries.length,0);
});
test('unavailable object lookup fails closed',()=>{
    const h=harness({getObject:()=>{throw Error('Object manager unavailable');}});
    assert.equal(query(h).ok,false);assert.equal(execute(h).result.state,'partial');assert.equal(h.queries.length,0);assert.equal(h.calls.length,0);
});
for(const op of ['action.execute','batch.execute']){
    test(op+' rejects invisible-path family mismatch even when mock native query would accept it',()=>{
        const h=harness();h.arm();const invalid=withArgs({constructFlags:2});
        const req=h.request(op,{...(op==='action.execute'?invalid:{actions:[invalid,place]}),maxCost:100},{session:h.session});h.flush();
        const receipt=h.result(req).result;assert.equal(receipt.state,'partial');assert.equal(receipt.spent,0);assert.equal(receipt.completed.length,0);
        assert.match(receipt.detail,/not loaded as footpath/);assert.equal(receipt.inFlight,undefined);assert.equal(h.queries.length,0);assert.equal(h.calls.length,0);
    });
}
test('live object families and queue flags are rechecked after native query before execution',()=>{
    for(const onQuery of [o=>{o.footpath_surface=[];},o=>{o.footpath_railings=[];},o=>{o.footpath_surface[0].flags=8;}]){
        const h=harness({onQuery}),reply=execute(h);assert.equal(reply.result.state,'partial');assert.equal(reply.result.inFlight,undefined);
        assert.equal(h.queries.length,1);assert.equal(h.calls.length,0);
    }
    const h=harness({onQuery:o=>{o.footpath=[];}});assert.equal(execute(h,legacy).result.state,'partial');assert.equal(h.calls.length,0);
});
test('batch stops on stale path objects between steps, preserving completed receipt and cost',()=>{
    const h=harness();h.arm();const req=h.request('batch.execute',{actions:[place,place],maxCost:100},{session:h.session});
    h.objects.footpath_railings=[];h.flush();const receipt=h.result(req).result;
    assert.equal(receipt.state,'partial');assert.equal(receipt.completed.length,1);assert.equal(receipt.spent,10);assert.equal(h.calls.length,1);assert.equal(h.queries.length,1);
});
test('failed family validation receipt cannot replay after missing object becomes loaded',()=>{
    const h=harness();h.arm();const req=h.request('action.execute',{...withArgs({constructFlags:2}),maxCost:100},{session:h.session});h.flush();
    h.objects.footpath.push({type:'footpath',index:5});h.events.data(JSON.stringify(req)+'\n');h.flush();
    assert.equal(h.sent.at(-1).result.state,'partial');assert.equal(h.calls.length,0);
    assert.equal(execute(h,withArgs({constructFlags:2})).result.state,'completed');assert.equal(h.calls.length,1);
});
test('native clearance rejection remains effective for valid path references',()=>{
    const h=harness({rejectQuery:true}),reply=execute(h);assert.equal(reply.result.state,'partial');assert.equal(reply.result.detail.phase,'query');assert.equal(h.calls.length,0);
});
test('path removal remains available when no path objects or research can be read',()=>{
    const h=harness({objects:{}}),remove={action:'footpathremove',args:{x:2048,y:2048,z:64}};
    assert.equal(query(h,remove).ok,true);assert.equal(execute(h,remove).result.state,'completed');assert.deepEqual(h.calls,[remove]);
});
test('path catalogs expose native families, sparse actual indices and queue flags without arming',()=>{
    const h=harness();
    for(const type of ['footpath','footpath_surface','footpath_railings']){
        const reply=h.result(h.request('objects',{type}));assert.equal(reply.ok,true);
        assert.deepEqual(reply.result.map(o=>[o.type,o.index]),h.objects[type].map(o=>[o.type,o.index]));
    }
    const surfaces=h.result(h.request('objects',{type:'footpath_surface'})).result;
    assert.equal(surfaces[0].flags,0);assert.equal(surfaces[0].isQueue,false);assert.equal(surfaces[1].flags,8);assert.equal(surfaces[1].isQueue,true);
    h.objects.footpath_surface[0].flags=undefined;
    assert.equal(h.result(h.request('objects',{type:'footpath_surface'})).result[0].isQueue,null);assert.equal(h.calls.length,0);
});
test('map reads back legacy and modern references without conflating object namespaces',()=>{
    const elements=[{type:'footpath',object:6,surfaceObject:null,railingsObject:null,isQueue:true},
        {type:'footpath',object:null,surfaceObject:5,railingsObject:3,isQueue:false}];
    const h=harness({elements}),reply=h.result(h.request('map',{x:64,y:64}));assert.equal(reply.ok,true);
    assert.deepEqual(reply.result[0].elements,elements.map((el,elementIndex)=>({elementIndex,...el})));assert.equal(h.calls.length,0);
});
