/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const Auditor=require('../src/ride-auditor'), data=require('../generated/track-support.json');
const names=Object.fromEntries(data.segments.map(s=>[s.name,s.id]));

// Synthetic API objects exercise classification and bounds. They are not a
// simulator and deliberately do not claim a native clearance or physics test.
function fixture(specs,options={}) {
    const tiles=new Map(), cells=[], live=new Map(); let height=128, tileReads=0;
    specs.forEach((raw,index)=>{
        const spec=typeof raw==='string'?{name:raw}:raw, native=data.segments[names[spec.name]];
        const direction=spec.direction??0, z=height, p={x:64+index*64,y:64,z,direction};
        let rise=spec.rise??(native.endSlope===data.trackPitches.up25?16:native.beginSlope===data.trackPitches.up25 && native.endSlope===0?8:0);
        const offset=spec.offset??{x:0,y:0,z:0};
        const rotated=[[offset.x,offset.y],[offset.y,-offset.x],[-offset.x,-offset.y],[-offset.y,offset.x]][direction&3];
        const tx=(p.x+rotated[0])/32,ty=(p.y+rotated[1])/32;
        const elements=[{type:'surface',baseZ:0},{type:'track',ride:0,trackType:native.id,sequence:0,
            direction:direction&3,baseZ:z+offset.z,isGhost:false,hasChainLift:spec.chain??false}];
        tiles.set(`${tx},${ty}`,{elements});
        const segment={...native,type:native.id,allowsChainLift:native.flags.allowLiftHill,isSteepUp:native.flags.isSteepUp,
            beginZ:0,endZ:rise,elements:[offset],length:32,
            isBankedTurn:spec.bankedTurn??native.flags.isBankedTurn};
        cells.push({position:p,segment}); live.set(native.id,segment); height+=rise;
    });
    const map={size:{x:1024,y:1024},getTile:(x,y)=>{tileReads++;return tiles.get(`${x},${y}`)??{elements:[]};},getTrackIterator:()=>{
        let index=0; return {get position(){return cells[index].position;},get segment(){return cells[index].segment;},next(){if(index+1<cells.length){index++;return true;}if(options.closed===false)return false;index=0;return true;}};
    }};
    const ride={id:0,type:52,rideTime:102,vehicles:[0],mode:1,liftHillSpeed:5,stations:[{start:{x:cells[0].position.x,y:cells[0].position.y,z:cells[0].position.z}}],...options.ride};
    const context={apiVersion:124,getTrackSegment:id=>live.get(id)};
    return {ride,map,context,cells,tiles,reads:()=>tileReads,inspect:(limits)=>Auditor.inspect(ride,map,context,data,limits)};
}
const layout=()=>['endStation',{name:'up25',chain:true},{name:'up25',chain:true},'up25ToRightBank',
    'bankedRightQuarterTurn5Tiles','rightBank','rightBank','bankedRightQuarterTurn5Tiles','rightBankToFlat',
    {name:'flatToDown25',rise:-8},'onRidePhoto','brakes','brakes','brakes','brakes'];
const codes=result=>result.observations.map(o=>o.code);

test('recognises a chain crest followed by a long banked turn section and distinguishes real block brakes',()=>{
    const result=fixture(layout()).inspect();
    assert.equal(result.complete,true);
    assert.equal(result.status,'review');
    assert.deepEqual(codes(result),['lift_crest_banking_review','single_train_long_circuit_review']);
    assert.deepEqual(result.track.counts,{ordinaryBrakes:4,blockBrakes:0,photo:1});
    assert.equal(result.track.liftCrestBanking[0].bankedTurns,2);
    assert.equal(result.track.ordinaryBrakeRuns[0].pieces,4);
    assert.deepEqual(result.operation.supportedBlockModes,[{id:34,name:'continuousCircuitBlockSectioned'}]);
    assert.equal(result.operation.modeName,'continuousCircuit');
});

test('unbanked lift crest avoids a banking observation',()=>{
    const f=fixture(['endStation',{name:'up25',chain:true},'up25ToFlat','rightQuarterTurn5Tiles','flatToDown25']);
    assert(!codes(f.inspect()).includes('lift_crest_banking_review'));
});

test('chain flags continuing through the up-to-flat crest and flat cap retain the lift review',()=>{
    for(const cap of [[],[{name:'flat',chain:true}]]) {
        const result=fixture(['endStation',{name:'up25',chain:true},{name:'up25ToFlat',chain:true},...cap,'flatToRightBank','bankedRightQuarterTurn5Tiles']).inspect();
        assert(codes(result).includes('lift_crest_banking_review'));
    }
    assert(!codes(fixture(['endStation',{name:'flat',chain:true},'flatToRightBank','bankedRightQuarterTurn5Tiles']).inspect()).includes('lift_crest_banking_review'));
});

test('a banked high-speed turn after a drop is not a slow crest observation',()=>{
    const f=fixture(['endStation',{name:'up25',chain:true},'up25ToFlat',{name:'flatToDown25',rise:-8},'flatToRightBank','bankedRightQuarterTurn5Tiles']);
    assert(!codes(f.inspect()).includes('lift_crest_banking_review'));
});

