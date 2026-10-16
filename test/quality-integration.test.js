/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const support=require('../generated/track-support.json'),config=require('../bridge.config.json');
const pricingSupport=require('../generated/pricing-support.json'),{completeAccess}=require('../cli');
const bundle=fs.readFileSync(path.join(__dirname,'../dist/agent-bridge.js'),'utf8');
const byName=Object.fromEntries(support.segments.map(s=>[s.name,s]));
// Synthetic native-getter/iterator boundary, not a physical circuit simulation.
function harness(options={}){
 const specs=['endStation',{name:'up25',chain:true},'up25ToRightBank','bankedRightQuarterTurn5Tiles','rightBank','rightBankToFlat','flatToDown25','onRidePhoto','brakes','brakes','brakes','brakes'];
 const tiles=new Map(),cells=[];let z=128;
 specs.forEach((raw,index)=>{
  const spec=typeof raw==='string'?{name:raw}:raw,native=byName[spec.name],position={x:64+index*64,y:64,z,direction:0};
  const rise=native.endSlope===support.trackPitches.up25?16:native.beginSlope===support.trackPitches.up25&&native.endSlope===0?8:0;
  const segment={...native,type:native.id,beginZ:0,endZ:rise,elements:[{x:0,y:0,z:0}],length:32,isBankedTurn:native.flags.isBankedTurn};
  const track={type:'track',ride:0,trackType:native.id,station:index===0?0:null,sequence:0,direction:0,baseZ:z,isGhost:false,hasChainLift:!!spec.chain};
  tiles.set(position.x/32+',2',{elements:[track]});cells.push({position,segment});z+=rise;
 });
 const pathTile={type:'footpath',baseZ:64,clearanceZ:96,isGhost:false,isQueue:false,isWide:false,slopeDirection:null,edges:0,
  isBlockedByVehicle:false,addition:options.brokenLamp?0:null,additionStatus:255,isAdditionBroken:!!options.brokenLamp,isAdditionFull:null,isAdditionGhost:false};
 tiles.set('1,1',{elements:[pathTile]});
 const object={type:'ride',index:0,identifier:'synthetic.ride.wooden',shopItem:255,shopItemSecondary:255,rideType:[52]};
 const ride={id:0,type:52,name:'Synthetic Coaster',status:'open',classification:'ride',rideTime:102,flags:35,price:[100,10],vehicles:[0],mode:1,liftHillSpeed:5,stations:[{start:cells[0].position,length:5}],object};
 const lamp={type:'footpath_addition',index:0,identifier:'rct2.footpath_item.lamp1',name:'Lamp'};
 const rideObjects=[object],rides=[ride],furnitureObjects=[lamp],publicPaths=new Map(),bannerMasks=new WeakMap();
 function setAddition(x,index){const p=publicPaths.get(x);assert(p,'missing fixture path '+x);p.addition=index;p.isAdditionBroken=false;p.isAdditionGhost=false;p.additionStatus=255;p.isAdditionFull=index===2?false:null;}
 if(options.localAmenities){
  ride.nausea=options.nausea===undefined?823:options.nausea;
  furnitureObjects.push({type:'footpath_addition',index:1,identifier:'rct2.footpath_item.bench1',name:'Bench'},
   {type:'footpath_addition',index:2,identifier:'rct2.footpath_item.litter1',name:'Bin'});
  // Gate at (1,1), a real public path line, a healthy entrance/exit, and two
  // healthy shop doors. Existing benches/bins are well beyond the local exit
  // and food-counter search radii, but remain in the same public network.
  for(let x=0;x<32;x++)if(x!==1){const p={...pathTile,addition:null,isAdditionBroken:null,isAdditionGhost:null,isAdditionFull:null,edges:x===0?4:x===31?1:5};publicPaths.set(x,p);tiles.set(x+',1',{elements:[p]});}
  const gate=(object,x,rideId=65535)=>({type:'entrance',object,sequence:0,direction:object===2?2:3,baseZ:64,clearanceZ:96,isGhost:false,ride:rideId,station:0});
  tiles.set('1,1',{elements:[gate(2,1)]});tiles.set('4,0',{elements:[gate(0,4,0)]});tiles.set('3,0',{elements:[gate(1,3,0)]});publicPaths.get(4).edges|=8;publicPaths.get(3).edges|=8;
  const food=pricingSupport.items.find(i=>i.isFood&&!i.isContainer).id,souvenir=pricingSupport.items.find(i=>i.isSouvenir&&!i.isPhoto).id;
  for(const [id,x,type,item,name]of[[1,6,28,food,'Synthetic Food Counter'],[2,8,32,souvenir,'Synthetic Souvenir Counter']]){
   const shopObject={type:'ride',index:id,identifier:'synthetic.shop.'+id,shopItem:item,shopItemSecondary:255,rideType:[type]};rideObjects.push(shopObject);
   rides.push({id,type,name,status:'open',classification:'shop',object:shopObject,stations:[],price:[10,0],flags:0});
   tiles.set(x+',0',{elements:[{type:'track',ride:id,trackType:262,sequence:0,direction:1,station:0,baseZ:64,clearanceZ:96,isGhost:false}]});publicPaths.get(x).edges|=8;
  }
  for(const x of [21,22,23])setAddition(x,1);for(const x of [24,25])setAddition(x,2);
  if(options.outwardExit){
   // The no-entry sign blocks guests travelling east from the ordinary park
   // paths, while the exit branch can still discharge west toward the gate.
   // The entrance and both counters remain on the ordinary public side.
   tiles.delete('3,0');publicPaths.get(3).edges&=~8;tiles.set('31,0',{elements:[gate(1,31,0)]});publicPaths.get(31).edges|=8;
   bannerMasks.set(publicPaths.get(20),options.reversedExitBanner?4:1);
   for(const x of publicPaths.keys())setAddition(x,null);
   for(const x of [10,11,12])setAddition(x,1);for(const x of [13,14])setAddition(x,2);
   if(options.outwardAmenities!==false){setAddition(30,1);setAddition(29,1);setAddition(28,2);}
  }
  if(options.unreadableAmenityStats){Object.defineProperty(ride,'nausea',{enumerable:true,get:()=>{throw Error('Native nausea getter unavailable');}});}
 }
 const objectManager={getObject:(type,index)=>type==='footpath_addition'?furnitureObjects.find(o=>o.index===index)||null:type==='ride'?rideObjects.find(o=>o.index===index)||null:null,getAllObjects:type=>type==='ride'?rideObjects:type==='footpath_addition'?furnitureObjects:[]};
 function rideWrapper(r){const out={};for(const k of Object.keys(r))Object.defineProperty(out,k,{enumerable:true,get:()=>r[k]});return out;}
 let reads=0,iteratorCalls=0;const map={size:{x:32,y:4},get rides(){return rides.map(rideWrapper);},getRide:id=>rides[id]?rideWrapper(rides[id]):null,
  getTile:(x,y)=>{reads++;return tiles.get(x+','+y)||{elements:[]};},getPathNavigator:(position,index)=>{
   if(!options.localAmenities)return {edges:0,permittedEdges:0,getConnectedPaths:()=>[]};
   const x=position.x/32,y=position.y/32,p=tiles.get(x+','+y)?.elements[index];assert.equal(p?.type,'footpath');
   const permittedEdges=p.edges&(bannerMasks.get(p)??15);
   return {edges:p.edges,permittedEdges,getConnectedPaths:()=>{const out=[],delta=[[-1,0],[0,1],[1,0],[0,-1]];
    for(let d=0;d<4;d++)if(permittedEdges&(1<<d)){const nx=x+delta[d][0],ny=y+delta[d][1],elements=tiles.get(nx+','+ny)?.elements||[];
     const target=elements.findIndex(e=>e.type==='footpath'&&!e.isGhost&&e.baseZ===p.baseZ);if(target>=0)out.push({direction:d,elementIndex:target,position:{x:nx*32,y:ny*32,z:p.baseZ}});}
    return out;}};
  },
  getTrackIterator:()=>{iteratorCalls++;let i=0;return{get position(){return cells[i].position;},get segment(){return cells[i].segment;},next(){i=(i+1)%cells.length;return true;}};}};
 const timers=[],hooks={},sent=[],actions=[],socket={},store={};let connection,serial=34000000;
 const listener={on:(name,fn)=>{connection=fn;return listener;},listen:()=>listener};
 const context={apiVersion:options.apiVersion||124,mode:'normal',paused:true,gameSpeed:0,sharedStorage:{get:k=>store[k],set:(k,v)=>{store[k]=v;}},
  subscribe:(name,fn)=>{hooks[name]=fn;},setTimeout:fn=>timers.push(fn),formatString:(_token,v)=>'$'+(v/10).toFixed(2),
  queryAction:()=>{actions.push('query');},executeAction:()=>{actions.push('execute');}};
 const park={name:'Synthetic Park',cash:1000,entranceFee:0,totalRideValueForMoney:100,messages:[],getFlag:()=>false};
 vm.runInNewContext(bundle,{context,map,objectManager,park,scenario:{},date:{},network:{mode:'none',createListener:()=>listener},console:{log:()=>{}},registerPlugin:r=>r.main()});
 connection({on:(name,fn)=>{socket[name]=fn;},write:line=>sent.push(JSON.parse(line)),end:()=>{}});
 function request(op,args={}){const req={id:String(++serial),op,args,token:config.token};socket.data(JSON.stringify(req)+'\n');return {get reply(){return sent.find(r=>r.id===req.id);}};}
 function flush(){let n=100;while(timers.length&&n-->0)timers.shift()();assert(n>0);}
 return {request,flush,actions,hooks,ride,publicPaths,setAddition,reads:()=>reads,iteratorCalls:()=>iteratorCalls};
}
test('ordinary park and rides expose design and photo pricing concerns without arming or changing the park',()=>{
 const h=harness(),park=h.request('park').reply;
 assert.equal(park.ok,true);assert.equal(park.result.rideReview.complete,true);
 const codes=park.result.rideReview.observations.map(o=>o.code);
 for(const code of ['lift_crest_banking_review','single_train_long_circuit_review','photo_price_below_reference'])assert(codes.includes(code));
 const pricing=park.result.rideReview.rides[0].pricing;
 assert.equal(pricing.items[1].currentPrice,10);assert.equal(pricing.items[1].recommendation.candidatePrice,30);
 assert.equal(pricing.items[1].recommendation.moneyDisplay.candidatePrice,'$3.00');
 assert.equal(park.result.rideReview.observations.find(o=>o.code==='photo_price_below_reference').moneyDisplay.referencePrice,'$3.00');
 const rides=h.request('rides').reply.result;assert.equal(rides[0].design.track.counts.blockBrakes,0);assert.equal(rides[0].pricing.warnings[0].code,'photo_price_below_reference');
 assert.equal(h.request('hello').reply.result.armed,false);assert.equal(h.actions.length,0);
});
test('design cache survives fresh scripting wrappers but refreshes after relevant operating values and native actions',()=>{
 const h=harness();h.request('park');const initial=h.iteratorCalls();h.request('rides');assert.equal(h.iteratorCalls(),initial);
 h.ride.liftHillSpeed=6;h.request('rides');assert(h.iteratorCalls()>initial);const changed=h.iteratorCalls();
 h.hooks['action.execute']({result:{error:0}});h.request('rides');assert(h.iteratorCalls()>changed);assert.equal(h.actions.length,0);
});
test('map, regional inspection and automatic access inventory preserve native vandalism independently of connectivity',()=>{
 const h=harness({brokenLamp:true}),tile=h.request('map',{x:1,y:1}).reply.result[0].elements[0];
 assert.equal(tile.addition,0);assert.equal(tile.isAdditionBroken,true);assert.equal(tile.isAdditionFull,null);
 const region=h.request('path.inspect',{x:1,y:1}).reply.result;assert.equal(region.furniture.summary.broken,1);assert.equal(region.furniture.warnings[0].code,'broken_path_furniture');
 const pending=h.request('path.access');h.flush();assert.equal(pending.reply.ok,true);assert.equal(pending.reply.result.furniture.summary.lamps,1);assert.equal(pending.reply.result.furniture.warningCount,1);
 const park=h.request('park').reply.result;assert.equal(park.access.furniture.warningCount,1);assert.equal(h.actions.length,0);
});
test('a different engine API cannot receive clear design or actionable price recommendations',()=>{
 const h=harness({apiVersion:125}),park=h.request('park').reply.result,rides=h.request('rides').reply.result;
 assert.equal(park.pricing.status,'unknown');assert.equal(park.rideReview.complete,false);assert.equal(rides[0].design.status,'unknown');
 assert.equal(rides[0].pricing.status,'unknown');assert.equal(rides[0].pricing.items.length,0);assert.equal(h.iteratorCalls(),0);assert.equal(h.actions.length,0);
});

