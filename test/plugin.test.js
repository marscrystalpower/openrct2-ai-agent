'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const fixtures=require('./fixtures/segments.json');
const bundle=fs.readFileSync(path.join(__dirname,'../dist/agent-bridge.js'),'utf8');
const config=require('../bridge.config.json');
function harness(options={}){
    let connection;const hooks={},sent=[],calls=[],timers=[],store=options.store||{},rideList=options.rides||[],saved=[];let nextRide=12;
    const listener={on:(event,fn)=>{connection=fn;return listener;},listen:(port,host)=>{assert.equal(host,'127.0.0.1');return listener;}};
    const context={mode:'normal',apiVersion:122,paused:false,gameSpeed:0,
        sharedStorage:{get:k=>store[k],set:(k,v)=>{store[k]=JSON.parse(JSON.stringify(v));}},subscribe:(name,fn)=>{hooks[name]=fn;},
        getTrackSegment:id=>fixtures[id],getAllTrackSegments:()=>Object.values(fixtures),setTimeout:fn=>{timers.push(fn);},
        saveGame:opts=>{if(options.failSave)throw Error('disk unavailable');saved.push(opts);},
        queryAction:(action,args,cb)=>{if(options.onQuery)options.onQuery(action,args);cb(options.rejectQuery===calls.length?{error:1,errorMessage:'Blocked'}:{cost:10});},
        executeAction:(action,args,cb)=>{
            calls.push({action,args:JSON.parse(JSON.stringify(args))});
            if(options.neverReply)return;
            if(action==='ridecreate'){const id=nextRide++;rideList.push({id,type:args.rideType,status:'closed'});cb({cost:10,ride:id});}
            else cb({cost:10});
        }};
    vm.runInNewContext(bundle,{context,network:{mode:'none',createListener:()=>listener},map:{size:{x:128,y:128},rides:rideList,getRide:id=>rideList.find(r=>r.id===id),getTrackIterator:options.iterator},park:{cash:10000},scenario:{},date:{},console:{log:()=>{}},registerPlugin:meta=>meta.main()});
    const events={};connection({on:(e,fn)=>{events[e]=fn;},write:line=>sent.push(JSON.parse(line)),end:()=>{}});
    let serial=10000000;
    function request(op,args={},extra={}){
        const req={id:String(++serial),op,args,token:config.token,...extra};events.data(JSON.stringify(req)+'\n');
        return {req,reply:sent.find(r=>r.id===req.id)};
    }
    function flush(){let max=5000;while(timers.length && --max)timers.shift()();assert.ok(max>0);}
    const session=request('hello').reply.result.session;
    function arm(){return request('arm',{}, {session});}
    return {request,flush,arm,session,sent,calls,hooks,store,events,context,saved};
}
const price={action:'ridesetprice',args:{ride:0,price:100,isPrimaryPrice:true}};
test('ride and rides expose operating getters without arming or changing settings',()=>{
    const operating={departFlags:203,minimumWaitingTime:20,maximumWaitingTime:60,liftHillSpeed:5,minLiftHillSpeed:3,maxLiftHillSpeed:5};
    const ride={id:9,mode:34,vehicles:[104,109],stations:[]};
    for(const [key,value] of Object.entries(operating))Object.defineProperty(ride,key,{get:()=>value,set:()=>{throw Error('read-only inspection wrote '+key);}});
    const h=harness({rides:[ride]});
    for(const result of [h.request('ride',{ride:9}).reply.result,h.request('rides').reply.result[0]]){
        for(const [key,value] of Object.entries(operating))assert.equal(result[key],value,key);
        assert.equal(result.mode,34);assert.deepEqual(result.vehicles,[104,109]);
    }
    assert.equal(h.request('hello').reply.result.armed,false);assert.equal(h.calls.length,0);
});
test('operating inspection preserves zero values and omits unsupported properties',()=>{
    const h=harness({rides:[{id:0,departFlags:0,minimumWaitingTime:0,maximumWaitingTime:0,liftHillSpeed:0,minLiftHillSpeed:0,maxLiftHillSpeed:0},{id:1}]});
    const zero=h.request('ride',{ride:0}).reply.result,missing=h.request('ride',{ride:1}).reply.result;
    for(const key of ['departFlags','minimumWaitingTime','maximumWaitingTime','liftHillSpeed','minLiftHillSpeed','maxLiftHillSpeed']){
        assert.equal(zero[key],0);assert.equal(Object.hasOwn(missing,key),false);
    }
});
test('authentication and read-only startup block mutations',()=>{
    const h=harness();assert.equal(h.request('hello',{}, {token:'wrong'}).reply.ok,false);
    assert.match(h.request('action.execute',{...price,maxCost:100},{session:h.session}).reply.error,/read-only/);assert.equal(h.calls.length,0);
});
test('queries remain read-only and expose actual engine failure',()=>{
    const h=harness({rejectQuery:0});const r=h.request('action.query',price).reply;assert.equal(r.result.error,1);assert.equal(h.calls.length,0);
});
test('exact completed request returns receipt without executing twice',()=>{
    const h=harness();h.arm();const {req}=h.request('action.execute',{...price,maxCost:100},{session:h.session});h.flush();
    h.events.data(JSON.stringify(req)+'\n');assert.equal(h.calls.length,1);assert.equal(h.sent.at(-1).result.state,'completed');
});
test('same request ID with different content is rejected',()=>{
    const h=harness();h.arm();const {req}=h.request('action.execute',{...price,maxCost:100},{session:h.session});h.flush();
    req.args.maxCost=200;h.events.data(JSON.stringify(req)+'\n');assert.match(h.sent.at(-1).error,/different content/);
});
test('budget exhaustion stops before overspending and reports partial build',()=>{
    const h=harness();h.arm();h.request('batch.execute',{actions:[price,price],maxCost:15},{session:h.session});h.flush();
    assert.equal(h.calls.length,1);assert.equal(h.sent.at(-1).result.state,'partial');assert.equal(h.sent.at(-1).result.spent,10);
});
test('STOP interrupts a batch between actions',()=>{
    const h=harness();h.arm();h.request('batch.execute',{actions:[price,price],maxCost:100},{session:h.session});h.request('stop');h.flush();
    assert.equal(h.calls.length,1);assert.equal(h.sent.at(-1).result.state,'stopped');
});
test('map change revokes session and prevents pending actions',()=>{
    const h=harness();h.arm();h.request('batch.execute',{actions:[price,price],maxCost:100},{session:h.session});h.hooks['map.change']();h.flush();
    assert.equal(h.calls.length,1);assert.equal(h.sent.at(-1).result.state,'stopped');assert.match(h.request('arm',{}, {session:h.session}).reply.error,/Stale/);
});
test('crash after dispatch never replays an unresolved action after restart',()=>{
    const h=harness({neverReply:true});h.arm();const {req}=h.request('action.execute',{...price,maxCost:100},{session:h.session});
    const restarted=harness({store:h.store});restarted.events.data(JSON.stringify(req)+'\n');
    assert.equal(restarted.calls.length,0);assert.equal(restarted.sent.at(-1).result.state,'started');assert.equal(restarted.sent.at(-1).result.inFlight.index,0);
});
test('coaster construction chains returned ride ID through all 48 pieces',()=>{
    const h=harness();h.arm();const plan=h.request('track.plan',require('../examples/custom-coaster-plan.json').args).reply;
    assert.equal(plan.ok,true);h.request('coaster.build',{planId:plan.result.planId,maxCost:100000,create:{rideType:0,rideObject:0,entranceObject:0,colour1:0,colour2:0,inspectionInterval:0},name:'Circuit',test:true},{session:h.session});h.flush();
    assert.equal(h.calls.length,51);assert.equal(h.calls[0].action,'ridecreate');
    for(const call of h.calls.slice(1))assert.equal(call.args.ride,12);
    assert.equal(h.calls.at(-1).action,'ridesetstatus');assert.equal(h.sent.at(-1).result.state,'completed');
});
test('blocked construction stops at rejected piece with recoverable ride ID',()=>{
    const h=harness({rejectQuery:4});h.arm();const plan=h.request('track.plan',require('../examples/custom-coaster-plan.json').args).reply;
    h.request('coaster.build',{planId:plan.result.planId,maxCost:100000,create:{rideType:0,rideObject:0,entranceObject:0,colour1:0,colour2:0,inspectionInterval:0}},{session:h.session});h.flush();
    assert.equal(h.calls.length,4);assert.equal(h.sent.at(-1).result.state,'partial');assert.equal(h.sent.at(-1).result.ride,12);
});
test('malformed/coalesced/fragmented TCP frames are handled independently',()=>{
    const h=harness(),msg=JSON.stringify({id:'abcdefgh',op:'hello',token:config.token});
    h.events.data(msg.slice(0,10));h.events.data(msg.slice(10)+'\nnot-json\n'+msg+'\n');
    assert.equal(h.sent.filter(r=>r.id==='abcdefgh').length,2);assert.ok(h.sent.some(r=>r.error==='Invalid JSON'));
});
test('save uses a unique bridge filename and does not claim file verification',()=>{
    const h=harness();h.arm();const {req,reply}=h.request('save',{filename:'overwrite-existing'},{session:h.session});
    assert.equal(h.saved[0].filename,'agent-checkpoint-'+req.id);assert.equal(reply.result.fileVerified,false);assert.equal(reply.result.state,'completed');
    h.events.data(JSON.stringify(req)+'\n');assert.equal(h.saved.length,1);
});
test('failed save reports uncertain outcome without retry',()=>{
    const h=harness({failSave:true});h.arm();assert.equal(h.request('save',{}, {session:h.session}).reply.result.state,'outcome_unknown');
});
test('track traversal converts public tile units to native world units',()=>{
    const h=harness({iterator:(position,index)=>{assert.deepEqual(JSON.parse(JSON.stringify(position)),{x:320,y:640});assert.equal(index,1);return {position:{x:320,y:640,z:64,direction:0},segment:{type:0},nextPosition:{x:288,y:640,z:64,direction:0},next:()=>false};}});
    const r=h.request('track.walk',{x:10,y:20,elementIndex:1}).reply;assert.equal(r.ok,true);assert.equal(r.result.reason,'gap');
});
test('native getter station fields are serialized and unused stations omitted',()=>{
    const station=Object.create(null);Object.defineProperties(station,{length:{get:()=>4},start:{get:()=>({x:10,y:20,z:64})},queueTime:{get:()=>0}});
    const h=harness({rides:[{id:0,stations:[station,{length:0}],incomePerHour:-9223372036854776000}]});
    const r=h.request('ride',{ride:0}).reply.result;assert.equal(r.stations.length,1);assert.equal(r.stations[0].length,4);assert.equal(r.stations[0].start.x,10);assert.equal(r.incomePerHour,null);
});
