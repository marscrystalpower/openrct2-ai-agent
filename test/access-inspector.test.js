/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {audit,create}=require('../src/access-inspector');

const DELTA=[[-1,0],[0,1],[1,0],[0,-1]];
const NAV_OPTIONS={respectBanners:true,includeQueues:true,includeWidePaths:true,includeGhosts:false};
// Deliberately synthetic public fixtures. No saved park, screenshot, or private
// map dump is required by this suite. These masks exercise the pinned source's
// relative-direction/sequence conventions independently of generated metadata.
const metadata={sourceCommit:'synthetic-test-source',
    rideTypes:[{id:20,name:'tracked',isShopOrFacility:false,isFlatRide:false},
        {id:30,name:'shop',isShopOrFacility:true,isFlatRide:true}],
    trackTypes:[{id:100,name:'single-counter',sequences:[{index:0,connectsToPath:true,entranceDirections:4}]},
        {id:101,name:'multiple-counters',sequences:[{index:0,connectsToPath:true,entranceDirections:5},{index:1,connectsToPath:true,entranceDirections:2}]},
        {id:102,name:'non-door-footprint',sequences:[{index:0,connectsToPath:false,entranceDirections:0}]},
        {id:103,name:'all-side-counters',sequences:[{index:0,connectsToPath:true,entranceDirections:15}]}],
    entranceTypes:[{id:0,name:'rideEntrance',sequenceDirections:[4,0,0,0,0,0,0,0]},
        {id:1,name:'rideExit',sequenceDirections:[4,0,0,0,0,0,0,0]},
        {id:2,name:'parkEntrance',sequenceDirections:[5,0,0,0,0,0,0,0]}]};
const path=(edges=5,extra={})=>({type:'footpath',isGhost:false,baseZ:64,clearanceZ:80,edges,
    slopeDirection:null,isQueue:false,isWide:false,isBlockedByVehicle:false,ride:null,station:null,...extra});
const entrance=(object,extra={})=>({type:'entrance',object,direction:2,sequence:0,ride:65535,station:0,
    isGhost:false,baseZ:64,clearanceZ:96,...extra});
const counter=(ride=1,extra={})=>({type:'track',trackType:100,rideType:30,sequence:0,direction:2,
    ride,station:0,isGhost:false,baseZ:64,clearanceZ:96,...extra});
const wall=(direction,extra={})=>({type:'wall',object:1,direction,isGhost:false,baseZ:64,clearanceZ:96,...extra});
const shop=(id=1,extra={})=>({id,name:'Shop '+id,type:30,status:'open',stations:[],...extra});
const ride=(id=2,extra={})=>({id,name:'Ride '+id,type:20,status:'open',stations:[],...extra});

