/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const bundle=fs.readFileSync(path.join(__dirname,'../dist/agent-bridge.js'),'utf8');
const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../bridge.config.json'),'utf8'));
function harness(options={}){
 let connection,serial=0;
 const sent=[],calls=[],queries=[],timers=[],store={},hooks={};
 const rides=options.rides??[{id:15,type:20,status:'closed'}];
 const listener={on:(e,fn)=>{connection=fn;return listener;},listen:()=>listener};
 const context={mode:'normal',apiVersion:122,paused:false,gameSpeed:1,
  sharedStorage:{get:k=>store[k],set:(k,v)=>{store[k]=v;}},subscribe:(e,fn)=>{hooks[e]=fn;},
  getAllTrackSegments:()=>[],setTimeout:fn=>{timers.push(fn);},
  queryAction:(action,args,cb)=>{queries.push({action,args});cb(options.rejectQuery?{error:1,errorMessage:'Clearance rejected',cost:0}:{error:0,cost:100});},
  executeAction:(action,args,cb)=>{calls.push({action,args});cb({error:0,cost:100});}};
 vm.runInNewContext(bundle,{objectManager:{getObject:()=>null,getAllObjects:()=>[]},context,network:{mode:'none',createListener:()=>listener},map:{size:{x:128,y:128},rides,getRide:id=>rides.find(r=>r.id===id),getTile:()=>({elements:options.elements??[]})},park:{cash:10000},scenario:{},date:{},console:{log:()=>{}},registerPlugin:m=>m.main()});
 const events={};connection({on:(e,fn)=>{events[e]=fn;},write:s=>sent.push(JSON.parse(s)),end:()=>{}});
 function request(op,args={},extra={}){const req={id:'maze-test-'+(++serial),op,args,token:config.token,...extra};events.data(JSON.stringify(req)+'\n');return req;}
 function result(req){return sent.find(x=>x.id===req.id);}
 const session=result(request('hello')).result.session;
 function arm(){return result(request('arm',{}, {session}));}
 function flush(){let remaining=100;while(timers.length&&remaining--)timers.shift()();assert.ok(remaining>0);}
 return {request,result,session,arm,flush,calls,queries,events};
}
const tile={action:'mazeplacetrack',args:{x:2112,y:3328,z:96,ride:15,mazeEntry:65000}};
const cell={action:'mazesettrack',args:{x:2112,y:3344,z:96,direction:1,ride:15,mode:0,isInitialPlacement:false}};
test('exact pinned maze action schemas are exposed',()=>{const h=harness(),s=h.result(h.request('actions')).result;assert.deepEqual(s.mazeplacetrack,{x:'number',y:'number',z:'number',ride:'number',mazeEntry:'number'});assert.deepEqual(s.mazesettrack,{x:'number',y:'number',z:'number',direction:'number',ride:'number',mode:'number',isInitialPlacement:'boolean'});assert.equal(Object.keys(s).length,41);});
test('valid maze queries dispatch native commands without changing game',()=>{for(const a of [tile,cell]){const h=harness(),r=h.result(h.request('action.query',a));assert.equal(r.ok,true);assert.equal(r.result.error,0);assert.deepEqual(JSON.parse(JSON.stringify(h.queries[0])),a);assert.equal(h.calls.length,0);}});
test('maze construction requires arming and authentication',()=>{for(const extra of [{},{token:'wrong'}]){const h=harness(),r=h.result(h.request('action.execute',{...tile,maxCost:1000},{session:h.session,...extra}));assert.equal(r.ok,false);assert.equal(h.calls.length,0);assert.equal(h.queries.length,0);}});
test('maze guard rejects missing, wrong-type and open rides before native query',()=>{for(const rides of [[],[{id:15,type:15,status:'closed'}],[{id:15,type:20,status:'open'}]]){const h=harness({rides}),r=h.result(h.request('action.query',tile));assert.equal(r.ok,false);assert.equal(h.queries.length,0);}});
test('maze tile bounds and bitmask limits reject unsafe native arguments',()=>{for(const changes of [{x:-32},{x:4096},{y:4096},{x:2113},{y:3344},{z:97},{z:2048},{mazeEntry:-1},{mazeEntry:65536}]){const h=harness(),r=h.result(h.request('action.query',{...tile,args:{...tile.args,...changes}}));assert.equal(r.ok,false,JSON.stringify(changes));assert.equal(h.queries.length,0);}});
test('maze cell direction, mode and coordinate bounds reject unsafe native arguments',()=>{for(const changes of [{direction:-1},{direction:4},{mode:-1},{mode:3},{x:2113},{x:4096},{y:4096},{z:97},{isInitialPlacement:1}]){const h=harness(),r=h.result(h.request('action.query',{...cell,args:{...cell.args,...changes}}));assert.equal(r.ok,false,JSON.stringify(changes));assert.equal(h.queries.length,0);}});
test('maze actions reject arbitrary flags, missing and fractional fields',()=>{for(const args of [{...tile.args,flags:1},{...tile.args,mazeEntry:1.5},{x:2112,y:3328,z:96,ride:15}]){const h=harness(),r=h.result(h.request('action.query',{action:tile.action,args}));assert.equal(r.ok,false);assert.equal(h.queries.length,0);}});
test('budget rejection and native clearance failure preserve game state',()=>{for(const options of [{rejectQuery:true},{}]){const h=harness(options);h.arm();const req=h.request('action.execute',{...tile,maxCost:50},{session:h.session});h.flush();const r=h.result(req);assert.equal(r.result.state,'partial');assert.equal(h.calls.length,0);}});
test('completed mutation receipts prevent duplicate maze construction',()=>{const h=harness();h.arm();const req=h.request('action.execute',{...tile,maxCost:100},{session:h.session});h.flush();assert.equal(h.result(req).result.state,'completed');h.events.data(JSON.stringify(req)+'\n');h.flush();assert.equal(h.calls.length,1);});
test('STOP interrupts maze batches between native actions',()=>{const h=harness();h.arm();const req=h.request('batch.execute',{actions:[tile,tile],maxCost:1000},{session:h.session});h.request('stop');h.flush();assert.equal(h.result(req).result.state,'stopped');assert.ok(h.calls.length<=1);});

test('map inspection reads native maze masks without arming or mutations',()=>{
 let reads=0;
 const element={type:'track',ride:15,trackType:101,baseZ:96};
 Object.defineProperty(element,'mazeEntry',{get:()=>{reads++;return 9299;}});
 const h=harness({elements:[element]}),r=h.result(h.request('map',{x:66,y:104}));
 assert.equal(r.ok,true);assert.equal(r.result[0].elements[0].mazeEntry,9299);
 assert.equal(reads,1);assert.equal(h.queries.length,0);assert.equal(h.calls.length,0);
});

test('non-maze elements never access the maze-only native getter',()=>{
 for(const [element,rides] of [
  [{type:'surface',baseZ:96},[]],
  [{type:'track',ride:15},[{id:15,type:15,status:'closed'}]],
  [{type:'track',ride:15},[]]
 ]){
  Object.defineProperty(element,'mazeEntry',{get:()=>{assert.fail('Non-maze getter accessed');}});
  const h=harness({elements:[element],rides}),r=h.result(h.request('map',{x:66,y:104}));
  assert.equal(r.ok,true);assert.equal(Object.hasOwn(r.result[0].elements[0],'mazeEntry'),false);
 }
});