test('ordinary park access catches local ride-exit and food-counter deficits despite distant public furniture',()=>{
 const h=harness({localAmenities:true}),pending=h.request('park').reply;assert.equal(pending.result.access.status,'checking');assert.equal(pending.result.access.amenities.status,'checking');h.flush();
 const park=h.request('park').reply.result,access=park.access,amenities=access.amenities;
 assert.equal(access.status,'ok',JSON.stringify({summary:access.summary,warnings:access.warnings,unavailable:access.unavailable}));assert.equal(access.complete,true);assert.equal(access.summary.healthy,5);assert.equal(access.warningCount,0);
 assert.equal(access.furniture.summary.usablePublicBenches,3);assert.equal(access.furniture.summary.usablePublicBins,2);
 assert.equal(amenities.status,'advisories');assert.equal(amenities.complete,true);assert.equal(amenities.sites.length,2);
 const coaster=amenities.sites.find(s=>s.ride===0),food=amenities.sites.find(s=>s.ride===1);
 assert.equal(coaster.nausea,823);assert.equal(coaster.targets.benches,7);assert.equal(coaster.deficits.benches,7);assert.equal(coaster.deficits.bins,1);
 assert.equal(food.kind,'food_drink_shop');assert.equal(food.targets.benches,3);assert.equal(food.targets.bins,2);assert.equal(food.deficits.benches,3);assert.equal(food.deficits.bins,2);
 assert(!amenities.sites.some(s=>s.ride===2),'souvenir counter does not create food seating demand');
 assert.equal(h.request('hello').reply.result.armed,false);assert.equal(h.actions.length,0);
});

