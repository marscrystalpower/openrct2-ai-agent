/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Amenity=require('../src/amenity-inspector');

// Independent, public synthetic directed footpath graphs. Native connection
// inspection supplies these links; positions alone never join two fixtures.
const none=()=>({present:false,index:null,kind:null,kinds:[],isGhost:null,isBroken:null,isFull:null,usable:false,complete:true,unavailable:[]});
const bench=(extra={})=>({present:true,index:0,kind:'bench',kinds:['bench'],objectLoaded:true,isGhost:false,isBroken:false,isFull:null,usable:true,complete:true,unavailable:[],...extra});
const bin=(extra={})=>({present:true,index:1,kind:'bin',kinds:['bin'],objectLoaded:true,isGhost:false,isBroken:false,isFull:false,usable:true,complete:true,binSlots:[{direction:1,spaceLeft:3,isFull:false},{direction:3,spaceLeft:3,isFull:false}],unavailable:[],...extra});
const unknown=()=>({present:true,index:2,kind:null,kinds:[],objectLoaded:true,isGhost:false,isBroken:false,isFull:null,usable:null,complete:false,unavailable:['Custom behavior flags unavailable']});
const node=(i,extra={})=>({key:i+',0,0',x:i,y:0,elementIndex:0,baseZ:64,edges:5,slopeDirection:null,isQueue:false,nativeAvailable:true,next:[],furniture:none(),...extra});
const exit=(ride=10,station=0,start='0,0,0',extra={})=>({key:'exit:'+ride+':'+station,kind:'ride_exit',ride,name:'Ride '+ride,rideStatus:'open',station,x:0,y:0,baseZ:64,status:'healthy',doorChecks:[{connections:[start]}],...extra});
const shop=(ride=20,start='0,0,0',extra={})=>({key:'shop:'+ride,kind:'shop',ride,name:'Shop '+ride,rideStatus:'open',station:null,x:0,y:0,baseZ:64,status:'healthy',doorChecks:[{connections:[start]}],...extra});
const pricingSupport={constants:{noneItem:255},items:[]};
pricingSupport.items[18]={id:18,name:'meal',isFood:true,isDrink:false,isSouvenir:false,isPhoto:false,isContainer:false};
pricingSupport.items[19]={id:19,name:'drink',isFood:false,isDrink:true,isSouvenir:false,isPhoto:false,isContainer:false};
pricingSupport.items[20]={id:20,name:'souvenir',isFood:false,isDrink:false,isSouvenir:true,isPhoto:false,isContainer:false};
pricingSupport.items[21]={id:21,name:'emptyContainer',isFood:false,isDrink:false,isSouvenir:false,isPhoto:false,isContainer:true};
function fixture({length=14,nausea=823,endpoints=[exit()],rides,paths}={}){
    paths=paths||Array.from({length},(_,i)=>node(i));
    if(!arguments[0]?.paths)for(let i=0;i<paths.length;i++)paths[i].next=[...(i?[paths[i-1].key]:[]),...(i+1<paths.length?[paths[i+1].key]:[])];
    const publicBoth=Object.fromEntries(paths.filter(p=>!p.isQueue).map(p=>[p.key,true]));
    return {paths,endpoints,rideById:rides||{10:{id:10,name:'Ride 10',status:'open',nausea,object:{shopItem:255,shopItemSecondary:255}}},
        publicBoth,publicOut:{...publicBoth},pricingSupport,complete:true,truncated:false};
}
function run(input=fixture(),options={},units=4096){
    const job=Amenity.create(input,options);let turns=0;
    while(!job.done){job.step(units);assert(++turns<100000,'bounded audit must terminate');}
    return job.result();
}
function site(result,key='exit:10:0'){const found=result.sites.find(s=>s.key===key);assert(found,'missing local site '+key);return found;}
function codes(result){return result.observations.map(o=>o.code);}
function stock(input,{benches=[1,2,3,4,5,6,7],bins=[0]}={}){
    for(const i of benches)input.paths[i].furniture=bench();for(const i of bins)input.paths[i].furniture=bin();return input;
}

