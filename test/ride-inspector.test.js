/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {inspect}=require('../src/ride-inspector');

function fixture() {
    const object={zeroCars:0,minCarsInTrain:1,maxCarsInTrain:12};
    const ride={id:74,flags:3,departFlags:203,minimumWaitingTime:6,maximumWaitingTime:12,
        music:65535,liftHillSpeed:5,inspectionInterval:0,breakdown:'none',isEmpty:true,
        excitement:300,intensity:58,nausea:1,object,vehicles:[100,200]};
    const car=(id,next,seats)=>({id,type:'car',ride:74,numSeats:seats,nextCarOnTrain:next,guests:[],
        status:'travelling',velocity:12345,trackLocation:{x:320,y:640,z:192,direction:2,trackType:0}});
    const entities={100:car(100,101,4),101:car(101,null,4),200:car(200,201,4),201:car(201,null,4)};
    const map={getEntity:id=>entities[id]};
    return {ride,entities,map,car};
}
test('complete live fleet reports actual counts, seats, seat assignments and head state',()=>{
    const {ride,entities,map}=fixture(); entities[101].guests=[5,null,6];
    const result=inspect(ride,map);
    assert.equal(result.fleet.configuredTrains,2); assert.equal(result.fleet.spawnedTrains,2);
    assert.equal(result.fleet.complete,true); assert.equal(result.fleet.carsPerTrain,2);
    assert.equal(result.fleet.totalSeats,16); assert.equal(result.fleet.assignedSeats,2);
    assert.equal(result.fleet.trains[0].velocity,12345);
    assert.deepEqual(result.fleet.trains[0].trackLocation,entities[100].trackLocation);
    assert.deepEqual(result.unavailable,[]);
});
test('Cheshire-style dummy cars contribute no seats and are excluded from displayed car count',()=>{
    const {ride,entities,map,car}=fixture(); ride.vehicles=[100]; ride.object.zeroCars=2;
    entities[100]=car(100,101,0); entities[101]=car(101,102,2); entities[102]=car(102,null,0);
    const result=inspect(ride,map);
    assert.equal(result.fleet.vehiclesPerTrain,3); assert.equal(result.fleet.carsPerTrain,1);
    assert.equal(result.fleet.totalSeats,2);
});
test('flat ride capacity comes from actual vehicles, not object maxima or guests-array length',()=>{
    const {ride,entities,map}=fixture(); ride.vehicles=[100]; entities[100].nextCarOnTrain=null;
    entities[100].numSeats=32; entities[100].guests=[10];
    assert.equal(inspect(ride,map).fleet.totalSeats,32);
    assert.equal(inspect(ride,map).fleet.assignedSeats,1);
});
test('seat assignments are not mislabeled as passengers aboard',()=>{
    const {ride,entities,map}=fixture(); ride.guestCount=1; entities[100].guests=[5,6];
    const result=inspect(ride,map);
    assert.equal(result.fleet.assignedSeats,2);
    assert.equal(result.fleet.occupiedSeats,undefined);
    assert.equal(ride.guestCount,1);
});
test('cleared vehicles preserve configured train count and report unknown car count and capacity',()=>{
    const {ride,map}=fixture(); ride.flags=2; ride.vehicles=[65535,65535];
    const result=inspect(ride,map);
    assert.equal(result.fleet.configuredTrains,2); assert.equal(result.fleet.spawnedTrains,0);
    assert.equal(result.fleet.complete,false); assert.equal(result.fleet.carsPerTrain,null);
    assert.equal(result.fleet.totalSeats,null);
    assert.deepEqual(result.fleet.rideLimits,{maxTrains:null,maxCarsPerTrain:null});
});
test('partial spawning and off-track references never masquerade as full capacity',()=>{
    const {ride,map}=fixture(); ride.vehicles=[100,65535];
    assert.equal(inspect(ride,map).fleet.totalSeats,null);
    ride.vehicles=[100,200]; ride.flags=0;
    assert.equal(inspect(ride,map).fleet.complete,false); assert.equal(inspect(ride,map).fleet.totalSeats,null);
});
test('cycles, shared tails, missing entities and wrong-ride links produce incomplete diagnostics',()=>{
    for (const change of [
        f=>{f.entities[101].nextCarOnTrain=100;},
        f=>{f.entities[201].nextCarOnTrain=101;},
        f=>{delete f.entities[101];},
        f=>{f.entities[101].ride=75;},
        f=>{f.entities[101].type='guest';},
        f=>{f.entities[101].nextCarOnTrain=undefined;},
        f=>{f.entities[101].nextCarOnTrain=65535;}
    ]) {
        const f=fixture(); change(f); const result=inspect(f.ride,f.map);
        assert.equal(result.fleet.complete,false); assert.equal(result.fleet.totalSeats,null);
        assert(result.fleet.trains.some(t=>t.issues.length));
    }
});
test('entity traversal is bounded even with corrupted links',()=>{
    const f=fixture(); f.ride.vehicles=[0]; let calls=0;
    const result=inspect(f.ride,{getEntity:id=>{calls++;return f.car(id,id+1,2);}});
    assert.equal(calls,4096); assert.equal(result.fleet.totalSeats,null);
    assert.match(result.fleet.trains[0].issues[0],/limit/);
    f.ride.vehicles=Array(256).fill(65535);
    assert.equal(inspect(f.ride,f.map).fleet.configuredTrains,null);
});
test('missing, throwing and malformed getters are explicit unknowns, never success or zero',()=>{
    const f=fixture(); delete f.ride.flags; f.ride.minimumWaitingTime=NaN;
    Object.defineProperty(f.ride,'music',{get(){throw Error('unavailable');}});
    f.entities[101].numSeats=undefined; f.entities[100].guests=undefined;
    const result=inspect(f.ride,f.map);
    assert.equal(result.testing.tested,null); assert.equal(result.operation.musicObject,null);
    assert.equal(result.operation.minimumWaitingTime,null); assert.equal(result.fleet.totalSeats,null);
    assert.equal(result.fleet.trains[0].seatCapacity,null); assert.equal(result.fleet.trains[0].assignedSeats,null);
    for (const key of ['flags','minimumWaitingTime','music','vehicle.numSeats','vehicle.guests']) assert(result.unavailable.includes(key));
});
test('native flags distinguish a completed test, raw statistics, ratings, crashes and stalls',()=>{
    const f=fixture(); f.ride.flags=(1<<1)|(1<<3)|(1<<10)|(1<<11)|(1<<20);
    const state=inspect(f.ride,f.map).testing;
    assert.equal(state.tested,true); assert.equal(state.testInProgress,false);
    assert.equal(state.noRawStats,true); assert.equal(state.ratingsAvailable,true);
    assert.equal(state.crashed,true); assert.equal(state.stalledVehicle,true); assert.equal(state.fixedRatings,true);
    f.ride.flags=1<<2; f.ride.excitement=-1;
    assert.equal(inspect(f.ride,f.map).testing.tested,false);
    assert.equal(inspect(f.ride,f.map).testing.testInProgress,true);
    assert.equal(inspect(f.ride,f.map).testing.ratingsAvailable,false);
});
test('wait settings, music and maintenance report native values with separate enable flags',()=>{
    const f=fixture(); f.ride.flags|=(1<<6)|(1<<7)|(1<<8)|(1<<13); f.ride.music=17;
    f.ride.breakdown='safety_cut_out';
    const result=inspect(f.ride,f.map);
    assert.equal(result.operation.minimumWaitingTime,6); assert.equal(result.operation.maximumWaitingTime,12);
    assert.equal(result.operation.waitForMinimumTime,true); assert.equal(result.operation.waitForMaximumTime,true);
    assert.equal(result.operation.waitForLoad,true); assert.equal(result.operation.load,'full');
    assert.equal(result.operation.musicEnabled,true); assert.equal(result.operation.musicObject,17);
    assert.deepEqual(result.maintenance,{breakdown:'safety_cut_out',breakdownPending:true,brokenDown:true,dueInspection:true,inspectionInterval:0,isEmpty:true});
    f.ride.departFlags=0; f.ride.flags=0;
    assert.equal(inspect(f.ride,f.map).operation.waitForMinimumTime,false);
    assert.equal(inspect(f.ride,f.map).operation.musicEnabled,false);
});
test('native prototype getters work without modifying the ride, object or entities',()=>{
    const f=fixture(), native={};
    for (const [key,value] of Object.entries(f.ride)) Object.defineProperty(native,key,{get(){return value;},set(){assert.fail('setter called');}});
    Object.freeze(f.ride.object); Object.values(f.entities).forEach(Object.freeze);
    assert.equal(inspect(native,f.map).fleet.totalSeats,16);
});
test('single ride protocol includes the inspector without arming, querying, saving or mutating',()=>{
    const {harness}=require('./helpers/track-harness'), f=fixture();
    const h=harness({rides:[f.ride],getEntity:f.map.getEntity});
    const result=h.result(h.request('ride',{ride:74}));
    assert.equal(result.ok,true); assert.equal(result.result.inspection.fleet.totalSeats,16);
    assert.deepEqual(result.result.vehicles,[100,200]); assert('moneyDisplay' in result.result);
    assert.equal(h.calls.length,0); assert.equal(h.queries.length,0); assert.deepEqual(h.store,{});
    const list=h.result(h.request('rides')).result;
    assert.equal(list[0].inspection,undefined);
    assert.equal(h.result(h.request('ride',{ride:99})).ok,false);
    assert.equal(h.result(h.request('ride',{ride:74},{token:'incorrect'})).ok,false);
});
test('pinned native bindings establish train slots, masked seat counts and dummy-car UI semantics',()=>{
    const root=path.join(__dirname,'../vendor/OpenRCT2');
    const read=p=>fs.readFileSync(path.join(root,p),'utf8');
    assert.match(read('src/openrct2/scripting/bindings/ride/ScRide.cpp'),/std::begin\(ride->vehicles\) \+ ride->numTrains/);
    assert.match(read('src/openrct2/scripting/bindings/entity/ScVehicle.cpp'),/vehicle->num_seats & kVehicleSeatNumMask/);
    assert.match(read('src/openrct2-ui/windows/Ride.cpp'),/ride->numCarsPerTrain - rideEntry->zero_cars/);
    const header=read('src/openrct2/ride/Ride.h');
    const flags=header.match(/enum class RideFlag[^]*?\{([^]*?)\};/)[1].replace(/\/\/[^\n]*/g,'').split(',').map(s=>s.trim()).filter(Boolean);
    for (const [index,name] of [[0,'onTrack'],[1,'tested'],[2,'testInProgress'],[3,'noRawStats'],[6,'breakdownPending'],[7,'brokenDown'],[8,'dueInspection'],[10,'crashed'],[11,'hasStalledVehicle'],[13,'music'],[20,'fixedRatings']]) assert.equal(flags[index],name);
});