function fixture(entries=[],rides=[shop()],opts={}){
    const size=opts.size||{x:20,y:12},tiles=new Map(entries.map(([x,y,elements])=>[x+','+y,{elements}]));
    const bannerMasks=new WeakMap(),reads=[],calls=[];
    function tile(x,y){
        assert(Number.isInteger(x)&&Number.isInteger(y),'tile reader uses tile coordinates');
        assert(x>=0&&y>=0&&x<size.x&&y<size.y,'tile reader stays within the map');
        reads.push([x,y]);
        if(opts.throwTile&&opts.throwTile(x,y))throw Error('Unreadable tile');
        return tiles.get(x+','+y)||{elements:[]};
    }
    function endpointHeight(el,d){
        if(el.slopeDirection===null)return el.baseZ;
        if(el.slopeDirection===d)return el.baseZ+16;
        if((el.slopeDirection^2)===d)return el.baseZ;
        return null;
    }
    const map={size,rides,getTile:tile,getPathNavigator:(world,index,options)=>{
        assert.equal(world.x%32,0);assert.equal(world.y%32,0);
        assert.deepEqual(JSON.parse(JSON.stringify(options)),NAV_OPTIONS);
        const x=world.x/32,y=world.y/32,el=tile(x,y).elements[index];
        assert(el&&el.type==='footpath'&&!el.isGhost,'navigator requested only for real paths');
        calls.push([x,y,index]);
        if(opts.throwNavigator&&opts.throwNavigator(x,y,index))throw Error('Navigator unavailable');
        const edges=el.edges&15,permittedEdges=edges&(bannerMasks.get(el)??15);
        return {edges,permittedEdges,getConnectedPaths:()=>{
            const result=[];
            for(let d=0;d<4;d++){
                if(!(permittedEdges&(1<<d)))continue;
                const nx=x+DELTA[d][0],ny=y+DELTA[d][1];
                if(nx<0||ny<0||nx>=size.x||ny>=size.y)continue;
                // Native navigation uses the source bit and first compatible
                // target; the target's reciprocal bit is not required.
                const z=el.baseZ+(el.slopeDirection===d?16:0),elements=tile(nx,ny).elements;
                for(let i=0;i<elements.length;i++){
                    const to=elements[i];
                    if(to.type!=='footpath'||to.isGhost||endpointHeight(to,d^2)!==z)continue;
                    result.push({position:{x:nx*32,y:ny*32,z:to.baseZ},elementIndex:i,direction:d});break;
                }
            }
            return result;
        }};
    }};
    return {map,tiles,bannerMasks,reads,calls};
}
const simple=(extraEntries=[],opts={})=>fixture([[0,5,[path(4)]],[1,5,[entrance(2)]],[2,5,[path()]],[3,5,[path()]],
    [4,5,[path()]],[5,5,[counter()]],...extraEntries],opts.rides||[shop()],opts);
const run=(f,args={},meta=metadata)=>audit({...args,rides:f.map.rides},f.map,meta);
function endpoint(result,kind='shop',id=1){
    const value=result.endpoints.find(e=>e.kind===kind&&(id===null||e.ride===id));
    assert(value,'missing '+kind+' endpoint for '+id+': '+JSON.stringify(result));return value;
}
function state(f,expected,args={},meta=metadata){
    const result=run(f,args,meta);assert.equal(endpoint(result).status,expected,JSON.stringify(result));return result;
}

test('a counter is healthy only through the oriented doorway edge from a park gate',()=>{
    const f=simple(),result=state(f,'healthy');
    assert.equal(result.complete,true);assert(f.calls.length>0);
    f.tiles.get('4,5').elements[0].edges=1;
    state(f,'unreachable');
});

test('a missing counter-front path is reported without guest thoughts or a visual scan',()=>{
    const f=simple();f.tiles.delete('4,5');
    const result=state(f,'unreachable');assert.equal(result.complete,true);
});

test('an adjacent side path is not accepted as a one-sided shop entrance',()=>{
    const f=simple([[5,4,[path(2)]]]);f.tiles.delete('4,5');
    state(f,'unreachable');
});

test('relative shop masks rotate correctly through all four cardinal orientations',()=>{
    for(let direction=0;direction<4;direction++){
        const outward=direction^2,dx=DELTA[outward][0],dy=DELTA[outward][1];
        const doorX=8+dx,doorY=5+dy,gateX=8+dx*2,gateY=5+dy*2;
        const f=fixture([[gateX,gateY,[entrance(2,{direction:outward^2})]],
            [doorX,doorY,[path((1<<outward)|(1<<(outward^2)))]],[8,5,[counter(1,{direction})]]]);
        state(f,'healthy');
    }
});

test('facility doorway height uses the slope boundary, not the path base height alone',()=>{
    const f=simple();
    f.tiles.get('4,5').elements[0]=path(5,{slopeDirection:2});
    f.tiles.get('5,5').elements[0].baseZ=80;
    f.tiles.get('5,5').elements[0].clearanceZ=112;
    state(f,'healthy');
    f.tiles.get('5,5').elements[0].baseZ=64;
    state(f,'unreachable');
});

