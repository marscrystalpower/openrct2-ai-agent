/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {completeAccess}=require('../cli');
const bundle=fs.readFileSync(path.join(__dirname,'../dist/agent-bridge.js'),'utf8'),config=require('../bridge.config.json');
const objective={type:'guestsBy',guests:1500,year:3,length:1200,excitement:600,parkValue:250000,monthlyIncome:10000};
function harness(scenario={name:'Scenario title',status:'inProgress',objective,details:'Description'}){
    const sent=[],timers=[],hooks={},nativeCalls=[],store={},handlers={};let connect,serial=77000000;
    const listener={on:(_event,callback)=>{connect=callback;return listener;},listen:()=>listener};
    const context={mode:'normal',apiVersion:124,paused:true,gameSpeed:0,
        sharedStorage:{get:key=>store[key],set:(key,value)=>{store[key]=value;}},subscribe:(name,callback)=>{hooks[name]=callback;},setTimeout:callback=>timers.push(callback),
        formatString:(_format,value)=>'$'+(value/10).toFixed(2),
        queryAction:()=>nativeCalls.push('query'),executeAction:()=>nativeCalls.push('execute'),saveGame:()=>nativeCalls.push('save'),captureImage:()=>nativeCalls.push('capture')};
    const globals={context,scenario,park:{name:'Player-renamed park',cash:123450,entranceFee:0,totalRideValueForMoney:100,messages:[],getFlag:()=>false},
        map:{size:{x:3,y:3},rides:[],getTile:()=>({elements:[]})},objectManager:{getAllObjects:()=>[],getObject:()=>null},date:{day:7},
        network:{mode:'none',createListener:()=>listener},console:{log:()=>{}},registerPlugin:registration=>registration.main()};
    vm.runInNewContext(bundle,globals);
    connect({on:(name,callback)=>{handlers[name]=callback;},write:line=>sent.push(JSON.parse(line)),end:()=>{}});
    function request(op='park',args={},extra={}){const req={id:String(++serial),op,args,token:config.token,...extra};handlers.data(JSON.stringify(req)+'\n');return {get reply(){return sent.find(r=>r.id===req.id);}};}
    function flush(){let left=1000;while(timers.length&&left-->0)timers.shift()();assert(left>0,'read-only access audit must settle');}
    function park(){const reply=request().reply;assert.equal(reply.ok,true,reply.error);return reply.result;}
    return {request,park,flush,hooks,context,nativeCalls,replaceScenario:value=>{globals.scenario=value;}};
}

test('ordinary park preserves getter-backed multiline Unicode scenario text separately from park names and objectives',()=>{
    let reads=0;const details='Café au bord de l’eau — 東京 🎢\nBuild a park with room to rest.\r\nKeep this final line.  ';
    const scenario=Object.create({get details(){reads++;return details;}});Object.assign(scenario,{name:'Original scenario title',status:'inProgress',objective});
    const h=harness(scenario),park=h.park();assert.equal(reads,1,'one fresh native details read per park request');
    assert.equal(park.scenario.description,details);assert.equal(park.scenario.descriptionTruncated,false);
    assert.equal(park.scenario.name,'Original scenario title');assert.equal(park.park.name,'Player-renamed park');assert.equal(park.scenario.status,'inProgress');
    assert.deepEqual(park.scenario.objective,objective);assert.equal(park.park.cash,123450);assert.equal(park.paused,true);
    assert.equal(h.request('hello').reply.result.armed,false);assert.deepEqual(h.nativeCalls,[]);
});

test('empty and whitespace-only descriptions remain exact native strings',()=>{
    for(const details of ['', ' ', '\n\t  \r\n']){
        const h=harness({name:'A title is not a description',objective,details}),park=h.park();
        assert.equal(park.scenario.description,details);assert.equal(park.scenario.descriptionTruncated,false);assert.deepEqual(park.scenario.objective,objective);
    }
});