test('distant park-wide benches do not satisfy a nauseating ride exit',()=>{
    const input=fixture({length:31});for(let i=21;i<29;i++)input.paths[i].furniture=bench();input.paths[0].furniture=bin();
    const report=run(input),local=site(report);
    assert.equal(local.targets.benches,7);assert.equal(local.counts.usableBenches,0);assert.equal(local.deficits.benches,7);assert.equal(local.deficits.bins,0);
    assert(codes(report).includes('local_bench_shortfall'));assert(!codes(report).includes('local_bin_shortfall'));
});

test('nausea uses raw hundredths and the threshold includes exactly 250',()=>{
    for(const [nausea,target]of[[0,0],[249,0],[250,2],[399,2],[400,3],[599,3],[600,5],[799,5],[800,7],[823,7]]){
        const input=fixture({nausea});input.paths[0].furniture=bin();const result=run(input),local=site(result);
        assert.equal(local.nausea,nausea);assert.equal(local.targets.benches,target,'raw nausea '+nausea);assert.equal(local.deficits.benches,target);assert.equal(local.targets.bins,1);
        assert.equal(codes(result).includes('local_bench_shortfall'),target>0);
    }
});

test('a gentle ride still needs a nearby bin and does not acquire a bench requirement',()=>{
    const report=run(fixture({nausea:0})),local=site(report);
    assert.deepEqual(local.targets,{benches:0,bins:1});assert.equal(local.deficits.benches,0);assert.equal(local.deficits.bins,1);
    assert(!codes(report).includes('local_bench_shortfall'));assert(codes(report).includes('local_bin_shortfall'));
});

test('a gentle ride reports an existing exit bench while keeping its bench target at zero',()=>{
    const input=stock(fixture({nausea:240}),{benches:[0],bins:[1]});input.publicBoth={};const report=run(input),local=site(report);
    assert.equal(local.targets.benches,0);assert.equal(local.counts.usableBenches,1);assert.equal(local.nearest.benches,0);assert.equal(local.deficits.benches,0);
    assert.equal(local.spacing.benches,'not_required');assert.deepEqual(local.candidates.benches,[]);assert(!codes(report).includes('local_bench_shortfall'));assert(!codes(report).includes('local_bench_spacing'));
});

test('locality counts native path hops, including a tile at the radius boundary',()=>{
    const input=fixture({nausea:250,length:24});input.paths[9].furniture=bench();input.paths[10].furniture=bench();input.paths[6].furniture=bin();
    const local=site(run(input));assert.equal(local.deficits.benches,0);assert.equal(local.deficits.bins,0);
    assert.deepEqual(local.radii,{benches:10,bins:6});
    input.paths[10].furniture=none();input.paths[11].furniture=bench();input.paths[6].furniture=none();input.paths[7].furniture=bin();
    const farther=site(run(input));assert.equal(farther.counts.usableBenches,1);assert.equal(farther.deficits.benches,1);assert.equal(farther.deficits.bins,1);
});

test('adequate total seating still needs a first rest area near the ride exit',()=>{
    const input=stock(fixture({nausea:250}),{benches:[9,10],bins:[0]});let report=run(input),local=site(report);
    assert.equal(local.deficits.benches,0);assert.equal(local.nearest.benches,9);assert.equal(local.spacing.benches,'too_far');assert(codes(report).includes('local_bench_spacing'));
    input.paths[9].furniture=none();input.paths[4].furniture=bench();report=run(input);local=site(report);
    assert.equal(local.nearest.benches,4);assert.equal(local.spacing.benches,'ok');assert(!codes(report).includes('local_bench_spacing'));
    const high=stock(fixture({nausea:823}),{benches:[4,5,6,7,8,9,10],bins:[0]});
    const nauseaLocal=site(run(high));assert.equal(nauseaLocal.deficits.benches,0);assert.equal(nauseaLocal.spacing.benches,'too_far','a high nausea exit needs its first rest area within three path steps');
});