test('a slope end still needs a permitted departure edge into a shop or ride entrance',()=>{
    for(const kind of ['shop','ride_entrance']){
        const f=simple([],{rides:kind==='shop'?[shop()]:[ride(2)]});
        f.tiles.get('4,5').elements[0]=path(1,{slopeDirection:2,...(kind==='ride_entrance'?{isQueue:true,ride:2,station:0}:{})});
        f.tiles.get('5,5').elements[0]=kind==='shop'?counter(1,{baseZ:80,clearanceZ:112}):entrance(0,{ride:2,station:0,baseZ:80,clearanceZ:112});
        const result=run(f),ep=endpoint(result,kind,kind==='shop'?1:2);
        assert.equal(ep.status,'unreachable');assert(ep.issues.some(i=>i.code==='missing_door_edge'));
    }
});

test('a ride exit can discharge onto a slope end without an edge back into the exit',()=>{
    const f=simple([],{rides:[ride(2)]});
    f.tiles.get('4,5').elements[0]=path(1,{slopeDirection:2});
    f.tiles.get('5,5').elements[0]=entrance(1,{ride:2,station:0,baseZ:80,clearanceZ:112});
    assert.equal(endpoint(run(f),'ride_exit',2).status,'healthy');
});

test('a slope side cannot become a facility doorway at matching base height',()=>{
    const f=simple();f.tiles.get('4,5').elements[0].slopeDirection=1;
    state(f,'unreachable');
});

test('a blocked facility edge cites a wall on either side of the shared boundary',()=>{
    for(const side of ['path','shop']){
        const f=simple();f.tiles.get('4,5').elements[0].edges=1;
        f.tiles.get(side==='path'?'4,5':'5,5').elements.push(wall(side==='path'?2:0));
        const result=state(f,'unreachable'),details=JSON.stringify(endpoint(result));
        assert.match(details,/wall/i,'the actual blocked doorway should carry boundary-wall evidence');
    }
});

test('ghost, non-overlapping, and unrelated walls do not spoil a connected doorway',()=>{
    const f=simple();f.tiles.get('4,5').elements.push(wall(2,{isGhost:true}),wall(2,{baseZ:96,clearanceZ:112}),wall(1));
    f.tiles.get('5,5').elements.push(wall(0,{baseZ:48,clearanceZ:64}));
    state(f,'healthy');
});

test('trees and ride supports near a healthy doorway remain harmless context',()=>{
    const f=simple([],{rides:[shop(),ride(2,{status:'closed'})]});f.tiles.get('4,5').elements.push({type:'small_scenery',object:1,isGhost:false,baseZ:64,clearanceZ:144},
        {type:'track',trackType:102,rideType:20,sequence:0,direction:0,ride:2,station:0,isGhost:false,baseZ:96,clearanceZ:128});
    state(f,'healthy');
});

test('a multi-direction shop is healthy when any real counter side is reachable',()=>{
    const f=simple();f.tiles.get('5,5').elements[0].trackType=101;
    state(f,'healthy');
});

test('a shop footprint can use a reachable door on a different sequence tile',()=>{
    const f=simple([[4,6,[counter(1,{trackType:101,sequence:1})]]]);
    f.tiles.get('5,5').elements[0].trackType=101;
    f.tiles.get('4,5').elements[0].edges=3; // west public route, south second counter
    state(f,'healthy');
});

test('a shop needs one door with both arrival and return access, not two incompatible one-way doors',()=>{
    const f=simple([[6,5,[path(5)]],[7,5,[path(4)]],[8,5,[entrance(2,{direction:0})]],[9,5,[path(1)]]]);
    f.tiles.get('5,5').elements[0].trackType=103;
    f.tiles.get('4,5').elements[0].edges=4;
    // The west counter can be reached but has no way back. The east counter
    // can return to the second gate, whose first path cannot approach it.
    const result=state(f,'unreachable');assert.equal(result.complete,true);
});

test('a footprint sequence without a counter does not fabricate an entrance',()=>{
    const f=simple();f.tiles.get('5,5').elements[0].trackType=102;
    const result=run(f);
    assert(!result.endpoints.some(e=>e.kind==='shop'&&e.status==='healthy'));
    assert.equal(result.status,'unknown','an unresolved endpoint must not produce an overall ok audit');
});