test('powered acceleration after a crest stops the slow crest inference',()=>{
    const f=fixture(['endStation',{name:'up25',chain:true},'up25ToFlat','booster','flatToRightBank','bankedRightQuarterTurn5Tiles']);
    assert(!codes(f.inspect()).includes('lift_crest_banking_review'));
});

test('an ordinary hill without a chain is not called a lift crest',()=>{
    const f=fixture(['endStation','up25','up25ToRightBank','bankedRightQuarterTurn5Tiles']);
    assert(!codes(f.inspect()).includes('lift_crest_banking_review'));
});

test('banked straight transitions alone do not trigger a banked turn observation',()=>{
    const f=fixture(['endStation',{name:'up25',chain:true},'up25ToRightBank','rightBank','rightBankToFlat']);
    assert(!codes(f.inspect()).includes('lift_crest_banking_review'));
});

test('diagonal and sloped ordinary brakes do not count as blocks',()=>{
    const f=fixture(['endStation','diagBrakes','down25Brakes','diagBlockBrakes','blockBrakes']);
    assert.deepEqual(f.inspect().track.counts,{ordinaryBrakes:2,blockBrakes:2,photo:0});
    assert(!codes(f.inspect()).includes('single_train_long_circuit_review'));
});

test('a single actual block brake prevents the zero-block observation',()=>{
    const f=fixture(layout().concat('blockBrakes'));
    assert(!codes(f.inspect()).includes('single_train_long_circuit_review'));
});

test('short rides, multi-train circuits and legitimate shuttle modes avoid this capacity observation',()=>{
    for(const ride of [{rideTime:89},{vehicles:[0,1]},{mode:2}]) {
        assert(!codes(fixture(layout(),{ride}).inspect()).includes('single_train_long_circuit_review'));
    }
});

test('ride types lacking block modes do not receive a block retrofit recommendation',()=>{
    assert(!codes(fixture(['endStation','brakes'],{ride:{type:9}}).inspect()).includes('single_train_long_circuit_review'));
});

test('a bounded partial traversal reports lower bounds and never claims zero blocks',()=>{
    const f=fixture(layout().concat('blockBrakes')), result=f.inspect({maxSegments:6});
    assert.equal(result.status,'unknown'); assert.equal(result.truncated,true); assert.equal(result.complete,false);
    assert.equal(result.track.segmentsChecked,6); assert.equal(result.track.counts,null);
    assert.equal(result.track.observedCounts.blockBrakes,0);
    assert(!codes(result).includes('single_train_long_circuit_review'));
    assert(f.reads()<=7);
});

test('an exact-length bound still recognises closure',()=>{
    const f=fixture(['endStation','blockBrakes']);
    assert.equal(f.inspect({maxSegments:2}).complete,true);
});

test('a native gap stays unknown rather than certifying complete track inventory',()=>{
    const result=fixture(layout(),{closed:false}).inspect();
    assert.equal(result.complete,false); assert.equal(result.track.reason,'gap or end of track'); assert.equal(result.track.counts,null);
    assert(!codes(result).includes('single_train_long_circuit_review'));
});

test('unreadable chain flags remain unknown rather than inventing lift flags',()=>{
    const f=fixture(layout()); delete f.tiles.get('6,2').elements[1].hasChainLift;
    const result=f.inspect(); assert.equal(result.status,'unknown'); assert.equal(result.complete,false);
    assert(result.unavailable.some(s=>s.includes('chain flag')));
    assert(!codes(result).includes('lift_crest_banking_review'));
});

test('read-back matches sequence-zero offsets after rotation and respects height',()=>{
    const f=fixture(['endStation',{name:'up25',chain:true,offset:{x:32,y:0,z:16},direction:1},'up25ToRightBank','bankedRightQuarterTurn5Tiles']);
    assert.equal(f.inspect().complete,true);
    f.tiles.get('4,1').elements[1].baseZ++;
    assert.equal(f.inspect().complete,false);
});

test('incompatible metadata, absent stations and oversized tile elements fail closed',()=>{
    const f=fixture(layout());
    assert.equal(Auditor.inspect(f.ride,f.map,{apiVersion:125},data).status,'unknown');
    assert.equal(fixture(layout(),{ride:{stations:[]}}).inspect().status,'unknown');
    f.tiles.get('2,2').elements=Array(257).fill({type:'track'});
    assert.equal(f.inspect().status,'unknown');
});

test('flat rides return not applicable without touching the map',()=>{
    const f=fixture(['endStation'],{ride:{type:39}});
    assert.equal(f.inspect().status,'not_applicable'); assert.equal(f.reads(),0);
});

test('ordinary brake runs crossing the iterator origin form one run',()=>{
    const f=fixture(['brakes','brakes','flat','brakes']);
    const result=f.inspect(); assert.equal(result.track.ordinaryBrakeRuns.length,1); assert.equal(result.track.ordinaryBrakeRuns[0].pieces,3);
});