test('missing, null, throwing and non-string details return null without losing ordinary park or objective data',()=>{
    const throwing={get details(){throw Error('Native scenario details unavailable');}},uncoercible={toString(){throw Error('Must not coerce an object to scenario text');}};
    for(const fields of [{},{details:undefined},{details:null},throwing,{details:42},{details:false},{details:[]},{details:uncoercible}]){
        const scenario={name:'Scenario fallback would be misleading',status:'inProgress',objective};Object.defineProperties(scenario,Object.getOwnPropertyDescriptors(fields));
        const h=harness(scenario),park=h.park();assert.equal(park.scenario.description,null);assert.equal(park.scenario.descriptionTruncated,false);
        assert.equal(park.scenario.name,scenario.name);assert.equal(park.scenario.status,'inProgress');assert.deepEqual(park.scenario.objective,objective);assert.equal(park.park.name,'Player-renamed park');
        assert.deepEqual(h.nativeCalls,[]);
    }
});

test('scenario descriptions refresh on every ordinary park request without waiting for a cache or map event',()=>{
    let text='First description',reads=0;const scenario={name:'Initial title',objective,get details(){reads++;return text;}};
    const h=harness(scenario);assert.equal(h.park().scenario.description,'First description');text='Changed native description';
    assert.equal(h.park().scenario.description,'Changed native description');assert.equal(reads,2);
    h.replaceScenario({name:'Another loaded scenario',status:'completed',objective:{type:'parkValueBy',year:4,parkValue:500000},details:'Entirely different scenario text'});
    const changed=h.park();assert.equal(changed.scenario.description,'Entirely different scenario text');assert.equal(changed.scenario.name,'Another loaded scenario');assert.equal(changed.scenario.status,'completed');
    assert.equal(changed.scenario.objective.parkValue,500000);assert.equal(changed.park.name,'Player-renamed park');assert.deepEqual(h.nativeCalls,[]);
});

test('description length is bounded explicitly and an exact boundary remains intact',()=>{
    for(const length of [16383,16384,16385,100000]){
        const h=harness({name:'Long description',objective,details:'x'.repeat(length)}),description=h.park().scenario;
        assert.equal(description.description,'x'.repeat(Math.min(length,16384)));assert.equal(description.descriptionTruncated,length>16384);
        assert.deepEqual(description.objective,objective);assert.deepEqual(h.nativeCalls,[]);
    }
});

test('a UTF-16 limit never leaves half a surrogate pair from a truncated Unicode description',()=>{
    const crossing='a'.repeat(16383)+'🎢'+'tail',crossed=harness({details:crossing,objective}).park().scenario;
    assert.equal(crossed.description,'a'.repeat(16383));assert.equal(crossed.descriptionTruncated,true);assert(crossed.description.length<=16384);
    const exact='a'.repeat(16382)+'🎢',kept=harness({details:exact,objective}).park().scenario;
    assert.equal(kept.description,exact);assert.equal(kept.descriptionTruncated,false);
    const unicode='🎢'.repeat(10000),many=harness({details:unicode,objective}).park().scenario;
    assert.equal(many.description,'🎢'.repeat(8192));assert.equal(many.descriptionTruncated,true);
});

test('automatic CLI access completion preserves scenario description and does not trigger game actions',async()=>{
    const h=harness({name:'Scenario',details:'A description for the current objective.\nSecond line.',objective}),reply=h.request('park').reply;
    assert.equal(reply.result.access.status,'checking');let audits=0;
    await completeAccess(reply,{},async(_config,request)=>{assert.equal(request.op,'path.access');audits++;const pending=h.request(request.op,request.args);h.flush();return pending.reply;});
    assert.equal(audits,1);assert.equal(reply.result.scenario.description,'A description for the current objective.\nSecond line.');assert.equal(reply.result.scenario.descriptionTruncated,false);
    assert.deepEqual(reply.result.scenario.objective,objective);assert.equal(reply.result.paused,true);assert.equal(h.request('hello').reply.result.armed,false);assert.deepEqual(h.nativeCalls,[]);
});

test('unauthenticated park requests do not read scenario details',()=>{
    let reads=0;const h=harness({get details(){reads++;return 'Protected description';},objective});
    const denied=h.request('park',{}, {token:'incorrect'}).reply;assert.equal(denied.ok,false);assert.equal(reads,0);
    assert.equal(h.park().scenario.description,'Protected description');assert.equal(reads,1);assert.deepEqual(h.nativeCalls,[]);
});