test('adjacent-looking paths separated by an absent native join cannot supply exit amenities',()=>{
    const paths=[node(0),node(1,{furniture:bench()}),node(2,{furniture:bin()})],input=fixture({paths,nausea:250});
    const local=site(run(input));assert.equal(local.counts.usableBenches,0);assert.equal(local.counts.usableBins,0);assert.equal(local.deficits.benches,2);assert.equal(local.deficits.bins,1);
    // A wall/fence affects this audit only through the already inspected graph.
    paths[0].next=[paths[1].key];paths[1].next=[paths[2].key];
    const joined=site(run(input));assert.equal(joined.counts.usableBenches,1);assert.equal(joined.counts.usableBins,1);
});

test('stacked paths at the same XY are separate until a real slope route links them',()=>{
    const root=node(0),upper=node(0,{key:'0,0,1',elementIndex:1,baseZ:80,furniture:bench()}),ramp=node(1,{slopeDirection:2}),trash=node(2,{furniture:bin()});
    const input=fixture({paths:[root,upper,ramp,trash],nausea:250});root.next=[trash.key];
    assert.equal(site(run(input)).counts.usableBenches,0);
    root.next=[trash.key,ramp.key];ramp.next=[upper.key];
    assert.equal(site(run(input)).counts.usableBenches,1,'an actual native slope connection can reach another height layer');
});

test('queues and reverse-only links are not public shortcuts from the ride exit',()=>{
    const root=node(0,{furniture:bin()}),queue=node(1,{isQueue:true}),rest=node(2,{furniture:bench()});
    root.next=[queue.key];queue.next=[rest.key];rest.next=[root.key];
    const input=fixture({paths:[root,queue,rest],nausea:250});input.publicBoth[queue.key]=true;input.publicOut[queue.key]=true;
    assert.equal(site(run(input)).counts.usableBenches,0,'even a misleading public set cannot make a queue public transit');
    root.next=[];assert.equal(site(run(input)).counts.usableBenches,0,'the bench-to-exit link cannot be traversed in reverse');
    root.next=[rest.key];assert.equal(site(run(input)).counts.usableBenches,1);
});

test('private or disconnected paths outside the verified public network do not cover an exit',()=>{
    const input=stock(fixture({nausea:250}),{benches:[1,2],bins:[0]});
    delete input.publicBoth[input.paths[1].key];delete input.publicBoth[input.paths[2].key];delete input.publicOut[input.paths[1].key];delete input.publicOut[input.paths[2].key];
    const local=site(run(input));assert.equal(local.counts.usableBenches,0);assert.equal(local.deficits.benches,2);
});

test('broken, ghost, full and geometrically unusable furniture does not satisfy demand',()=>{
    const input=fixture({nausea:250});
    input.paths[0].furniture=bin({isFull:true,usable:false,binSlots:[{direction:1,spaceLeft:0,isFull:true},{direction:3,spaceLeft:0,isFull:true}]});
    input.paths[1].furniture=bench({isBroken:true,usable:false});input.paths[2].furniture=bench({isGhost:true,usable:false});
    input.paths[3].edges=15;input.paths[3].furniture=bench({usable:false});
    input.paths[4].slopeDirection=2;input.paths[4].furniture=bench({usable:false});
    const local=site(run(input));assert.equal(local.counts.usableBenches,0);assert.equal(local.counts.usableBins,0);assert.equal(local.deficits.benches,2);assert.equal(local.deficits.bins,1);
    assert(!local.candidates.benches.some(c=>[1,2,3,4].some(i=>input.paths[i].key===c.key)),'do not suggest overwriting existing additions or slopes');
});

