/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness,nativeObject,nativeSegment,place,query,execute,data,names}=require('./helpers/track-harness');
const id=name=>{const r=data.rideTypes.find(r=>r.name===name);assert.ok(r,name);return r.id;};
const forRide=(type,name,flags=0)=>place(name,{rideType:type,trackPlaceFlags:flags});

test('a global valid piece still fails if the selected ride cannot normally build it',()=>{
    const type=id('ghost_train'),h=harness({type}),a=forRide(type,'leftVerticalLoop');
    assert.equal(query(h,a).ok,false);assert.equal(execute(h,a).result.state,'partial');assert.equal(h.queries.length,0);assert.equal(h.calls.length,0);
});
test('cheat-only drawable groups cannot be built even if native query would accept',()=>{
    const type=id('looping_rc'),h=harness({type});
    assert.equal(query(h,forRide(type,'leftCorkscrewUp')).ok,false);assert.equal(h.queries.length,0);
    assert.equal(query(h,forRide(type,'leftVerticalLoop')).ok,true);
});
test('ordinary chain eligibility requires the ride lift group and exact piece permission',()=>{
    const type=id('spiral_rc'),h=harness({type});
    assert.match(query(h,forRide(type,'up25',1)).error,/normal chain lift/);
    const loop=id('looping_rc'),l=harness({type:loop});
    assert.match(query(l,forRide(loop,'endStation',1)).error,/not allowed/);
    assert.equal(query(l,forRide(loop,'up25',1)).ok,true);
});
test('steep geometry is independent from steep forward chain and reverse lifts remain legal',()=>{
    const type=id('looping_rc'),h=harness({type});
    for(const name of ['up60','up25ToUp60','up60ToUp25']){
        assert.equal(query(h,forRide(type,name)).ok,true,name);
        assert.match(query(h,forRide(type,name,1)).error,/steep forward/);
    }
    for(const name of ['down60','down25ToDown60','down60ToDown25'])assert.equal(query(h,forRide(type,name,1)).ok,true,name);
});
test('curved slope chain needs the ride curved-lift capability',()=>{
    const type=id('looping_rc'),h=harness({type});
    assert.equal(query(h,forRide(type,'leftQuarterTurn3TilesUp25')).ok,true);
    assert.match(query(h,forRide(type,'leftQuarterTurn3TilesUp25',1)).error,/curved track/);
});
test('purpose-built spiral lift hills retain their mandatory chain exception',()=>{
    const type=id('spiral_rc'),h=harness({type});
    for(const name of ['leftCurvedLiftHill','rightCurvedLiftHill']){
        assert.equal(query(h,forRide(type,name,1)).ok,true,name);
        assert.match(query(h,forRide(type,name)).error,/requires its built-in chain/);
    }
});
test('flat rides permit their own native base and reject unrelated bases or flags',()=>{
    const type=id('3d_cinema'),h=harness({type}),base=data.rideTypes[type].startTrackPiece;
    assert.equal(query(h,place('flat',{rideType:type,trackType:base})).ok,true);
    for(const a of [forRide(type,'flat'),place('flat',{rideType:type,trackType:base,trackPlaceFlags:1})])assert.equal(query(h,a).ok,false);
});
test('track IDs and flag aliases reject unknown, sentinel and wrapped native values',()=>{
    for(const field of ['trackType','trackPlaceFlags'])for(const value of [-1,65535,65536,2147483647]){
        const h=harness();assert.equal(query(h,place('flat',{[field]:value})).ok,false);assert.equal(h.queries.length,0);
    }
    const h=harness();assert.equal(query(h,place('flat',{trackPlaceFlags:4})).ok,false);
    assert.equal(query(h,place('flat',{trackType:data.segments.length})).ok,false);
});
test('inverted track flag cannot invent a variant on a normal coaster',()=>{
    const h=harness();assert.match(query(h,place('flat',{trackPlaceFlags:2})).error,/no inverted track variant/);assert.equal(h.queries.length,0);
});
test('runtime version and missing, malformed or mismatching descriptor fail closed',()=>{
    for(const segment of [undefined,null,{}, {...nativeSegment(0),trackGroup:999},{...nativeSegment(0),allowsChainLift:false},{...nativeSegment(0),isSteepUp:undefined}]){
        const h=harness({getTrackSegment:()=>segment});assert.match(query(h,place()).error,/Cannot verify normal track support/);assert.equal(h.queries.length,0);
    }
    const h=harness();h.context.apiVersion=123;assert.match(query(h,place()).error,/API version/);
});
test('native getter metadata is read without depending on enumerable fields',()=>{
    const s=Object.create(null);for(const [key,value] of Object.entries(nativeSegment(0)))Object.defineProperty(s,key,{get:()=>value});
    const h=harness({getTrackSegment:()=>s});assert.equal(query(h,place()).ok,true);
});
test('construction uses union of loaded ride-object sprites as the native UI does',()=>{
    const type=id('looping_rc'),limited=nativeObject(type),full=nativeObject(type,1);delete limited.vehicles[0].spriteGroups.slopes60;
    const h=harness({type,objects:[limited,full]});assert.equal(query(h,forRide(type,'up60')).ok,true);
    h.objects.pop();assert.equal(query(h,forRide(type,'up60')).ok,false);
});
test('sprite precision and default-vehicle metadata fail closed without blanket blocking special vehicles',()=>{
    const type=id('looping_rc');
    const low=nativeObject(type);low.vehicles[0].spriteGroups.slopes60.spriteNumImages=2;
    assert.equal(query(harness({type,objects:[low]}),forRide(type,'up60')).ok,false);
    const invalid=nativeObject(type);invalid.vehicles[0].spriteGroups.slopes60.spriteNumImages=999;
    assert.match(query(harness({type,objects:[invalid]}),forRide(type,'up60')).error,/sprite metadata/);
    for(const carVisual of [-1,2**32]){const bad=nativeObject(type);Object.assign(bad.vehicles[0],{carVisual,spriteGroups:{}});assert.match(query(harness({type,objects:[bad]}),forRide(type,'up60')).error,/sprite metadata/);}
    const truncated=nativeObject(type);truncated.vehicles.length=1;truncated.defaultVehicle=1;assert.match(query(harness({type,objects:[truncated]}),forRide(type,'up60')).error,/sprite metadata/);
    const unknown=nativeObject(type);delete unknown.defaultVehicle;
    assert.match(query(harness({type,objects:[unknown]}),forRide(type,'flat')).error,/sprite metadata/);
    for(const change of [{carVisual:1},{flags:data.constants.chairliftFlag},{flags:data.constants.slideSwingFlag}]){
        const o=nativeObject(type);Object.assign(o.vehicles[0],change,{spriteGroups:{}});
        assert.equal(query(harness({type,objects:[o]}),forRide(type,'up60')).ok,true);
    }
});
test('research still blocks track before support and native query',()=>{
    const h=harness({researched:false});assert.match(query(h,place()).error,/not been researched/);assert.equal(h.queries.length,0);
});
test('support is re-read after query so changed ride type or sprites cannot execute',()=>{
    for(const mutate of [({rides})=>{rides[0].type=id('ghost_train');},({objects})=>{delete objects[0].vehicles[0].spriteGroups.slopes60;}]){
        const h=harness({onQuery:mutate}),r=execute(h,place('up60'));
        assert.equal(r.result.state,'partial');assert.equal(h.queries.length,1);assert.equal(h.calls.length,0);assert.equal(r.result.inFlight,undefined);
    }
});
test('each batch step is guarded and partial receipts retain cost without replay',()=>{
    const h=harness();h.arm();const req=h.request('batch.execute',{actions:[place(),place('leftCorkscrewUp')],maxCost:1000},{session:h.session});h.flush();
    const r=h.result(req).result;assert.equal(r.state,'partial');assert.equal(r.completed.length,1);assert.equal(r.spent,10);assert.equal(h.calls.length,1);
    h.events.data(JSON.stringify(req)+'\n');h.flush();assert.equal(h.calls.length,1);
});
test('cheat-only ride-type changes are rejected while same-type researched vehicle swaps remain usable',()=>{
    const type=id('looping_rc'),h=harness({type,objects:[nativeObject(type),nativeObject(type,1)]});
    const typeChange={action:'ridesetsetting',args:{ride:1,setting:10,value:type}};
    assert.match(query(h,typeChange).error,/requires a cheat/);
    assert.equal(query(h,{action:'ridesetvehicle',args:{ride:1,type:2,value:1,colour:0}}).ok,true);
    assert.equal(h.queries.length,1);
});
test('removal and normal management remain available even when support metadata is unavailable',()=>{
    const h=harness({getTrackSegment:()=>null});h.context.apiVersion=999;
    const actions=[{action:'trackremove',args:{x:2048,y:2048,z:64,direction:0,trackType:0,sequence:0}},
        {action:'ridesetstatus',args:{ride:1,status:0}},{action:'ridesetsetting',args:{ride:1,setting:5,value:1}},
        {action:'tracksetbrakespeed',args:{x:2048,y:2048,z:64,trackType:names.brakes,brakeSpeed:8}}];
    for(const action of actions)assert.equal(query(h,action).ok,true,action.action);
});
test('native clearance rejection still stops supported construction',()=>{
    const h=harness({rejectQuery:true}),r=execute(h,place());assert.equal(r.result.state,'partial');assert.equal(r.result.detail.phase,'query');assert.equal(h.calls.length,0);
});
test('ride-filtered catalog explains piece and chain eligibility while global catalog stays generic',()=>{
    const h=harness(),all=h.result(h.request('track.catalog')).result;
    assert.equal(all.find(s=>s.type===names.flat).supported,undefined);
    const list=h.result(h.request('track.catalog',{ride:1})).result;
    assert.equal(list.find(s=>s.type===names.up60).supported,true);
    assert.equal(list.find(s=>s.type===names.up60).chainSupported,false);
    assert.match(list.find(s=>s.type===names.leftCorkscrewUp).supportReason,/normal construction/);
    assert.equal(h.queries.length,0);
});

