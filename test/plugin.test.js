'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const fixtures=require('./fixtures/segments.json');
const bundle=fs.readFileSync(path.join(__dirname,'../dist/agent-bridge.js'),'utf8');
const config=require('../bridge.config.json');
function harness(options={}){
    let connection;const hooks={},sent=[],calls=[],queries=[],timers=[],store=options.store||{},rideList=options.rides||[],saved=[];let nextRide=12;
    const objects=options.objects||[{index:0,rideType:[0]}];
    const research=Object.hasOwn(options,'research')?options.research:{isObjectResearched:()=>true};
    const objectManager={getObject:(type,index)=>objects.find(o=>o.index===index),getAllObjects:()=>objects};
    const listener={on:(event,fn)=>{connection=fn;return listener;},listen:(port,host)=>{assert.equal(host,'127.0.0.1');return listener;}};
    const context={mode:'normal',apiVersion:122,paused:false,gameSpeed:0,
        sharedStorage:{get:k=>store[k],set:(k,v)=>{store[k]=JSON.parse(JSON.stringify(v));}},subscribe:(name,fn)=>{hooks[name]=fn;},
        getTrackSegment:id=>fixtures[id],getAllTrackSegments:()=>Object.values(fixtures),setTimeout:fn=>{timers.push(fn);},
        saveGame:opts=>{if(options.failSave)throw Error('disk unavailable');saved.push(opts);},
        queryAction:(action,args,cb)=>{queries.push({action,args:JSON.parse(JSON.stringify(args))});if(options.onQuery)options.onQuery(action,args);cb(options.rejectQuery===calls.length?{error:1,errorMessage:'Blocked'}:{cost:10});},
        executeAction:(action,args,cb)=>{
            calls.push({action,args:JSON.parse(JSON.stringify(args))});
            if(options.neverReply)return;
            if(action==='ridecreate'){const id=nextRide++;rideList.push({id,type:args.rideType,object:objectManager.getObject('ride',args.rideObject),status:'closed'});cb({cost:10,ride:id});}
            else cb({cost:10});
        }};
    vm.runInNewContext(bundle,{context,objectManager,network:{mode:'none',createListener:()=>listener},map:{size:{x:128,y:128},rides:rideList,getRide:id=>rideList.find(r=>r.id===id),getTrackIterator:options.iterator},park:{cash:10000,research},scenario:{},date:{},console:{log:()=>{}},registerPlugin:meta=>meta.main()});
    const events={};connection({on:(e,fn)=>{events[e]=fn;},write:line=>sent.push(JSON.parse(line)),end:()=>{}});
    let serial=10000000;
    function request(op,args={},extra={}){
        const req={id:String(++serial),op,args,token:config.token,...extra};events.data(JSON.stringify(req)+'\n');
        return {req,reply:sent.find(r=>r.id===req.id)};
    }
    function flush(){let max=5000;while(timers.length && --max)timers.shift()();assert.ok(max>0);}
    const session=request('hello').reply.result.session;
    function arm(){return request('arm',{}, {session});}
    return {request,flush,arm,session,sent,calls,queries,hooks,store,events,context,saved};
}
const price={action:'ridesetprice',args:{ride:0,price:100,isPrimaryPrice:true}};
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
test('coaster construction chains returned ride ID through all 12 pieces',()=>{
    const h=harness();h.arm();const plan=h.request('track.plan',require('../examples/custom-coaster-plan.json').args).reply;
    assert.equal(plan.ok,true);h.request('coaster.build',{planId:plan.result.planId,maxCost:100000,create:{rideType:0,rideObject:0,entranceObject:0,colour1:0,colour2:0,inspectionInterval:0},name:'Circuit',test:true},{session:h.session});h.flush();
    assert.equal(h.calls.length,15);assert.equal(h.calls[0].action,'ridecreate');
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

const create={action:'ridecreate',args:{rideType:0,rideObject:0,entranceObject:0,colour1:0,colour2:0,inspectionInterval:0}};
const cinema={action:'ridecreate',args:{...create.args,rideType:39,rideObject:7}};
const cinemaObject={index:7,rideType:[39,255,255]};
function researchStatus(researched){return {isObjectResearched:(type,index)=>{assert.equal(type,'ride');assert.ok(Number.isInteger(index));return researched;}};}
function finalReply(h,request){h.flush();return h.sent.find(reply=>reply.id===request.req.id);}

test('unresearched cinema query is rejected even when the native query would accept it',()=>{
    const h=harness({objects:[cinemaObject],research:researchStatus(false)});
    const reply=h.request('action.query',cinema).reply;
    assert.equal(reply.ok,false);assert.match(reply.error,/not been researched/);
    assert.equal(h.queries.length,0);assert.equal(h.calls.length,0);
});
for(const op of ['action.execute','batch.execute','coaster.build']){
    test(op+' blocks an unresearched ride before any native query or execution',()=>{
        const h=harness({research:researchStatus(false)});h.arm();
        let args=op==='action.execute'?create:{actions:[create]};
        if(op==='coaster.build')args={create:create.args,planId:h.request('track.plan',require('../examples/custom-coaster-plan.json').args).reply.result.planId};
        const reply=finalReply(h,h.request(op,{...args,maxCost:10000},{session:h.session}));
        assert.equal(reply.result.state,'partial');assert.equal(reply.result.completed.length,0);assert.equal(reply.result.spent,0);
        assert.match(reply.result.detail,/not been researched/);assert.equal(h.queries.length,0);assert.equal(h.calls.length,0);
    });
}
test('researched cinema query and execution reach the native engine',()=>{
    const h=harness({objects:[cinemaObject],research:researchStatus(true)});
    assert.equal(h.request('action.query',cinema).reply.ok,true);assert.equal(h.calls.length,0);
    h.arm();const reply=finalReply(h,h.request('action.execute',{...cinema,maxCost:100},{session:h.session}));
    assert.equal(reply.result.state,'completed');assert.equal(h.queries.length,2);assert.equal(h.calls.length,1);
    assert.deepEqual(h.calls[0],cinema);
});
test('research uses the native bitmap, never invented or uninvented list membership',()=>{
    for(const researched of [false,true]){
        const research=researchStatus(researched);
        // Imported parks can list the active research item as invented. Conversely,
        // multi-type objects need no exact list pair to be available in the build UI.
        research.inventedItems=researched?[]:[{type:'ride',rideType:0,object:0}];
        research.uninventedItems=researched?[{type:'ride',rideType:0,object:0}]:[];
        const h=harness({research}),reply=h.request('action.query',create).reply;
        assert.equal(reply.ok,researched);assert.equal(h.queries.length,researched?1:0);
    }
});
test('every supported non-null ride type of a researched object is accepted',()=>{
    const h=harness({objects:[{index:0,rideType:[0,4,255]}]});
    assert.equal(h.request('action.query',{...create,args:{...create.args,rideType:4}}).reply.ok,true);
    assert.equal(h.queries.length,1);
});
test('creation rejects automatic, wrapped, absent and incompatible object/type identities',()=>{
    for(const change of [{rideObject:65535},{rideObject:-1},{rideObject:65536},{rideObject:1},{rideType:255},{rideType:65536},{rideType:-1},{rideType:4}]){
        const h=harness(),reply=h.request('action.query',{...create,args:{...create.args,...change}}).reply;
        assert.equal(reply.ok,false,JSON.stringify(change));assert.equal(h.queries.length,0);assert.equal(h.calls.length,0);
    }
});
test('missing, throwing and non-boolean research APIs fail closed with a useful error',()=>{
    for(const research of [undefined,null,{},researchStatus(undefined),researchStatus(1),{isObjectResearched:()=>{throw Error('unavailable');}}]){
        const h=harness({research}),reply=h.request('action.query',create).reply;
        assert.equal(reply.ok,false);assert.match(reply.error,/Cannot verify ride research status/);assert.match(reply.error,/API 122/);
        assert.equal(h.queries.length,0);assert.equal(h.calls.length,0);
    }
});
test('research is rechecked after a successful native query and before execution',()=>{
    let researched=true;
    const h=harness({research:{isObjectResearched:()=>researched},onQuery:()=>{researched=false;}});h.arm();
    const reply=finalReply(h,h.request('action.execute',{...create,maxCost:100},{session:h.session}));
    assert.equal(h.queries.length,1);assert.equal(h.calls.length,0);assert.equal(reply.result.state,'partial');
    assert.match(reply.result.detail,/not been researched/);assert.equal(reply.result.inFlight,undefined);
});
test('construction checks fresh research on every batch step and retains prior receipts',()=>{
    let researched=true;
    const h=harness({research:{isObjectResearched:()=>researched}});h.arm();
    const request=h.request('batch.execute',{actions:[price,create],maxCost:100},{session:h.session});researched=false;
    const reply=finalReply(h,request);
    assert.equal(reply.result.state,'partial');assert.equal(reply.result.completed.length,1);assert.equal(reply.result.spent,10);
    assert.equal(h.calls.length,1);assert.equal(h.calls[0].action,'ridesetprice');assert.match(reply.result.detail,/not been researched/);
});
test('finishing research enables a subsequent fresh construction request without restarting',()=>{
    let researched=false;
    const h=harness({research:{isObjectResearched:()=>researched}});h.arm();
    const first=finalReply(h,h.request('action.execute',{...create,maxCost:100},{session:h.session}));assert.equal(first.result.state,'partial');
    researched=true;
    const next=finalReply(h,h.request('action.execute',{...create,maxCost:100},{session:h.session}));assert.equal(next.result.state,'completed');assert.equal(h.calls.length,1);
});
test('rejected construction receipts do not silently replay after research finishes',()=>{
    let researched=false;
    const h=harness({research:{isObjectResearched:()=>researched}});h.arm();
    const request=h.request('action.execute',{...create,maxCost:100},{session:h.session});finalReply(h,request);
    researched=true;h.events.data(JSON.stringify(request.req)+'\n');h.flush();
    assert.equal(h.sent.at(-1).result.state,'partial');assert.equal(h.calls.length,0);
});
test('ride catalog labels live research without hiding unresearched loaded objects',()=>{
    let researched=false;
    const h=harness({objects:[cinemaObject],research:{isObjectResearched:()=>researched}});
    assert.equal(h.request('objects',{type:'ride'}).reply.result[0].researched,false);
    researched=true;assert.equal(h.request('objects',{type:'ride'}).reply.result[0].researched,true);
    const unavailable=harness({research:{}}).request('objects',{type:'ride'}).reply.result[0];assert.equal(unavailable.researched,null);
    assert.equal(h.request('objects',{type:'station'}).reply.result[0].researched,undefined);
});

const track={action:'trackplace',args:{x:2048,y:2048,z:64,direction:0,ride:1,rideType:0,trackType:0,brakeSpeed:8,colour:0,seatRotation:0,trackPlaceFlags:0,isFromTrackDesign:false}};
const gate={action:'rideentranceexitplace',args:{x:2048,y:2048,direction:0,ride:1,station:0,isExit:false}};
const mazeTile={action:'mazeplacetrack',args:{x:2048,y:2048,z:64,ride:1,mazeEntry:65535}};
const mazeCell={action:'mazesettrack',args:{x:2048,y:2048,z:64,direction:0,ride:1,mode:0,isInitialPlacement:false}};
for(const action of [track,gate,mazeTile,mazeCell]){
    test(action.action+' cannot extend an existing unresearched ride',()=>{
        const type=action.action.startsWith('maze')?20:0,object={index:0,rideType:[type]},rides=[{id:1,type,object,status:'closed'}];
        for(const researched of [false,true]){
            const h=harness({objects:[object],rides,research:researchStatus(researched)});h.arm();
            const query=h.request('action.query',action).reply;assert.equal(query.ok,researched);
            const reply=finalReply(h,h.request('action.execute',{...action,maxCost:100},{session:h.session}));
            assert.equal(reply.result.state,researched?'completed':'partial');assert.equal(h.calls.length,researched?1:0);
        }
    });
}
test('track.build checks existing ride research at dispatch',()=>{
    const object={index:0,rideType:[0]},h=harness({objects:[object],rides:[{id:1,type:0,object,status:'closed'}],research:researchStatus(false)});h.arm();
    const plan=h.request('track.plan',require('../examples/custom-coaster-plan.json').args).reply.result;
    const reply=finalReply(h,h.request('track.build',{planId:plan.planId,ride:1,maxCost:1000},{session:h.session}));
    assert.equal(reply.result.state,'partial');assert.match(reply.result.detail,/not been researched/);assert.equal(h.queries.length,0);assert.equal(h.calls.length,0);
});
test('track placement cannot substitute a different ride type',()=>{
    const object={index:0,rideType:[0,4]},h=harness({objects:[object],rides:[{id:1,type:0,object,status:'closed'}]});
    const reply=h.request('action.query',{...track,args:{...track.args,rideType:4}}).reply;
    assert.equal(reply.ok,false);assert.match(reply.error,/must match/);assert.equal(h.queries.length,0);
});
test('vehicle and ride-type changes cannot bypass research or object compatibility',()=>{
    const object={index:0,rideType:[0,4]},objects=[object,{index:1,rideType:[0]}],rides=[{id:1,type:0,object,status:'closed'}];
    const actions=[{action:'ridesetvehicle',args:{ride:1,type:2,value:1,colour:0}},{action:'ridesetsetting',args:{ride:1,setting:10,value:4}}];
    for(const action of actions)for(const researched of [false,true]){
        const h=harness({objects,rides,research:researchStatus(researched)});h.arm();
        const reply=finalReply(h,h.request('action.execute',{...action,maxCost:100},{session:h.session}));
        assert.equal(reply.result.state,researched?'completed':'partial');assert.equal(h.calls.length,researched?1:0);
    }
    for(const action of [{action:'ridesetvehicle',args:{ride:1,type:2,value:7,colour:0}},{action:'ridesetsetting',args:{ride:1,setting:10,value:39}}]){
        const h=harness({objects:[...objects,cinemaObject],rides});assert.equal(h.request('action.query',action).reply.ok,false);assert.equal(h.queries.length,0);
    }
});
test('native uint8 selector wraparound cannot bypass identity-changing guards',()=>{
    for(const args of [{type:258,value:1},{type:-254,value:1},{type:2,value:65537}]){
        const h=harness(),reply=h.request('action.query',{action:'ridesetvehicle',args:{ride:1,colour:0,...args}}).reply;
        assert.equal(reply.ok,false);assert.equal(h.queries.length,0);
    }
    for(const setting of [266,-246]){
        const h=harness(),reply=h.request('action.query',{action:'ridesetsetting',args:{ride:1,setting,value:39}}).reply;
        assert.equal(reply.ok,false);assert.equal(h.queries.length,0);
    }
});
test('ordinary management and removal remain available with unavailable research',()=>{
    const actions=[price,{action:'ridesetstatus',args:{ride:1,status:0}},{action:'ridedemolish',args:{ride:1,modifyType:0}},
        {action:'ridesetvehicle',args:{ride:1,type:0,value:2,colour:0}},{action:'ridesetvehicle',args:{ride:1,type:1,value:3,colour:0}},
        {action:'ridesetsetting',args:{ride:1,setting:5,value:1}},
        {action:'trackremove',args:{x:2048,y:2048,z:64,direction:0,trackType:0,sequence:0}}];
    const h=harness({research:null});h.arm();
    const reply=finalReply(h,h.request('batch.execute',{actions,maxCost:1000},{session:h.session}));
    assert.equal(reply.result.state,'completed');assert.equal(h.calls.length,actions.length);
});
test('maze move and fill remain available for cleanup of an unresearched ride',()=>{
    for(const mode of [1,2]){
        const h=harness({rides:[{id:1,type:20,status:'closed'}],research:null});h.arm();
        const action={...mazeCell,args:{...mazeCell.args,mode}};
        assert.equal(h.request('action.query',action).reply.ok,true);
        const reply=finalReply(h,h.request('action.execute',{...action,maxCost:100},{session:h.session}));
        assert.equal(reply.result.state,'completed');assert.equal(h.calls.length,1);
    }
});
test('maze mode wraparound cannot disguise construction as cleanup',()=>{
    for(const mode of [256,-256]){
        const h=harness({rides:[{id:1,type:20,status:'closed'}],research:null});
        assert.equal(h.request('action.query',{...mazeCell,args:{...mazeCell.args,mode}}).reply.ok,false);assert.equal(h.queries.length,0);
    }
});