test('a partly filled bin still covers litter demand when another actual slot can accept litter',()=>{
    const input=stock(fixture({nausea:250}),{benches:[1,2],bins:[]});
    input.paths[0].furniture=bin({isFull:true,usable:true,binSlots:[{direction:1,spaceLeft:0,isFull:true},{direction:3,spaceLeft:2,isFull:false}]});
    const local=site(run(input));assert.equal(local.counts.usableBins,1);assert.equal(local.deficits.bins,0);assert.equal(local.deficits.benches,0);
});

test('unloaded furniture cannot prove positive seating or bin coverage',()=>{
    const input=fixture({nausea:250});input.paths[1].furniture=bench({objectLoaded:false});input.paths[2].furniture=bin({objectLoaded:false});
    const local=site(run(input));assert.equal(local.counts.usableBenches,0);assert.equal(local.counts.usableBins,0);
    assert.equal(local.deficits.benches,null);assert.equal(local.deficits.bins,null,'an inconsistent unloaded definition leaves behavior unknown');
});

test('custom combined bench and bin behavior cannot certify missing bin-slot data',()=>{
    const input=fixture({nausea:250});input.paths[1].furniture=bench({kind:'multiple',kinds:['bench','bin'],complete:false,binSlots:null,usable:true});
    const local=site(run(input));assert.equal(local.counts.usableBenches,1,'known bench behavior is still positive evidence');
    assert.equal(local.counts.usableBins,0);assert.equal(local.deficits.bins,null,'the combined usable flag comes from seating, not measured bin slots');
    assert.equal(local.spacing.bins,'unknown');
});

test('unknown custom behavior leaves negative coverage unknown rather than claiming an absence',()=>{
    const input=fixture({nausea:250});input.paths[1].furniture=unknown();const report=run(input),local=site(report);
    assert.equal(local.status,'unknown');assert.equal(local.complete,false);assert.equal(local.deficits.benches,null);assert.equal(local.deficits.bins,null);
    assert(codes(report).includes('local_amenities_unknown'));assert(!codes(report).includes('local_bench_shortfall'));assert(!codes(report).includes('local_bin_shortfall'));
    input.paths[1].furniture=unknown();input.paths[0].furniture=bin();input.paths[2].furniture=bench();input.paths[3].furniture=bench();
    const covered=site(run(input));assert.equal(covered.deficits.benches,0);assert.equal(covered.deficits.bins,0,'positive coverage is still proved by known working furniture');
});

test('unknown furniture near the exit suppresses a false first-rest-area spacing warning',()=>{
    const input=stock(fixture({nausea:250}),{benches:[9,10],bins:[0]});input.paths[1].furniture=unknown();
    const report=run(input),local=site(report);assert.equal(local.deficits.benches,0);assert.equal(local.spacing.benches,'unknown');assert.equal(local.complete,false);
    assert(!codes(report).includes('local_bench_spacing'),'the unclassified object could itself be a nearby bench');
});

test('unreadable paths and unfinished graph scans suppress unproved local shortfalls',()=>{
    for(const change of [input=>{input.complete=false;},input=>{input.truncated=true;},input=>{delete input.paths[1].furniture;},input=>{input.paths[1].nativeAvailable=false;},input=>{delete input.paths[1].nativeAvailable;}]){
        const input=fixture({nausea:250});change(input);const report=run(input),local=site(report);
        assert.equal(local.complete,false);assert.equal(local.deficits.benches,null);assert.equal(local.deficits.bins,null);assert(!codes(report).includes('local_bench_shortfall'));
    }
});

test('a search work cap yields unknown demand instead of reporting that existing distant seats are missing',()=>{
    const input=stock(fixture({nausea:250}),{benches:[2,3],bins:[0]});const report=run(input,{maxSearchWork:1}),local=site(report);
    assert.equal(report.complete,false);assert.equal(local.complete,false);assert.equal(local.deficits.benches,null);assert(!codes(report).includes('local_bench_shortfall'));
    assert.equal(local.deficits.bins,0,'already observed positive coverage remains valid');
});

