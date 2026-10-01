/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const data=require('../../generated/track-support.json'),names=require('../../generated/track-names.json'),fixtures=require('../fixtures/segments.json');
function nativeObject(type,index=0){
    const spriteGroups={};data.requiredSprites.flat().forEach(r=>{spriteGroups[r.group]={spriteNumImages:32};});
    return {index,type:'ride',rideType:[type],defaultVehicle:0,vehicles:Array.from({length:4},()=>({carVisual:0,flags:0,spriteGroups:{...spriteGroups}}))};
}
function nativeSegment(id){
    const s=data.segments[id];return s&&{...fixtures[id],type:id,trackGroup:s.trackGroup,allowsChainLift:s.flags.allowLiftHill,isSteepUp:s.flags.isSteepUp};
}
function harness(options={}){
    const type=options.type??15,objects=options.objects??[nativeObject(type)],rides=options.rides??[{id:1,type,object:objects[0],status:'closed'}];
    const queries=[],calls=[],timers=[],sent=[],store=options.store||{},events={};let connect,serial=0;
    const listener={on:(e,f)=>{connect=f;return listener;},listen:()=>listener};
    const context={mode:'normal',apiVersion:122,subscribe:()=>{},sharedStorage:{get:k=>store[k],set:(k,v)=>{store[k]=JSON.parse(JSON.stringify(v));}},setTimeout:fn=>timers.push(fn),
        getTrackSegment:options.getTrackSegment||nativeSegment,getAllTrackSegments:()=>data.segments.map(s=>nativeSegment(s.id)),
        queryAction:(action,args,cb)=>{queries.push({action,args:{...args}});if(options.onQuery)options.onQuery({objects,rides,context});cb(options.rejectQuery?{error:1,errorMessage:'Clearance rejected'}:{cost:10});},
        executeAction:(action,args,cb)=>{calls.push({action,args:{...args}});if(action==='ridecreate'){rides.push({id:12,type:args.rideType,object:objects.find(o=>o.index===args.rideObject),status:'closed'});cb({cost:10,ride:12});}else cb({cost:10});if(options.onExecute)options.onExecute({objects,rides,context});}};
    const config=require('../../bridge.config.json');
    vm.runInNewContext(fs.readFileSync(require.resolve('../../dist/agent-bridge.js'),'utf8'),{context,objectManager:{getObject:(family,index)=>objects.find(o=>o.index===index),getAllObjects:()=>objects},map:{size:{x:128,y:128},rides,getRide:id=>rides.find(r=>r.id===id)},network:{mode:'none',createListener:()=>listener},park:{research:{isObjectResearched:()=>options.researched!==false}},scenario:{},date:{},console:{log:()=>{}},registerPlugin:p=>p.main()});
    connect({on:(e,f)=>{events[e]=f;},write:s=>sent.push(JSON.parse(s)),end:()=>{}});
    function request(op,args={},extra={}){const req={id:'track-test-'+(++serial),op,args,token:config.token,...extra};events.data(JSON.stringify(req)+'\n');return req;}
    function result(req){return sent.find(r=>r.id===req.id);}
    function flush(){let cap=3000;while(timers.length&&--cap)timers.shift()();assert.ok(cap>0);}
    const session=result(request('hello')).result.session;
    return {request,result,flush,arm:()=>request('arm',{}, {session}),session,queries,calls,objects,rides,context,sent,store,events};
}
const place=(name='flat',changes={})=>({action:'trackplace',args:{x:2048,y:2048,z:64,direction:0,ride:1,rideType:15,trackType:names[name],brakeSpeed:8,colour:0,seatRotation:0,trackPlaceFlags:0,isFromTrackDesign:false,...changes}});
const query=(h,a)=>h.result(h.request('action.query',a));
function execute(h,a){h.arm();const req=h.request('action.execute',{...a,maxCost:1000},{session:h.session});h.flush();return h.result(req);}
module.exports={harness,nativeObject,nativeSegment,place,query,execute,data,names};