test('ride queues must belong to the entrance ride and station',()=>{
    for(const extra of [{ride:2,station:0},{ride:99,station:0},{ride:2,station:1}]){
        const f=simple([],{rides:[ride(2)]});
        f.tiles.get('4,5').elements[0]=path(5,{isQueue:true,...extra});
        f.tiles.get('5,5').elements[0]=entrance(0,{ride:2,station:0,direction:2});
        const result=run(f),ep=endpoint(result,'ride_entrance',2);
        assert.equal(ep.status,extra.ride===2&&extra.station===0?'healthy':'unreachable',JSON.stringify(result));
    }
});

test('a missing queue join is an access problem even with touching queue tiles',()=>{
    const f=simple([],{rides:[ride(2)]});
    f.tiles.get('3,5').elements[0].edges=1;
    f.tiles.get('4,5').elements[0]=path(4,{isQueue:true,ride:2,station:0});
    f.tiles.get('5,5').elements[0]=entrance(0,{ride:2,station:0,direction:2});
    assert.equal(endpoint(run(f),'ride_entrance',2).status,'unreachable');
});

test('a scenery tile where the queue route should run does not establish connectivity',()=>{
    const f=simple([],{rides:[ride(2)]});
    f.tiles.get('3,5').elements[0]={type:'small_scenery',isGhost:false,object:9,baseZ:64,clearanceZ:112};
    f.tiles.get('4,5').elements[0]=path(5,{isQueue:true,ride:2,station:0});
    f.tiles.get('5,5').elements[0]=entrance(0,{ride:2,station:0,direction:2});
    assert.equal(endpoint(run(f),'ride_entrance',2).status,'unreachable');
});

test('ride entrance and exit use the outward side of their stored direction',()=>{
    for(const object of [0,1]){
        const f=simple([],{rides:[ride(2)]});f.tiles.get('5,5').elements[0]=entrance(object,{ride:2,station:0,direction:2});
        const kind=object===0?'ride_entrance':'ride_exit';
        assert.equal(endpoint(run(f),kind,2).status,'healthy');
        f.tiles.get('5,5').elements[0].direction=0;
        assert.equal(endpoint(run(f),kind,2).status,'unreachable');
    }
});

test('a missing ride-exit landing path is reported as unreachable',()=>{
    const f=simple([],{rides:[ride(2)]});f.tiles.get('5,5').elements[0]=entrance(1,{ride:2,station:0});
    f.tiles.delete('4,5');
    assert.equal(endpoint(run(f),'ride_exit',2).status,'unreachable');
});

test('a foreign ride queue is not a public shortcut to a shop',()=>{
    const f=simple();f.tiles.get('3,5').elements[0]=path(5,{isQueue:true,ride:99,station:0});
    state(f,'unreachable');
});

test('a ride exit cannot discharge into another ride queue as a public route',()=>{
    const f=simple([],{rides:[ride(2)]});f.tiles.get('5,5').elements[0]=entrance(1,{ride:2,station:0});
    f.tiles.get('3,5').elements[0]=path(5,{isQueue:true,ride:99,station:0});
    assert.equal(endpoint(run(f),'ride_exit',2).status,'unreachable');
});

test('one-way banners distinguish access to a shop from return access to a park gate',()=>{
    const f=simple(),middle=f.tiles.get('3,5').elements[0];
    f.bannerMasks.set(middle,1); // A visitor cannot travel east from the gate.
    state(f,'unreachable');
    f.bannerMasks.set(middle,4); // The shop can be reached, but no return route exists.
    state(f,'unreachable');
    f.bannerMasks.set(middle,5);state(f,'healthy');
});