test('ordinary rides and ride keep local amenities scoped to each ride while structural access remains healthy',()=>{
 const h=harness({localAmenities:true});h.request('park');h.flush();
 const rides=h.request('rides').reply.result;assert.equal(rides.length,3);
 for(const r of rides){assert.equal(r.access.status,'ok');assert(r.access.amenities.sites.every(s=>s.ride===r.id));assert(r.access.amenities.observations.every(o=>o.ride===r.id));}
 assert.equal(rides[0].access.amenities.sites.length,1);assert.equal(rides[1].access.amenities.sites.length,1);assert.equal(rides[2].access.amenities.sites.length,0);
 const coaster=h.request('ride',{ride:0}).reply.result;assert.equal(coaster.access.status,'ok');assert.equal(coaster.access.amenities.sites[0].deficits.benches,7);assert(coaster.inspection);
 assert.equal(h.actions.length,0);
});

test('automatic CLI completion carries local amenities from one shared audit into park and ride views',async()=>{
 for(const operation of ['park','rides','ride']){
  const h=harness({localAmenities:true}),reply=h.request(operation,operation==='ride'?{ride:0}:{}).reply;let audits=0;
  await completeAccess(reply,{},async(_config,request)=>{assert.equal(request.op,'path.access');audits++;const pending=h.request(request.op,request.args);h.flush();return pending.reply;});
  assert.equal(audits,1);const result=Array.isArray(reply.result)?reply.result[0]:reply.result;
  assert.equal(result.access.status,'ok');assert.equal(result.access.amenities.status,'advisories');assert.equal(result.access.amenities.sites.find(s=>s.ride===0).deficits.benches,7);
  assert.equal(h.actions.length,0);
 }
});