test('unknown nausea is not treated as a zero nausea rating',()=>{
    for(const nausea of [undefined,null,-1,32768,65534,65535,NaN,'823']){
        const input=fixture({nausea});if(nausea===undefined)delete input.rideById[10].nausea;
        input.paths[0].furniture=bin();const local=site(run(input));assert.equal(local.targets.benches,null);assert.equal(local.deficits.benches,null);assert.equal(local.deficits.bins,0);assert.equal(local.complete,false);
    }
});

test('the largest valid signed native rating remains known',()=>{
    const local=site(run(fixture({nausea:32767})));assert.equal(local.nausea,32767);assert.equal(local.targets.benches,7);
});

test('unknown demand at one ride does not erase a separately known ride shortfall',()=>{
    const endpoints=[exit(10),exit(11)],rides={10:{id:10,name:'Unknown ride',status:'open',nausea:null},11:{id:11,name:'Known ride',status:'open',nausea:500}};
    const input=fixture({endpoints,rides});input.paths[0].furniture=bin();const report=run(input);
    assert.equal(site(report,'exit:10:0').deficits.benches,null);
    assert.equal(site(report,'exit:11:0').deficits.benches,3);assert.equal(site(report,'exit:11:0').complete,true);
    assert(report.observations.some(o=>o.code==='local_bench_shortfall'&&o.ride===11));
});

test('food and drink sales request local seating and bins while souvenir and container shops do not',()=>{
    const endpoints=[shop(20),shop(21),shop(22),shop(23)],rides={
        20:{id:20,name:'Food',status:'open',object:{shopItem:18,shopItemSecondary:255}},
        21:{id:21,name:'Drinks',status:'open',object:{shopItem:255,shopItemSecondary:19}},
        22:{id:22,name:'Souvenirs',status:'open',object:{shopItem:20,shopItemSecondary:255}},
        23:{id:23,name:'Container',status:'open',object:{shopItem:21,shopItemSecondary:255}}};
    const report=run(fixture({endpoints,rides}));assert.equal(report.sites.length,2);
    for(const id of [20,21]){const local=site(report,'shop:'+id);assert.deepEqual(local.targets,{benches:3,bins:2});assert.deepEqual(local.radii,{benches:8,bins:10});assert.equal(local.deficits.benches,3);assert.equal(local.deficits.bins,2);}
});

test('food shops need both nearby bins and seats even when further furniture meets their total targets',()=>{
    const endpoints=[shop(20)],rides={20:{id:20,name:'Food',status:'open',object:{shopItem:18,shopItemSecondary:255}}};
    const input=stock(fixture({endpoints,rides}),{benches:[6,7,8],bins:[9,10]});const report=run(input),local=site(report,'shop:20');
    assert.deepEqual(local.deficits,{benches:0,bins:0});assert.equal(local.spacing.benches,'too_far');assert.equal(local.spacing.bins,'too_far');
    assert(codes(report).includes('local_bench_spacing'));assert(codes(report).includes('local_bin_spacing'));
});

test('shared nearby amenities can cover several exits and food shops without adding their targets',()=>{
    const endpoints=[exit(10,0),exit(10,1),shop(20)],rides={10:{id:10,name:'Ride',status:'open',nausea:400,object:{shopItem:255,shopItemSecondary:255}},
        20:{id:20,name:'Food',status:'open',object:{shopItem:18,shopItemSecondary:255}}};
    const input=stock(fixture({endpoints,rides}),{benches:[1,2,3],bins:[0,4]});const report=run(input);
    assert.equal(report.sites.length,3);for(const local of report.sites){assert.equal(local.deficits.benches,0);assert.equal(local.deficits.bins,0);assert.equal(local.counts.usableBenches,3);}
    assert.equal(report.summary.sitesWithShortfalls,0);assert(!codes(report).includes('local_bench_shortfall'));assert(!codes(report).includes('local_bin_shortfall'));
});