test('a one-way banner pointing out of the exit still permits guests to leave the ride',()=>{
    const f=simple([],{rides:[ride(2)]});f.tiles.get('5,5').elements[0]=entrance(1,{ride:2,station:0});
    f.bannerMasks.set(f.tiles.get('3,5').elements[0],1);
    assert.equal(endpoint(run(f),'ride_exit',2).status,'healthy');
});

test('a banner forbidding movement back into a ride exit does not block discharge',()=>{
    const f=simple([],{rides:[ride(2)]});f.tiles.get('5,5').elements[0]=entrance(1,{ride:2,station:0});
    f.bannerMasks.set(f.tiles.get('4,5').elements[0],1); // west is allowed; east back into the exit is forbidden
    assert.equal(endpoint(run(f),'ride_exit',2).status,'healthy');
});

// Public synthetic native-condition objects. Benches and bins on the exit
// branch are reachable FROM the ride, but a no-entry banner prevents public
// guests approaching them from the park. They must not need publicIn roots.
const localPricing={constants:{noneItem:255},items:[{id:0,name:'food',isFood:true,isDrink:false,isContainer:false}]};
const localFurniture={objectManager:{getObject:(type,index)=>type==='footpath_addition'&&index>=0&&index<2?
    {type,index,identifier:index===0?'synthetic.bench':'synthetic.bin',name:index===0?'Bench':'Bin'}:null},
    metadata:{objects:[{identifier:'synthetic.bench',flags:2},{identifier:'synthetic.bin',flags:1}]}};
function outwardExitFixture({furnished=true,reversed=false,foodOnBranch=false,queueOnBranch=false}={}){
    const coaster=ride(2,{nausea:250,object:{shopItem:255,shopItemSecondary:255}}),rides=[coaster];
    const entries=[[0,5,[path(4)]],[1,5,[entrance(2)]],[2,5,[path(13)]],[3,5,[path(5)]],[4,5,[path(5)]],[5,5,[path(5)]],[6,5,[path(5)]],
        [2,4,[entrance(0,{ride:2,station:0,direction:3})]],[7,5,[entrance(1,{ride:2,station:0,direction:2})]]];
    if(foodOnBranch){rides.push(shop(1,{object:{shopItem:0,shopItemSecondary:255}}));entries.push([5,6,[counter(1,{direction:1})]]);}
    const f=fixture(entries,rides);
    for(const t of f.tiles.values())for(const p of t.elements)if(p.type==='footpath')Object.assign(p,{addition:null,additionStatus:null,isAdditionBroken:null,isAdditionFull:null,isAdditionGhost:null});
    function addition(x,index){Object.assign(f.tiles.get(x+',5').elements[0],{addition:index,additionStatus:255,isAdditionBroken:false,isAdditionFull:index===1?false:null,isAdditionGhost:false});}
    if(furnished){addition(5,0);addition(6,0);addition(4,1);}
    if(foodOnBranch)f.tiles.get('5,5').elements[0].edges|=2;
    if(queueOnBranch)Object.assign(f.tiles.get('3,5').elements[0],{isQueue:true,ride:99,station:0});
    f.bannerMasks.set(f.tiles.get('3,5').elements[0],reversed?4:1);return f;
}
const localRun=f=>run(f,{furniture:localFurniture,pricingSupport:localPricing});

test('native outward-only exit graph gives healthy access and usable local furniture behind no-entry protection',()=>{
    const result=localRun(outwardExitFixture());assert.equal(result.status,'ok');assert.equal(result.summary.healthy,3);
    assert.equal(result.summary.warningCount,0);assert.equal(endpoint(result,'ride_exit',2).status,'healthy');
    const local=result.amenities.sites.find(s=>s.ride===2&&s.kind==='ride_exit');assert.equal(local.routePolicy,'outbound_to_park');assert.equal(local.complete,true);assert.equal(local.status,'ok');
    assert.equal(local.counts.usableBenches,2);assert.equal(local.counts.usableBins,1);assert.deepEqual(local.deficits,{benches:0,bins:0});
});

