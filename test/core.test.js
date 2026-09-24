'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/core'),segments=require('./fixtures/segments.json'),names=require('../generated/track-names.json'),schemas=require('../generated/actions.json');
const example=require('../examples/custom-coaster-plan.json').args;
const plan=p=>core.plan(p,t=>segments[t],names,{x:128,y:128});
test('real engine geometry produces a closed 12-piece custom hill coaster',()=>{
    const r=plan(example);assert.equal(r.closed,true);assert.equal(r.steps.length,12);assert.equal(r.possibleOverlaps.length,0);
    assert.equal(Math.max(...r.footprint.map(p=>p.z)),64);assert.deepEqual(r.end,r.start);
});
test('closure survives all four cardinal rotations',()=>{
    for(let direction=0;direction<4;direction++)assert.equal(plan({...example,start:{...example.start,direction}}).closed,true);
});
test('downhill placement uses base elevation, not connection elevation',()=>{
    const r=core.advance({x:64,y:64,z:128,direction:0,slope:6,bank:0},segments[names.down25]);
    assert.equal(r.next.z,112);assert.equal(r.origin.z,112);
});
test('diagonal track omits cardinal tile step',()=>{
    const s=segments[names.diagFlat],r=core.advance({x:512,y:512,z:64,direction:4,slope:0,bank:0},s);
    assert.deepEqual(r.next,{x:480,y:544,z:64,direction:4,slope:0,bank:0});
});
test('reject disconnected slopes',()=>assert.throws(()=>plan({start:example.start,pieces:['up25']}),/Slope/));
test('reject disconnected banking',()=>assert.throws(()=>plan({start:example.start,pieces:['bankedRightQuarterTurn5Tiles']}),/Bank/));
test('reject disconnected diagonal',()=>assert.throws(()=>plan({start:example.start,pieces:['diagFlat']}),/Diagonal/));
test('reject unsupported lift chain',()=>assert.throws(()=>plan({start:example.start,pieces:[{type:'brakes',chain:true}]}),/Chain/));
test('reject incomplete required circuit',()=>assert.throws(()=>plan({start:example.start,pieces:['flat'],requireClosed:true}),/not closed/));
test('reject off-map construction',()=>assert.throws(()=>plan({start:{x:32,y:32,z:64,direction:0},pieces:[{type:'flat',repeat:2}]}),/map/));
test('reject invalid repeat and world units',()=>{
    assert.throws(()=>plan({start:example.start,pieces:[{type:'flat',repeat:0}]}),/repeat/);
    assert.throws(()=>plan({start:{...example.start,x:65},pieces:['flat']}),/multiples/);
});
test('reject duplicate closed circuit construction',()=>assert.throws(()=>plan({...example,pieces:[...example.pieces,...example.pieces]}),/Duplicate/));
test('action validation prevents flag injection and missing fields',()=>{
    assert.throws(()=>core.validateAction('trackplace',{flags:128},schemas),/Unknown argument/);
    assert.throws(()=>core.validateAction('ridesetprice',{ride:0},schemas),/must be/);
    assert.throws(()=>core.validateAction('cheatset',{},schemas),/not allowed/);
    assert.throws(()=>core.validateAction('toString',{},schemas),/not allowed/);
    core.validateAction('pausetoggle',{},schemas);
});