test('builders preflight every piece before constructing any part of an incompatible plan',()=>{
    const type=id('ghost_train');
    for(const op of ['track.build','coaster.build']){
        const h=harness({type});h.arm();
        const p=h.result(h.request('track.plan',{start:{x:2048,y:2048,z:64,direction:0},pieces:['flat','flatToRightBank']}));assert.equal(p.ok,true);
        const args={planId:p.result.planId,maxCost:1000};
        if(op==='track.build')args.ride=1;
        else args.create={rideType:type,rideObject:0,entranceObject:0,colour1:0,colour2:0,inspectionInterval:0};
        const req=h.request(op,args,{session:h.session});h.flush();const r=h.result(req).result;
        assert.equal(r.state,'partial');assert.match(r.detail,/Plan piece 1/);assert.equal(h.calls.length,0);assert.equal(h.queries.length,0);
    }
});
test('track.build executes a legal planned slope with the same guard used for direct actions',()=>{
    const h=harness();h.arm();const p=h.result(h.request('track.plan',{start:{x:2048,y:2048,z:64,direction:0},pieces:['flat',{type:'flatToUp25',chain:true}]}));assert.equal(p.ok,true);
    const req=h.request('track.build',{planId:p.result.planId,ride:1,maxCost:1000},{session:h.session});h.flush();assert.equal(h.result(req).result.state,'completed');assert.equal(h.calls.length,2);
});
test('plan automatically includes the native mandatory chain on a spiral lift special',()=>{
    const type=id('spiral_rc'),s=nativeSegment(names.leftCurvedLiftHill);
    Object.assign(s,{beginZ:0,endZ:16,endX:0,endY:0,beginDirection:0,endDirection:0,beginSlope:0,endSlope:0,beginBank:0,endBank:0,elements:[{x:0,y:0,z:0}]});
    const h=harness({type,getTrackSegment:()=>s}),p=h.result(h.request('track.plan',{start:{x:2048,y:2048,z:64,direction:0},pieces:['leftCurvedLiftHill']}));
    assert.equal(p.ok,true);assert.equal(p.result.steps[0].trackPlaceFlags,1);
});
test('changing sprite support between batch steps blocks only subsequent placement',()=>{
    const h=harness({onExecute:({objects})=>{delete objects[0].vehicles[0].spriteGroups.slopes60;}});h.arm();
    const req=h.request('batch.execute',{actions:[place(),place('up60')],maxCost:1000},{session:h.session});h.flush();
    assert.equal(h.result(req).result.state,'partial');assert.equal(h.calls.length,1);assert.equal(h.queries.length,1);assert.equal(h.result(req).result.spent,10);
});
test('isFromTrackDesign cannot bypass normal ride and chain restrictions',()=>{
    const h=harness();for(const a of [place('leftCorkscrewUp',{isFromTrackDesign:true}),place('up60',{trackPlaceFlags:1,isFromTrackDesign:true})])assert.equal(query(h,a).ok,false);
    assert.equal(h.queries.length,0);
});
test('catalog supports explicit new-ride identity and preserves the live research gate',()=>{
    const h=harness(),r=h.result(h.request('track.catalog',{rideType:15,rideObject:0}));assert.equal(r.ok,true);assert.equal(r.result.find(s=>s.type===0).supported,true);
    const locked=harness({researched:false});assert.match(locked.result(locked.request('track.catalog',{rideType:15,rideObject:0})).error,/not been researched/);
});