test('native empty exit-only graph yields real amenity shortfalls instead of an unknown public root',()=>{
    const result=localRun(outwardExitFixture({furnished:false}));assert.equal(result.status,'ok');assert.equal(result.summary.healthy,3);
    const local=result.amenities.sites.find(s=>s.ride===2);assert.equal(local.complete,true);assert.deepEqual(local.deficits,{benches:2,bins:1});
    assert(result.amenities.observations.some(o=>o.ride===2&&o.code==='local_bench_shortfall'));assert(result.amenities.observations.some(o=>o.ride===2&&o.code==='local_bin_shortfall'));
});

test('reversed no-entry signs and queue-only exit routes cannot become healthy amenity evidence',()=>{
    for(const options of [{reversed:true},{queueOnBranch:true}]){
        const result=localRun(outwardExitFixture(options));assert.equal(endpoint(result,'ride_exit',2).status,'unreachable');
        const local=result.amenities.sites.find(s=>s.ride===2);assert.equal(local.status,'unknown');assert.equal(local.complete,false);assert.equal(local.deficits.benches,null);assert.equal(local.deficits.bins,null);
    }
});

test('an outward-only food counter cannot borrow exit routing as customer round-trip access',()=>{
    const result=localRun(outwardExitFixture({foodOnBranch:true}));assert.equal(endpoint(result,'ride_exit',2).status,'healthy');assert.equal(endpoint(result,'shop',1).status,'unreachable');
    const localExit=result.amenities.sites.find(s=>s.ride===2),localShop=result.amenities.sites.find(s=>s.ride===1);
    assert.equal(localExit.complete,true);assert.equal(localExit.deficits.benches,0);assert.equal(localShop.routePolicy,'round_trip_public');assert.equal(localShop.status,'unknown');
    assert.equal(localShop.deficits.benches,null);assert.equal(localShop.deficits.bins,null);
});

test('a park inside-path banner can allow entry while preventing a return to that gate',()=>{
    const f=simple();f.bannerMasks.set(f.tiles.get('2,5').elements[0],4);
    const result=run(f),gate=endpoint(result,'park_entrance',null);
    assert.equal(gate.status,'unreachable');
    assert.deepEqual(gate.doorChecks.find(d=>d.side==='inside').connections,['2,5,0']);
    assert(gate.issues.some(i=>i.code==='missing_door_edge'));
    assert.notEqual(endpoint(result).status,'healthy');
});

test('the park root is inside the gate; outside and side-sequence paths are not roots',()=>{
    const f=simple([[0,5,[path(4)]],[1,6,[entrance(2,{sequence:1})]],[2,6,[path(4)]],
        [3,6,[path(13)]],[4,6,[path(9)]]]);
    // The gate's internal first tile is missing. The large outside/side network
    // must not be promoted into an invented entrance for the real shop.
    f.tiles.delete('2,5');
    assert.notEqual(endpoint(run(f)).status,'healthy');
});

test('ghost gates cannot establish access to an otherwise isolated facility',()=>{
    const f=simple();f.tiles.get('1,5').elements[0].isGhost=true;
    state(f,'unknown');
});

test('all real gates contribute roots instead of selecting just one component',()=>{
    const f=simple([[12,5,[entrance(2)]],[13,5,[path()]],[14,5,[counter(3)]]],{rides:[shop(),shop(3)]});
    const result=run(f);assert.equal(endpoint(result).status,'healthy');assert.equal(endpoint(result,'shop',3).status,'healthy');
});

test('without a usable gate the largest path component is never declared healthy',()=>{
    const f=simple();f.tiles.delete('1,5');
    const result=state(f,'unknown');assert.equal(result.complete,false);
});