test('native placement invalidation refreshes local coverage and retains distant inventory independently',()=>{
 const h=harness({localAmenities:true});h.request('park');h.flush();const before=h.request('park').reply.result.access;
 assert.equal(before.amenities.sites.find(s=>s.ride===0).deficits.benches,7);
 for(const x of [4,5,6,7,8,9,10])h.setAddition(x,1);h.setAddition(3,2);
 h.hooks['action.execute']({result:{error:0}});const pending=h.request('park').reply.result.access;
 assert.equal(pending.status,'checking');assert.equal(pending.amenities.status,'checking');assert.equal(pending.revision,before.revision+1);h.flush();
 const after=h.request('park').reply.result.access,local=after.amenities.sites.find(s=>s.ride===0);
 assert.equal(after.status,'ok');assert.equal(after.furniture.summary.usablePublicBenches,10);assert.equal(local.deficits.benches,0);assert.equal(local.deficits.bins,0);assert.equal(local.spacing.benches,'ok');
 assert.equal(h.actions.length,0,'fixture changes simulate an outside native edit; the bridge sends no actions');
});

test('unavailable native nausea makes local bench demand unknown without poisoning connected access',()=>{
 const h=harness({localAmenities:true,unreadableAmenityStats:true});h.request('park');h.flush();const park=h.request('park').reply.result;
 assert.equal(park.access.status,'ok');assert.equal(park.access.complete,true);assert.equal(park.access.summary.healthy,5);
 const local=park.access.amenities.sites.find(s=>s.ride===0);assert.equal(local.targets.benches,null);assert.equal(local.deficits.benches,null);assert.equal(local.complete,false);
 assert(!park.access.amenities.observations.some(o=>o.ride===0&&o.code==='local_bench_shortfall'));assert.equal(h.actions.length,0);
});