test('normal vertical and diagonal geometry survives misleading flat TED group values',()=>{
    const type=id('twister_rc'),h=harness({type});
    for(const name of ['up90','down90','up60ToUp90','up90ToUp60','down90ToDown60','down60ToDown90','diagFlat','leftEighthToDiag','rightEighthToOrthogonal','diagFlatToLeftBank','diagLeftBankToUp25','leftBankToLeftQuarterTurn3TilesUp25'])
        assert.equal(query(h,forRide(type,name)).ok,true,name);
    const loop=id('looping_rc'),l=harness({type:loop});assert.equal(query(l,forRide(loop,'up90')).ok,false);assert.equal(query(l,forRide(loop,'diagFlat')).ok,true);
});
test('covered variants require their ride-specific base group and cannot take chain',()=>{
    const type=id('water_coaster'),h=harness({type});
    for(const name of ['flatCovered','leftQuarterTurn5TilesCovered','sBendLeftCovered'])assert.equal(query(h,forRide(type,name)).ok,true,name);
    assert.equal(query(h,forRide(type,'up25Covered')).ok,false);
    assert.match(query(h,forRide(type,'flatCovered',1)).error,/Covered track does not support/);
    assert.equal(query(harness(),place('flatCovered')).ok,false);
});
test('regular and inverted ride variants use separate normal group lists',()=>{
    const type=id('flying_rc'),h=harness({type});
    assert.equal(query(h,forRide(type,'endStation')).ok,false);
    assert.equal(query(h,forRide(type,'endStation',2)).ok,true);
    assert.equal(query(h,forRide(type,'up25',3)).ok,true);
    assert.equal(query(h,forRide(type,'up25',1)).ok,false);
});
test('long-base transitions stay available and short substitutes are rejected where the UI replaces them',()=>{
    const type=id('looping_rc'),h=harness({type});
    assert.equal(query(h,forRide(type,'flatToUp60LongBase')).ok,true);
    assert.equal(query(h,forRide(type,'flatToUp60LongBase',1)).ok,false);
    const hyper=id('hypercoaster'),l=harness({type:hyper});
    assert.equal(query(l,forRide(hyper,'diagFlatToUp60LongBase')).ok,true);
    assert.equal(query(l,forRide(hyper,'diagFlatToUp60')).ok,false);
});
test('Alpine uphill segments require chain while slopes remain discoverable in the ride catalog',()=>{
    const type=id('alpine_rc'),h=harness({type});
    for(const name of ['flatToUp25','up25','up25ToFlat']){
        assert.match(query(h,forRide(type,name)).error,/requires a chain lift/);
        assert.equal(query(h,forRide(type,name,1)).ok,true,name);
    }
    const list=h.result(h.request('track.catalog',{ride:1})).result,up=list.find(s=>s.type===names.up25);
    assert.equal(up.requiresChainLift,true);assert.equal(up.supported,true);assert.equal(up.chainSupported,true);
});
test('forward steep chain also respects live sprite eligibility of its lift group',()=>{
    const type=id('vertical_drop_rc'),o=nativeObject(type),h=harness({type,objects:[o]});
    assert.equal(query(h,forRide(type,'up60',1)).ok,true);
    delete o.vehicles[0].spriteGroups.slopes25;
    assert.equal(query(h,forRide(type,'up60')).ok,true);
    assert.equal(query(h,forRide(type,'up60',1)).ok,false);
});