test('an active ride station with neither gate is reported even if another station has both',()=>{
    const stations=[{start:{x:160,y:160,z:64},length:2},{start:{x:320,y:160,z:64},length:2}];
    const f=simple([[5,6,[entrance(1,{ride:2,station:0})]],[4,6,[path(12)]]],{rides:[ride(2,{stations})]});
    f.tiles.get('5,5').elements[0]=entrance(0,{ride:2,station:0});
    f.tiles.get('4,5').elements[0].edges|=2;
    const result=run(f);
    for(const kind of ['ride_entrance','ride_exit'])assert.equal(result.endpoints.find(e=>e.kind===kind&&e.station===0).status,'healthy');
    const missing=result.endpoints.find(e=>e.kind==='ride_station'&&e.station===1);
    assert(missing,'station 1 must not disappear from the audit');assert.equal(missing.status,'unreachable');
    assert.equal(result.warnings.filter(w=>w.station===1&&w.code==='missing_station_access').length,1);
});

test('transport rides may use an entrance-only pickup station and an exit-only drop-off station',()=>{
    const stations=[{start:{x:160,y:160,z:64},length:2},{start:{x:320,y:160,z:64},length:2}];
    const f=simple([[5,6,[entrance(1,{ride:2,station:1})]],[4,6,[path(12)]]],{rides:[ride(2,{stations})]});
    f.tiles.get('5,5').elements[0]=entrance(0,{ride:2,station:0});f.tiles.get('4,5').elements[0].edges|=2;
    const result=run(f);assert.equal(result.status,'ok');assert.equal(result.warnings.length,0);
    assert.equal(result.endpoints.find(e=>e.kind==='ride_entrance'&&e.station===0).status,'healthy');
    assert.equal(result.endpoints.find(e=>e.kind==='ride_exit'&&e.station===1).status,'healthy');
});

test('closed and testing construction has observations instead of active access warnings',()=>{
    for(const status of ['closed','testing']){
        const f=simple([],{rides:[shop(1,{status})]});f.tiles.delete('4,5');
        const result=state(f,'unreachable');assert.equal(result.warnings.length,0);
        assert.notEqual(result.status,'problems');
        assert(result.observations.some(item=>item.ride===1&&item.severity==='info'));
    }
});

test('intentional adjacent path separations and fences do not become access warnings',()=>{
    const f=simple([[2,6,[path(4)]],[3,6,[path(5)]],[4,6,[path(1)]],
        [3,5,[path(5),wall(1)]]]);
    const result=state(f,'healthy');
    assert(!JSON.stringify(result.warnings||[]).match(/possible_gap|adjacent.*gap/));
    assert.equal((result.warnings||[]).length,0,JSON.stringify(result));
});

test('a throwing tile or navigator returns unknown access instead of a false negative',()=>{
    for(const opts of [{throwTile:(x,y)=>x===3&&y===5},{throwNavigator:(x,y)=>x===3&&y===5}]){
        const result=state(simple([],opts),'unknown');assert.equal(result.complete,false);
    }
});

test('missing endpoint metadata is unknown and never silently omitted as healthy',()=>{
    for(const field of ['trackType','sequence','direction']){
        const f=simple();delete f.tiles.get('5,5').elements[0][field];
        const result=run(f);
        assert.equal(result.complete,false,field+': '+JSON.stringify(result));
        assert(!result.endpoints.some(e=>e.kind==='shop'&&e.status==='healthy'),field);
    }
});

test('a missing ride classification cannot silently classify a shop as healthy',()=>{
    const f=simple();delete f.map.rides[0].type;
    const result=run(f);assert.equal(result.complete,false);
    assert(!result.endpoints.some(e=>e.kind==='shop'&&e.status==='healthy'));
});

test('missing native path navigation never produces a healthy endpoint',()=>{
    const f=simple();delete f.map.getPathNavigator;
    const result=state(f,'unknown');assert.equal(result.complete,false);
});

test('unknown metadata tables produce explicit incomplete evidence',()=>{
    const f=simple(),meta={...metadata,trackTypes:[]};
    const result=run(f,{},meta);assert.equal(result.complete,false);
    assert(!result.endpoints.some(e=>e.kind==='shop'&&e.status==='healthy'));
});