test('automatic park and ride reviews count amenities behind a legal exit no-entry sign',()=>{
 const h=harness({localAmenities:true,outwardExit:true,nausea:250});h.request('park');h.flush();
 const park=h.request('park').reply.result;assert.equal(park.access.status,'ok');assert.equal(park.access.summary.healthy,5);assert.equal(park.access.warningCount,0);
 const local=park.access.amenities.sites.find(s=>s.ride===0);assert.equal(local.routePolicy,'outbound_to_park');assert.equal(local.complete,true);assert.equal(local.status,'ok');
 assert.equal(local.counts.usableBenches,2);assert.equal(local.counts.usableBins,1);assert.deepEqual(local.deficits,{benches:0,bins:0});
 const ride=h.request('ride',{ride:0}).reply.result;assert.equal(ride.access.status,'ok');assert.equal(ride.access.amenities.status,'ok');assert.equal(ride.access.amenities.sites[0].counts.usableBenches,2);
 assert.equal(h.actions.length,0);
});

test('an unfurnished legal exit-only branch creates concrete automatic shortfalls',()=>{
 const h=harness({localAmenities:true,outwardExit:true,outwardAmenities:false,nausea:250});h.request('park');h.flush();
 const park=h.request('park').reply.result;assert.equal(park.access.status,'ok');assert.equal(park.access.summary.healthy,5);
 const local=park.access.amenities.sites.find(s=>s.ride===0);assert.equal(local.complete,true);assert.equal(local.status,'advisories');assert.deepEqual(local.deficits,{benches:2,bins:1});
 assert(park.access.amenities.observations.some(o=>o.ride===0&&o.code==='local_bench_shortfall'));assert(park.access.amenities.observations.some(o=>o.ride===0&&o.code==='local_bin_shortfall'));
 assert.equal(h.actions.length,0);
});

test('a reversed exit banner remains an access fault and cannot produce a clear amenity result',()=>{
 const h=harness({localAmenities:true,outwardExit:true,reversedExitBanner:true,nausea:250});h.request('park');h.flush();
 const park=h.request('park').reply.result;assert.equal(park.access.status,'problems');assert(park.access.warnings.some(w=>w.kind==='ride_exit'&&w.ride===0));
 const local=park.access.amenities.sites.find(s=>s.ride===0);assert.equal(local.complete,false);assert.equal(local.status,'unknown');assert.equal(local.deficits.benches,null);assert.equal(local.deficits.bins,null);
 assert.equal(h.actions.length,0);
});