test('candidate suggestions require empty level public paths and do not claim construction legality',()=>{
    const input=fixture({nausea:250});input.paths[1].furniture=bench();input.paths[2].furniture=bin();input.paths[3].slopeDirection=2;input.paths[4].edges=15;
    input.paths[5].furniture={...none(),present:null,complete:false};delete input.publicBoth[input.paths[6].key];delete input.publicOut[input.paths[6].key];
    const local=site(run(input));const forbidden=[1,2,3,4,5,6].map(i=>input.paths[i].key);
    assert(local.candidates.benches.length>0);assert(local.candidates.bins.length>0);
    for(const kind of ['benches','bins'])for(const candidate of local.candidates[kind]){assert(!forbidden.includes(candidate.key));assert(Number.isInteger(candidate.distance));assert(candidate.distance<=local.radii[kind]);}
});

test('one local-site check per station stays bounded, resumable and read-only',()=>{
    const endpoints=Array.from({length:20},(_,station)=>exit(10,station)),input=stock(fixture({endpoints,nausea:823}));
    const before=JSON.stringify(input),job=Amenity.create(input,{maxCandidatesPerKind:2});assert.equal(job.done,false);
    job.step(1);assert.equal(job.done,false,'one work unit must not finish twenty site searches');
    let steps=1;while(!job.done){job.step(1);assert(++steps<100000);}
    const report=job.result();assert.equal(report.sites.length,20);assert.equal(report.summary.rideExits,20);assert.equal(report.summary.sitesWithShortfalls,0);
    for(const local of report.sites){assert(local.candidates.benches.length<=2);assert(local.candidates.bins.length<=2);}
    assert.equal(JSON.stringify(input),before,'inspection does not change paths, ride metadata or the public graph');
});

test('site and path caps remain explicit incomplete evidence instead of silently dropping requirements',()=>{
    const input=fixture({endpoints:Array.from({length:5},(_,station)=>exit(10,station))});
    const capped=run(input,{maxSites:2});assert.equal(capped.complete,false);assert(capped.sites.length<=2);assert(capped.unavailable.length>0);
    const paths=run(fixture({nausea:250}),{maxPaths:2});assert.equal(paths.complete,false);assert.equal(site(paths).deficits.benches,null);assert.equal(site(paths).deficits.bins,null);
});

test('construction-stage exits remain informational while open rides receive amenity advisories',()=>{
    for(const rideStatus of ['open','closed','testing']){
        const input=fixture({nausea:250,endpoints:[exit(10,0,'0,0,0',{rideStatus})]}),report=run(input);
        const observations=report.observations.filter(o=>o.code==='local_bench_shortfall'||o.code==='local_bin_shortfall');assert.equal(observations.length,2);
        assert(observations.every(o=>o.severity===(rideStatus==='open'?'advisory':'info')));
    }
});

test('invalid work quanta and cap values are rejected before an unbounded audit',()=>{
    for(const units of [0,-1,0.5,4097,'1'])assert.throws(()=>Amenity.create(fixture()).step(units),/workUnits/);
    for(const options of [{maxSearchWork:0},{maxSites:513},{maxPaths:32769},{maxCandidatesPerKind:0}])assert.throws(()=>Amenity.create(fixture(),options),/must be an integer/);
});

test('a no-entry-protected outward exit can use its own working benches and bins',()=>{
    const input=stock(fixture({nausea:250}),{benches:[1,2],bins:[0]});input.publicBoth={};
    for(let i=0;i<input.paths.length;i++)input.paths[i].next=i+1<input.paths.length?[input.paths[i+1].key]:[];
    const local=site(run(input));assert.equal(local.routePolicy,'outbound_to_park');assert.equal(local.complete,true);assert.equal(local.status,'ok');
    assert.equal(local.counts.usableBenches,2);assert.equal(local.counts.usableBins,1);assert.deepEqual(local.deficits,{benches:0,bins:0});
});