test('malformed native links do not invent a route or a definite disconnection',()=>{
    const f=simple(),original=f.map.getPathNavigator;
    f.map.getPathNavigator=(world,index,options)=>{
        const nav=original(world,index,options);
        if(world.x===3*32&&world.y===5*32)nav.getConnectedPaths=()=>[{position:{x:17*32,y:5*32,z:64},elementIndex:0,direction:2}];
        return nav;
    };
    const result=state(f,'unknown');assert.equal(result.complete,false);
});

test('duplicate real paths at the same tile and base height make access ambiguous',()=>{
    const f=simple();f.tiles.get('3,5').elements.push(path(5));
    const result=state(f,'unknown');assert.equal(result.complete,false);
    assert.match(result.unavailable.join(' '),/duplicate|ambig/i);
});

test('separate height layers and ghost preview duplicates do not confuse actual path identity',()=>{
    for(const extra of [{baseZ:96,clearanceZ:112},{isGhost:true}]){
        const f=simple();f.tiles.get('3,5').elements.push(path(5,extra));
        const result=state(f,'healthy');assert.equal(result.complete,true);
    }
});

test('two different path layers meeting the same door height are ambiguous instead of fabricated access',()=>{
    const f=simple();f.tiles.get('4,5').elements=[path(5,{slopeDirection:2}),path(5,{baseZ:80,clearanceZ:96})];
    f.tiles.get('5,5').elements[0].baseZ=80;f.tiles.get('5,5').elements[0].clearanceZ=112;
    const result=state(f,'unknown');assert.equal(result.complete,false);
    assert.match(result.unavailable.join(' '),/ambig|multiple geometry-compatible/i);
});

test('small incremental work steps do not traverse the entire map synchronously',()=>{
    const f=simple(),scanner=create(f.map,metadata,{rides:f.map.rides});
    scanner.step(1);
    assert(f.reads.length<20,'one work unit may not scan the whole map');
    const result=scanner.result();assert.equal(result.complete,false);
    assert(!result.endpoints||!result.endpoints.some(e=>e.status==='healthy'));
});

test('scan and route budgets yield unknown evidence rather than false no-route findings',()=>{
    for(const args of [{maxTiles:2},{maxPaths:1},{maxSearchNodes:1},{maxSearchWork:1}]){
        const f=simple([],{rides:[ride(2)]});
        f.tiles.get('3,5').elements[0]=path(5,{isQueue:true,ride:2,station:0});
        f.tiles.get('4,5').elements[0]=path(5,{isQueue:true,ride:2,station:0});
        f.tiles.get('5,5').elements[0]=entrance(0,{ride:2,station:0});
        const result=run(f,args);assert.equal(result.complete,false,JSON.stringify(args));
        assert.equal(result.truncated,true,JSON.stringify(args));
        assert(!result.endpoints.some(e=>e.kind==='ride_entrance'&&e.status==='healthy'),JSON.stringify(args));
        assert(!result.endpoints.some(e=>e.kind==='ride_entrance'&&e.status==='unreachable'),JSON.stringify(args));
    }
});

test('large shop footprints respect the global door budget and keep the serialized report bounded',()=>{
    const rides=Array.from({length:1024},(_,id)=>shop(id,{name:'端'.repeat(160)})),entries=[];
    for(let id=0;id<rides.length;id++){
        const x=(id%32)*2,y=Math.floor(id/32)*2+2;
        for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)entries.push([x+dx,y+dy,[counter(id,{trackType:103})]]);
    }
    entries.push([1,0,[entrance(2,{direction:1})]],[1,1,[path(10)]]);
    const f=fixture(entries,rides,{size:{x:64,y:66}}),result=run(f);
    assert.equal(result.complete,false);assert.equal(result.truncated,true);assert.equal(result.status,'unknown');
    assert(result.endpoints.every(ep=>ep.status==='unknown'));
    assert(result.endpoints.reduce((n,ep)=>n+ep.doorChecks.length,0)<=result.limits.maxDoorCandidates);
    assert(Buffer.byteLength(JSON.stringify(result),'utf8')<24*1024*1024,'report must fit safely beneath the client response limit');
});
