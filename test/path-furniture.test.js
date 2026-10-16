/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Furniture=require('../src/path-furniture'),Inspector=require('../src/path-inspector'),Access=require('../src/access-inspector'),Monitor=require('../src/access-monitor');
const metadata={classificationSource:'synthetic-object-reference-identifiers',objects:[
    {identifier:'test.bench',flags:2|4},{identifier:'test.bin',flags:1|4},{identifier:'test.lamp',flags:8|4},{identifier:'test.tv',flags:256}]};
const objects=[{type:'footpath_addition',index:0,identifier:'test.bench',name:'Misleading rubbish bin name'},
    {type:'footpath_addition',index:1,identifier:'test.bin',name:'Bin'},
    {type:'footpath_addition',index:2,identifier:'test.lamp',name:'Lamp'},
    {type:'footpath_addition',index:3,identifier:'test.tv',name:'Bench lamp bin television'},
    {type:'footpath_addition',index:4,identifier:'custom.unknown',name:'Bench with a familiar name'},
    {type:'footpath_addition',index:254,identifier:'test.bench',name:'Last valid bench slot'}];
const manager={getObject:(type,index)=>{assert.equal(type,'footpath_addition');return objects.find(o=>o.index===index)||null;}};
const options={objectManager:manager,metadata};
const element=(addition=0,extra={})=>({addition,isAdditionGhost:false,isAdditionBroken:false,isAdditionFull:null,additionStatus:255,...extra});
const pathInfo=(extra={})=>({key:'2,1,0',x:2,y:1,elementIndex:0,baseZ:64,edges:5,isQueue:false,slopeDirection:null,...extra});
function read(e=element(),p=pathInfo(),opts=options){return Furniture.create(opts).read(e,p);}
function summary(entries,scope={}){const reader=Furniture.create(options);return reader.summarize(entries.map(([e,p])=>({...p,furniture:reader.read(e,p)})),scope);}
const publicScope={name:'park',publicKeys:{'2,1,0':true},complete:true,coverageComplete:true};

test('addition null is absent; zero and 254 are valid indices; 255 and invalid sentinels remain unknown',()=>{
    assert.deepEqual({...read(element(null))},{present:false,index:null,kind:null,kinds:[],identifier:null,name:null,objectLoaded:null,classificationSource:null,isGhost:null,isBroken:null,isFull:null,rawStatus:null,usable:false,binSlots:null,complete:true,unavailable:[]});
    for(const index of [0,254]){const f=read(element(index));assert.equal(f.complete,true);assert.equal(f.kind,'bench');assert.equal(f.objectLoaded,true);}
    for(const index of [undefined,-1,255,65535,0.5,'0']){const f=read(element(index===undefined?0:index));if(index===undefined)continue;assert.equal(f.complete,false);assert.equal(f.present,null);assert.equal(f.kind,null);}
    assert.equal(read({}).complete,false);
});

test('official identifier flags classify furniture without load-slot or translated-name heuristics',()=>{
    assert.equal(read().kind,'bench');assert.equal(read(element(1,{isAdditionFull:false})).kind,'bin');
    assert.equal(read(element(2)).kind,'lamp');assert.equal(read(element(3)).kind,'other');
    const unknown=read(element(4));assert.equal(unknown.kind,null);assert.equal(unknown.complete,false);assert.equal(unknown.usable,null);
    const native=read(element(4),pathInfo(),{objectManager:{getObject:()=>({...objects[4],flags:8})}});
    assert.equal(native.kind,'lamp');assert.equal(native.classificationSource,'native_object_flags');
});

test('a native bin boolean establishes bin behavior even when a custom identifier is unknown',()=>{
    const bin=read(element(4,{isAdditionFull:false}));assert.equal(bin.kind,'bin');assert.equal(bin.classificationSource,'native_bin_property');assert.equal(bin.complete,false,'the bin flag alone does not rule out other custom behavior flags');
    assert.equal(read(element(4,{isAdditionFull:null})).kind,null);
    const override=read(element(0,{isAdditionFull:false}));assert.equal(override.kind,'bin');assert.deepEqual(override.kinds,['bin']);assert.equal(override.complete,false,'native behavior invalidates the reference bench classification');
});