test('sloped curve groups do not authorize sizes or banking absent from the normal ride controls',()=>{
    for(const type of [id('steel_wild_mouse'),id('inverted_hairpin_rc')]){
        const h=harness({type});
        for(const turn of ['left','right'])for(const slope of ['Up25','Down25']){
            assert.equal(query(h,forRide(type,turn+'QuarterTurn3Tiles'+slope)).ok,true);
            for(const name of [turn+'QuarterTurn5Tiles'+slope,turn+'BankedQuarterTurn3Tile'+slope,turn+'BankedQuarterTurn5Tile'+slope])
                assert.equal(query(h,forRide(type,name)).ok,false,type+' '+name);
        }
    }
    for(const name of ['water_coaster','junior_rc','mine_train_rc','compact_inverted_rc','suspended_swinging_rc','go_karts']){
        const type=id(name),h=harness({type});
        assert.equal(query(h,forRide(type,'leftBankedQuarterTurn3TileUp25')).ok,false,name);
    }
    const type=id('twister_rc'),h=harness({type});
    for(const name of ['leftQuarterTurn5TilesUp25','rightBankedQuarterTurn3TileDown25','leftBankedQuarterTurn5TileUp25'])assert.equal(query(h,forRide(type,name)).ok,true,name);
});
test('vertical one-tile curves require vertical curve capability rather than their misleading steep-curve TED group',()=>{
    for(const name of ['leftQuarterTurn1TileUp90','rightQuarterTurn1TileUp90','leftQuarterTurn1TileDown90','rightQuarterTurn1TileDown90']){
        assert.equal(query(harness(),place(name)).ok,false,name);
        for(const type of [id('twister_rc'),id('inverted_impulse_rc')])assert.equal(query(harness({type}),forRide(type,name)).ok,true,name);
    }
});

test('bank-to-slope transitions also require ordinary slope capability',()=>{
    const type=id('air_powered_vertical_rc'),h=harness({type});
    const names=['leftBankToUp25','rightBankToUp25','up25ToLeftBank','up25ToRightBank','leftBankToDown25','rightBankToDown25','down25ToLeftBank','down25ToRightBank'];
    for(const name of names){assert.equal(query(h,forRide(type,name)).ok,false,name);assert.equal(query(harness(),place(name)).ok,true,name);}
});