test('an empty outward-only exit produces known shortfalls instead of unknown network coverage',()=>{
    const input=fixture({nausea:250});input.publicBoth={};const report=run(input),local=site(report);
    assert.equal(local.complete,true);assert.equal(local.status,'advisories');assert.deepEqual(local.deficits,{benches:2,bins:1});
    assert(codes(report).includes('local_bench_shortfall'));assert(codes(report).includes('local_bin_shortfall'));assert(!codes(report).includes('local_amenities_unknown'));
});

test('a reversed banner that removes the route to the park cannot produce a clear exit amenity result',()=>{
    const input=stock(fixture({nausea:250}),{benches:[1,2],bins:[0]});delete input.publicOut[input.paths[0].key];
    input.endpoints[0].status='unreachable';const local=site(run(input));assert.equal(local.complete,false);assert.equal(local.status,'unknown');
    assert.equal(local.deficits.benches,null);assert.equal(local.deficits.bins,null);assert.equal(local.counts.usableBenches,0);
});

test('outward-only public paths do not give shops customer round-trip access',()=>{
    const input=stock(fixture({endpoints:[shop(20)],rides:{20:{id:20,name:'Food',status:'open',object:{shopItem:18,shopItemSecondary:255}}}}),{benches:[1,2,3],bins:[0,4]});
    input.publicBoth={};const local=site(run(input),'shop:20');assert.equal(local.routePolicy,'round_trip_public');assert.equal(local.complete,false);assert.equal(local.status,'unknown');
    assert.equal(local.deficits.benches,null);assert.equal(local.deficits.bins,null);assert.equal(local.counts.usableBenches,0);
});

test('missing outward coverage never falls back to the stricter public intersection',()=>{
    const input=stock(fixture({nausea:250}),{benches:[1,2],bins:[0]});delete input.publicOut;
    const local=site(run(input));assert.equal(local.status,'unknown');assert.equal(local.complete,false);assert.equal(local.deficits.benches,null);assert.equal(local.deficits.bins,null);
});

test('missing round-trip coverage leaves a valid exit useful and only the food shop unknown',()=>{
    const input=stock(fixture({nausea:250,endpoints:[exit(),shop(20)],rides:{10:{id:10,name:'Ride',status:'open',nausea:250},20:{id:20,name:'Food',status:'open',object:{shopItem:18,shopItemSecondary:255}}}}),{benches:[1,2,3],bins:[0,4]});
    delete input.publicBoth;const report=run(input);assert.equal(site(report).status,'ok');assert.equal(site(report).complete,true);
    assert.equal(site(report,'shop:20').status,'unknown');assert.equal(site(report,'shop:20').complete,false);
});

test('outbound search excludes parked branches and queue shortcuts even if they look close',()=>{
    const root=node(0,{furniture:bin()}),queue=node(1,{isQueue:true}),seats=node(2,{furniture:bench()}),deadEnd=node(3,{furniture:bench()});
    root.next=[queue.key,deadEnd.key];queue.next=[seats.key];const input=fixture({paths:[root,queue,seats,deadEnd],nausea:250});input.publicBoth={};
    input.publicOut[queue.key]=true;delete input.publicOut[deadEnd.key];
    const local=site(run(input));assert.equal(local.counts.usableBenches,0);assert.equal(local.deficits.benches,2);assert.equal(local.deficits.bins,0);
});

test('several stations share outward-only furniture while the work remains resumable',()=>{
    const input=stock(fixture({endpoints:Array.from({length:12},(_,station)=>exit(10,station)),nausea:250}),{benches:[1,2],bins:[0]});input.publicBoth={};
    const job=Amenity.create(input);job.step(1);assert.equal(job.done,false);let turns=0;while(!job.done){job.step(1);assert(++turns<10000);}
    const report=job.result();assert.equal(report.sites.length,12);assert.equal(report.summary.sitesWithShortfalls,0);assert(report.sites.every(s=>s.complete&&s.deficits.benches===0&&s.deficits.bins===0));
});