test('ghost additions are previews and need no loaded definition or irrelevant condition fields',()=>{
    const preview=read({addition:4,isAdditionGhost:true},pathInfo(),{objectManager:{getObject:()=>{throw Error('must not look up preview');}}});
    assert.equal(preview.complete,true);assert.equal(preview.usable,false);assert.equal(preview.isBroken,null);
    const result=summary([[{addition:4,isAdditionGhost:true},pathInfo()]],publicScope);
    assert.equal(result.summary.ghostAdditions,1);assert.equal(result.summary.additions,0);assert.equal(result.warningCount,0);assert.equal(result.complete,true);
    assert.equal(result.observations.length,2,'a ghost bench does not satisfy actual park amenities');
});

test('missing, throwing and malformed condition fields cannot become healthy furniture evidence',()=>{
    for(const name of ['addition','isAdditionGhost','isAdditionBroken','additionStatus','isAdditionFull']){
        const e=element();delete e[name];assert.equal(read(e).complete,false,name);
        Object.defineProperty(e,name,{get(){throw Error('unavailable getter');}});assert.equal(read(e).complete,false,name);
    }
    for(const value of [null,1,'false'])assert.equal(read(element(0,{isAdditionBroken:value})).complete,false);
    assert.equal(read(element(0,{additionStatus:256})).complete,false);
    assert.equal(read(element(0,{isAdditionFull:'false'})).complete,false);
    const result=summary([[{},pathInfo()]],publicScope);
    assert.equal(result.status,'unknown');assert.equal(result.complete,false);assert.equal(result.observations.length,0);
});

test('object lookup errors and wrong-family or stale-slot records are explicit unknown evidence',()=>{
    for(const object of [null,{...objects[0],index:1},{...objects[0],type:'small_scenery'}]){
        const f=read(element(),pathInfo(),{objectManager:{getObject:()=>object},metadata});assert.equal(f.objectLoaded,false);assert.equal(f.complete,false);assert.equal(f.usable,null);
    }
    const f=read(element(),pathInfo(),{objectManager:{getObject(){throw Error('lookup failed');}},metadata});
    assert.equal(f.complete,false);assert(f.unavailable.some(v=>v.includes('lookup failed')));
    assert.equal(read(element(),pathInfo(),{metadata}).complete,false);
});

test('native broken flags warn for benches, bins, lamps and unknown custom items',()=>{
    for(const index of [0,1,2,4]){
        const e=element(index,{isAdditionBroken:true,isAdditionFull:index===1?false:null});
        const result=summary([[e,pathInfo()]],publicScope);
        assert.equal(result.summary.broken,1);assert(result.warnings.some(w=>w.code==='broken_path_furniture'));assert.equal(result.items[0].furniture.usable,false);
        assert(!result.warnings.some(w=>w.code==='full_litter_bin'));
    }
    const absent=summary([[element(null,{isAdditionBroken:true}),pathInfo()]],publicScope);assert.equal(absent.warningCount,0);
});

test('bin slots are 2-bit space-left values on non-joining edges; any full slot is maintenance evidence',()=>{
    // Edge bits 0 and 2 join paths; only slots 1 and 3 hold usable bins.
    const p=pathInfo({edges:5}),e=element(1,{isAdditionFull:true,additionStatus:243});
    const f=read(e,p);assert.equal(f.complete,true);assert.deepEqual(f.binSlots,[{direction:1,spaceLeft:0,isFull:true},{direction:3,spaceLeft:3,isFull:false}]);
    assert.equal(f.usable,true,'the other side still accepts litter');
    const result=summary([[e,p]],publicScope);assert.equal(result.summary.fullBins,1);assert.equal(result.summary.broken,0);assert.equal(result.warnings[0].code,'full_litter_bin');
    const full=read(element(1,{isAdditionFull:true,additionStatus:51}),p);assert.equal(full.usable,false);
    const blockedSlot=read(element(1,{isAdditionFull:false,additionStatus:252}),p);assert.equal(blockedSlot.complete,true,'slot zero is not a bin when edge zero joins another path');
    const junction=read(element(1,{isAdditionFull:false,additionStatus:0}),pathInfo({edges:15}));assert.equal(junction.complete,true);assert.deepEqual(junction.binSlots,[]);assert.equal(junction.usable,false);
});

