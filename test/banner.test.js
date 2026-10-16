/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const bundle=fs.readFileSync(path.join(__dirname,'../dist/agent-bridge.js'),'utf8'),config=require('../bridge.config.json'),palette=require('../generated/colours.json');
const place={action:'bannerplace',args:{x:320,y:352,z:64,direction:2,object:7,primaryColour:3}};
const style=(parameter=1,id=17)=>({action:'bannersetstyle',args:{id,type:2,parameter}});
const remove={action:'bannerremove',args:{x:320,y:352,z:80,direction:2}};
const withPlace=extra=>({...place,args:{...place.args,...extra}});

function nativeGetters(values){const out={};for(const k of Object.keys(values))Object.defineProperty(out,k,{get:()=>values[k]});return out;}
function harness(options={}){
    let connection,serial=0;const sent=[],queries=[],calls=[],timers=[],events={},store=options.store||{},objects=options.objects||[{type:'banner',index:7,identifier:'test.banner',name:'Banner'}];
    const banner=options.banner||{type:'banner',baseZ:80,clearanceZ:96,direction:2,object:7,isGhost:false,isHidden:false,bannerIndex:17,isNoEntry:false};
    let placed=options.placed!==false;
    const objectManager={getObject:(type,index)=>type==='banner'?objects.find(o=>o.index===index):null,getAllObjects:type=>type==='banner'?objects:[]};
    const listener={on:(e,fn)=>{connection=fn;return listener;},listen:()=>listener};
    const context={mode:'normal',apiVersion:124,paused:true,gameSpeed:1,
        sharedStorage:{get:k=>store[k],set:(k,v)=>{store[k]=JSON.parse(JSON.stringify(v));}},subscribe:()=>{},setTimeout:fn=>timers.push(fn),
        queryAction:(action,args,callback)=>{
            queries.push({action,args:JSON.parse(JSON.stringify(args))});
            if(options.onQuery)options.onQuery(action,args,objects);
            if(options.queryError)return callback(options.queryError);
            // A small query stub tests that native refusals are honoured. It is
            // not native clearance or one-way guest-navigation evidence.
            if(action==='bannerplace'&&args.direction===1)return callback({error:1,errorMessage:'Can only be built across paths'});
            callback({cost:action==='bannerplace'?20:0});
        },
        executeAction:(action,args,callback)=>{
            calls.push({action,args:JSON.parse(JSON.stringify(args))});
            if(options.neverReply)return;
            if(action==='bannerplace'){placed=true;return callback({cost:20,bannerIndex:17});}
            if(action==='bannersetstyle')banner.isNoEntry=!!args.parameter;
            if(action==='bannerremove')placed=false;
            callback({cost:0});
        }};
    const map={size:{x:32,y:32},rides:[],getTile:(x,y)=>({elements:x===10&&y===11&&placed?[nativeGetters(banner)]:[]})};
    vm.runInNewContext(bundle,{context,map,objectManager,park:{cash:10000},scenario:{},date:{},network:{mode:'none',createListener:()=>listener},console:{log:()=>{}},registerPlugin:p=>p.main()});
    connection({on:(e,fn)=>{events[e]=fn;},write:s=>sent.push(JSON.parse(s)),end:()=>{}});
    function request(op,args={},extra={}){const req={id:'banner-test-'+(++serial),op,args,token:config.token,...extra};events.data(JSON.stringify(req)+'\n');return req;}
    function result(req){return sent.find(s=>s.id===req.id);}
    function flush(){let remaining=5000;while(timers.length&&--remaining)timers.shift()();assert(remaining>0);}
    const session=result(request('hello')).result.session;
    return {request,result,flush,session,arm:()=>request('arm',{}, {session}),queries,calls,store,events,sent,context,objects,banner};
}
function query(h,action=place){return h.result(h.request('action.query',action));}
function execute(h,action=place){h.arm();const req=h.request('action.execute',{...action,maxCost:100},{session:h.session});h.flush();return {req,reply:h.result(req)};}

test('only the three intended native banner actions and exact schemas are exposed',()=>{
    const h=harness(),actions=h.result(h.request('actions')).result;
    assert.deepEqual(actions.bannerplace,{x:'number',y:'number',z:'number',direction:'number',object:'number',primaryColour:'number'});
    assert.deepEqual(actions.bannersetstyle,{id:'number',type:'number',parameter:'number'});
    assert.deepEqual(actions.bannerremove,{x:'number',y:'number',z:'number',direction:'number'});
    assert.equal(actions.bannersetname,undefined);assert.equal(actions.bannersetcolour,undefined);
});

test('banner object catalog and map IDs use native getters without inventing allowed-edge masks',()=>{
    const h=harness({objects:[nativeGetters({type:'banner',index:7,identifier:'test.banner',name:'Banner'})]});
    const objects=h.result(h.request('objects',{type:'banner'})).result;
    assert.deepEqual(objects.map(o=>[o.type,o.index,o.identifier]),[['banner',7,'test.banner']]);
    h.banner.isNoEntry=true;
    const element=h.result(h.request('map',{x:10,y:11})).result[0].elements[0];
    assert.equal(element.bannerIndex,17);assert.equal(element.isNoEntry,true);assert.equal(element.allowedEdges,null);
    assert.match(element.allowedEdgesUnavailable,/API 124.*path.inspect.*permittedEdges/);
});

test('read-only banner queries do not arm or execute and native placement retains its returned ID',()=>{
    const h=harness({placed:false});assert.equal(query(h).ok,true);assert.equal(h.calls.length,0);
    assert.match(h.result(h.request('action.execute',{...place,maxCost:100},{session:h.session})).error,/read-only/);
    const {reply}=execute(h);assert.equal(reply.result.state,'completed');assert.equal(reply.result.completed[0].result.bannerIndex,17);
    assert.deepEqual(h.calls,[place]);assert.equal(reply.result.spent,20);
});

test('no-entry enable and disable use native style type 2 and keep getter-backed map state read-only',()=>{
    const h=harness();for(const parameter of [1,0]){
        assert.equal(execute(h,style(parameter)).reply.result.state,'completed');
        const element=h.result(h.request('map',{x:10,y:11})).result[0].elements[0];assert.equal(element.isNoEntry,!!parameter);
    }
    assert.deepEqual(h.calls,[style(1),style(0)]);
});

test('banner removal uses the banner element base rather than the original path placement height',()=>{
    const h=harness(),{reply}=execute(h,remove);assert.equal(reply.result.state,'completed');assert.deepEqual(h.calls,[remove]);
    assert.equal(h.result(h.request('map',{x:10,y:11})).result[0].elements.length,0);
});

test('unsupported styles, wrapped IDs and nonboolean no-entry parameters cannot reach native actions',()=>{
    for(const args of [{type:0},{type:1},{type:3},{type:258},{parameter:-1},{parameter:2},{parameter:256},{id:-1},{id:65535},{id:65536}]){
        const h=harness(),action={action:'bannersetstyle',args:{...style().args,...args}};
        assert.equal(query(h,action).ok,false);assert.equal(h.queries.length,0);assert.equal(h.calls.length,0);
    }
});

test('banner geometry, direction, object family and palette reject wrapped or misaligned inputs',()=>{
    for(const args of [{x:321},{y:-32},{x:1024},{z:65},{z:2016},{direction:255},{direction:4},{object:255},{object:65535},{object:65543},{primaryColour:-1},{primaryColour:palette.maxId+1}]){
        const h=harness();assert.equal(query(h,withPlace(args)).ok,false,JSON.stringify(args));assert.equal(h.queries.length,0);assert.equal(h.calls.length,0);
    }
    for(const objects of [[],[{type:'wall',index:7}],[{type:'banner',index:6}]]){
        const h=harness({objects});assert.equal(query(h).ok,false);assert.equal(h.queries.length,0);
    }
});

test('highest valid banner-family slot remains available with normal engine query',()=>{
    const h=harness({objects:[{type:'banner',index:254}]});assert.equal(execute(h,withPlace({object:254})).reply.result.state,'completed');assert.equal(h.calls.length,1);
});

test('normal native ownership and path-edge refusals stop construction before execution',()=>{
    for(const action of [place,withPlace({direction:1})]){
        const h=harness(action===place?{queryError:{error:1,errorMessage:'Land not owned by park'}}:{}),{reply}=execute(h,action);
        assert.equal(reply.result.state,'partial');assert.equal(reply.result.detail.phase,'query');assert.equal(h.calls.length,0);
    }
});

test('object identity and no-entry semantics are rechecked after native query returns',()=>{
    const unloaded=harness({onQuery:(action,args,objects)=>{objects.length=0;}});
    assert.equal(execute(unloaded).reply.result.state,'partial');assert.equal(unloaded.calls.length,0);
    const changed=harness({onQuery:(action,args)=>{args.type=0;}});
    assert.equal(execute(changed,style()).reply.result.state,'partial');assert.equal(changed.calls.length,0);
});

test('authentication, API compatibility and argument flags cannot bypass banner guards',()=>{
    const h=harness();assert.equal(h.result(h.request('action.query',place,{token:'wrong'})).ok,false);
    assert.equal(query(h,{...place,args:{...place.args,flags:128}}).ok,false);
    h.context.apiVersion=125;assert.equal(query(h).ok,false);assert.equal(h.queries.length,0);
});

test('duplicate completed banner requests return the durable receipt without another native action',()=>{
    const h=harness(),{req,reply}=execute(h);h.events.data(JSON.stringify(req)+'\n');
    assert.equal(h.calls.length,1);assert.equal(h.sent.at(-1).result.state,'completed');assert.equal(h.sent.at(-1).result.completed[0].result.bannerIndex,17);
    assert.equal(reply.result.id,req.id);assert.equal(h.store['agent-bridge.receipts.v1'][req.id].state,'completed');
    req.args.args.direction=0;h.events.data(JSON.stringify(req)+'\n');assert.equal(h.sent.at(-1).ok,false);assert.equal(h.calls.length,1);
});

test('unresolved banner dispatch is journaled and cannot be replayed after restart',()=>{
    const h=harness({neverReply:true}),{req}=execute(h);assert.equal(h.calls.length,1);
    const receipt=h.store['agent-bridge.receipts.v1'][req.id];assert.equal(receipt.state,'started');assert.equal(receipt.inFlight.action,'bannerplace');
    const restarted=harness({store:h.store});restarted.events.data(JSON.stringify(req)+'\n');
    assert.equal(restarted.calls.length,0);assert.equal(restarted.sent.at(-1).result.state,'started');
});