test('queue status null, slot disagreement and broken bins do not masquerade as ordinary full bins',()=>{
    const queue=read(element(1,{additionStatus:null}),pathInfo({isQueue:true}));assert.equal(queue.complete,true);assert.equal(queue.rawStatus,null);assert.equal(queue.binSlots,null);
    assert.equal(read(element(1,{additionStatus:0,isAdditionFull:false})).complete,false,'native full result and exposed slots disagree');
    assert.equal(read(element(1,{additionStatus:255,isAdditionFull:null})).complete,false,'a public bin requires native fullness evidence');
    const result=summary([[element(1,{isAdditionBroken:true,isAdditionFull:true,additionStatus:0}),pathInfo()]],publicScope);
    assert.equal(result.summary.broken,1);assert.equal(result.summary.fullBins,1);assert.deepEqual(new Set(result.warnings.map(w=>w.code)),new Set(['broken_path_furniture','full_litter_bin']));
});

test('benches need a level public path and a free side before being counted usable',()=>{
    assert.equal(read().usable,true);
    for(const extra of [{isQueue:true},{slopeDirection:2},{edges:15}])assert.equal(read(element(),pathInfo(extra)).usable,false);
    const result=summary([[element(0),pathInfo()]],publicScope);assert.equal(result.summary.usablePublicBenches,1);assert.deepEqual(result.observations.map(o=>o.code),['no_usable_litter_bins']);
});

test('absence is advisory only with complete public-network coverage; rectangle counts do not imply spacing',()=>{
    const entries=[[element(null),pathInfo()]],result=summary(entries,publicScope);
    assert.equal(result.status,'advisories');assert.equal(result.observations.length,2);assert(result.observations.every(o=>o.severity==='advisory'));
    assert.equal(result.coverage.spacingAssessed,false);assert.equal(result.coverage.seatOccupancyAssessed,false);
    for(const scope of [{name:'inspected_rectangle'},{...publicScope,complete:false},{...publicScope,coverageComplete:false},{...publicScope,publicKeys:{}}])assert.equal(summary(entries,scope).observations.length,0);
    const unknown=summary([[element(4),pathInfo()]],publicScope);assert.equal(unknown.complete,false);assert.equal(unknown.observations.length,0);
    const offNetwork=summary([[element(null),pathInfo()],[element(0),pathInfo({key:'4,2,0',x:4,y:2})]],publicScope);
    assert.equal(offNetwork.summary.benches,1);assert.equal(offNetwork.summary.publicBenches,0);assert(offNetwork.observations.some(o=>o.code==='no_usable_benches'));
});

test('summary item and warning payloads are bounded while totals remain explicit',()=>{
    const entries=Array.from({length:600},(_,i)=>[element(0,{isAdditionBroken:true}),pathInfo({key:i+',1,0',x:i})]);
    const result=summary(entries,{complete:true});assert.equal(result.summary.additions,600);assert.equal(result.summary.broken,600);assert.equal(result.items.length,512);assert.equal(result.itemsOmitted,88);
    assert.equal(result.warningCount,600);assert.equal(result.warnings.length,256);assert.equal(result.warningsOmitted,344);assert.equal(result.truncated,true);
});

function fixture(addition=element(null),overrides={}){
    const base={type:'footpath',isGhost:false,baseZ:64,clearanceZ:80,edges:5,slopeDirection:null,isQueue:false,isWide:false,isBlockedByVehicle:false,ride:null,station:null};
    const entries={'0,1':[{...base,...element(null),edges:4}], '1,1':[{type:'entrance',object:2,direction:2,sequence:0,isGhost:false,baseZ:64,clearanceZ:96}],
        '2,1':[{...base,...element(null)}], '3,1':[{...base,...addition,edges:1}]};
    const map={size:{x:6,y:3},rides:[],getTile:(x,y)=>({elements:entries[x+','+y]||[]}),getPathNavigator:(position,index)=>{
        const x=position.x/32,y=position.y/32,p=entries[x+','+y][index];return {edges:p.edges,permittedEdges:p.edges,getConnectedPaths:()=>{
            const result=[];for(const [d,nx]of[[0,x-1],[2,x+1]])if((p.edges&(1<<d))&&entries[nx+','+y]?.[0]?.type==='footpath')result.push({direction:d,elementIndex:0,position:{x:nx*32,y:y*32,z:64}});return result;
        }};
    },...overrides};return map;
}
const accessMetadata={rideTypes:[],trackTypes:[],entranceTypes:[{id:2,sequenceDirections:[5]}]};
test('path inspection exposes native furniture details without changing topology certainty',()=>{
    const map=fixture(element(0,{isAdditionBroken:true})),result=Inspector.inspect({x:2,y:1,width:2,height:1},map,options);
    assert.equal(result.complete,true);assert.equal(result.paths[1].furniture.kind,'bench');assert.equal(result.furniture.summary.broken,1);
    assert.equal(result.summary.asymmetricEdges,0);assert.equal(result.furniture.warningCount,1);
    const unknown=Inspector.inspect({x:2,y:1,width:2,height:1},fixture({}),options);assert.equal(unknown.complete,true);assert.equal(unknown.furniture.complete,false);
});

test('full-park furniture findings stay separate from endpoint healthy counts and navigation warnings',()=>{
    const map=fixture(),job=Access.create(map,accessMetadata,{furniture:options});assert.equal(job.result().furniture.status,'checking');
    job.step(1);assert.equal(job.done,false);while(!job.done)job.step(1);
    const result=job.result();assert.equal(result.status,'ok');assert.equal(result.summary.healthy,1);assert.equal(result.summary.warningCount,0);assert.equal(result.furniture.status,'advisories');assert.equal(result.furniture.observations.length,2);
    const broken=Access.audit({furniture:options},fixture(element(0,{isAdditionBroken:true})),accessMetadata);
    assert.equal(broken.status,'ok');assert.equal(broken.summary.healthy,1);assert.equal(broken.warnings.length,0);assert.equal(broken.furniture.warningCount,1);
    const unknown=Access.audit({furniture:options},fixture({}),accessMetadata);assert.equal(unknown.status,'ok');assert.equal(unknown.furniture.status,'unknown');assert.equal(unknown.furniture.observations.length,0);
});

test('a partial full-map scan cannot report a park with absent furniture as healthy or sufficient',()=>{
    const result=Access.audit({maxTiles:10,furniture:options},fixture(),accessMetadata);
    assert.equal(result.complete,false);assert.equal(result.furniture.complete,false);assert.equal(result.furniture.status,'unknown');assert.equal(result.furniture.observations.length,0);
});

test('monitor overviews preserve the separate park furniture report and pass catalog options to bounded jobs',()=>{
    const timers=[],map=fixture(),context={mode:'normal',setTimeout:fn=>timers.push(fn)},monitor=Monitor.create(context,map,accessMetadata,Access,{furniture:options});
    assert.equal(monitor.overview().furniture.status,'checking');while(timers.length)timers.shift()();
    const result=monitor.overview();assert.equal(result.status,'ok');assert.equal(result.furniture.status,'advisories');assert.equal(result.furniture.summary.paths,3);
    assert.equal(Monitor.summarize({status:'unknown',complete:false,warnings:[],observations:[]}).furniture.status,'unknown');
});

test('pinned native source still exposes null-based addition indices, condition getters and slot semantics',()=>{
    const root=path.join(__dirname,'../vendor/OpenRCT2/src/openrct2'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
    const source=read('scripting/bindings/world/ScTileElement.cpp'),flags=read('object/PathAdditionFlags.h'),staff=read('entity/Staff.cpp');
    assert.match(source,/addition_get[\s\S]*?hasAddition\(\)[\s\S]*?getAdditionEntryIndex\(\)[\s\S]*?JS_NULL/);
    for(const name of ['isAdditionBroken','isAdditionFull','isAdditionGhost'])assert(source.includes(name+'_get'));
    for(const [name,bit]of[['isBin',0],['isBench',1],['lamp',3]])assert.match(flags,new RegExp(name+' = '+bit));
    assert.match(staff,/!\(bin_positions & 1\) && !\(bin_quantity & 3\)/);assert.match(staff,/bin_quantity >>= 2/);
});
