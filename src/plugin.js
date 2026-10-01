/* SPDX-License-Identifier: GPL-3.0-only */
(function () {
    'use strict';
    function main() {
        var C=BridgeCore, trackGuard=BridgeTrackGuard.create(BridgeCore,TRACK_SUPPORT,context,objectManager), armed=false, busy=false, generation=0, plans=Object.create(null), clients=[];
        var session=newSession();
        var storageKey='agent-bridge.receipts.v1';
        var receipts=context.sharedStorage.get(storageKey) || {};
        function newSession(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
        function invalidate(){armed=false;generation++;session=newSession();plans=Object.create(null);}
        context.subscribe('map.change',invalidate);
        context.subscribe('map.changed',invalidate);
        function persist(){context.sharedStorage.set(storageKey,receipts);}
        function error(message){throw new Error(message);}
        function playable(){if(context.mode!=='normal' && context.mode!=='track_designer') error('Load a park first'); if(network.mode!=='none') error('Bridge supports single-player only');}
        function allowed(req){playable();if(!armed) error('Bridge is read-only; arm this session first');if(req.session!==session) error('Stale or missing session');}
        function pick(obj,keys){var result={};keys.forEach(function(k){try{if(obj[k]!==undefined){var v=obj[k];result[k]=(typeof v==='number' && !Number.isFinite(v)) || (typeof v==='number' && Math.abs(v)>Number.MAX_SAFE_INTEGER)?null:v;}}catch(e){result[k]=null;}});return result;}
        function rideView(r){var result=pick(r,['id','type','name','classification','status','mode','price','excitement','intensity','nausea','vehicles','reliability','downtime','guestCount','incomePerHour','profit','totalCustomers','maxSpeed','averageSpeed','rideTime','rideLength','maxPositiveVerticalGs','maxNegativeVerticalGs','maxLateralGs','totalAirTime','numDrops','numLiftHills']);result.stations=(r.stations||[]).map(function(s,i){return Object.assign({index:i},pick(s,['start','length','entrance','exit','queueTime']));}).filter(function(s){return s.length>0;});return result;}
        function getRide(id){C.integer(id,'ride',0,65534);var r=map.getRide(id);if(!r)error('Ride does not exist');return r;}
        function rideResearchStatus(index){
            // API 122 reads the native invention bitmap. Research lists can contain
            // the item still being researched, and loaded objects are not unlocks.
            try{
                var research=park.research;
                if(!research || typeof research.isObjectResearched!=='function')return null;
                var status=research.isObjectResearched('ride',index);
                return typeof status==='boolean'?status:null;
            }catch(e){return null;}
        }
        function requireResearchedRide(rideType,objectIndex){
            C.integer(rideType,'rideType',0,254);
            // 65535 is the native automatic-object sentinel; its fallback can
            // select an unresearched object. Require an explicit loaded index.
            C.integer(objectIndex,'explicit rideObject index',0,65534);
            var object=objectManager.getObject('ride',objectIndex);
            if(!object || object.index!==objectIndex)error('Ride object is not loaded: '+objectIndex);
            if(!Array.isArray(object.rideType) || object.rideType.indexOf(rideType)<0)error('Ride object '+objectIndex+' does not support ride type '+rideType);
            var researched=rideResearchStatus(objectIndex);
            if(researched===null)error('Cannot verify ride research status; construction is blocked. Use OpenRCT2 v0.5.5 / API 122 and inspect the park before retrying');
            if(!researched)error('Ride object '+objectIndex+' has not been researched; choose a researched ride object or wait for research to finish');
        }
        function validateRideConstruction(action,args){
            if(action==='mazesettrack'){
                C.integer(args.mode,'maze mode',0,2);
                // Move/fill operate on existing cells; keep cleanup available.
                if(args.mode!==0)return;
            }
            if(action==='ridecreate'){
                requireResearchedRide(args.rideType,args.rideObject);
            } else if(['trackplace','mazeplacetrack','mazesettrack','rideentranceexitplace'].indexOf(action)>=0){
                var ride=getRide(args.ride);
                requireResearchedRide(ride.type,ride.object && ride.object.index);
                if(action==='trackplace' && args.rideType!==ride.type)error('Track rideType must match the existing ride');
            } else if(action==='ridesetvehicle'){
                // Native selectors are uint8; reject wraparound aliases of type 2.
                C.integer(args.type,'vehicle setting type',0,3);
                if(args.type===2)requireResearchedRide(getRide(args.ride).type,args.value);
            } else if(action==='ridesetsetting'){
                C.integer(args.setting,'ride setting',0,10);
                if(args.setting===10){
                    var current=getRide(args.ride);
                    requireResearchedRide(args.value,current.object && current.object.index);
                }
            }
        }
        function validateTrackConstruction(action,args){
            if(action==='trackplace'){
                var ride=getRide(args.ride);
                trackGuard.support(ride.type).validate(args.trackType,args.trackPlaceFlags,false);
            } else if(action==='ridesetsetting' && args.setting===10){
                error('Changing ride type requires a cheat and is not supported by normal construction; keep this ride type or create a researched compatible ride');
            }
        }
        function requirePathObject(type,index){
            // API 122 has 255 slots per path family (indices 0..254).
            // The uint16 null sentinel and wrapped indices are never objects.
            C.integer(index,type+' object index',0,254);
            var object=objectManager.getObject(type,index);
            if(!object || object.index!==index || object.type!==type)error('Path object '+index+' is not loaded as '+type+'; inspect objects for that family and match constructFlags before retrying');
            return object;
        }
        function pathSurfaceIsQueue(object){
            // FootpathEntry.h: surface flags use bit 3, not the action's bit 0.
            try{var flags=object.flags;if(Number.isInteger(flags)&&flags>=0&&flags<=255)return (flags&8)!==0;}catch(e){}
            return null;
        }
        function validatePathConstruction(action,args){
            if(action!=='footpathplace')return;
            // Footpath.h: bit 0 = queue; bit 1 = legacy combined path object.
            // Native placement accepts missing/wrong-family references, so a
            // successful native query alone can still create invisible paths.
            C.integer(args.constructFlags,'path constructFlags (0/1 modern, 2/3 legacy)',0,3);
            if(args.constructFlags&2){
                requirePathObject('footpath',args.object);
                // Legacy paths supply their own railings; the native action
                // ignores this required argument, including its null sentinel.
                C.integer(args.railingsObject,'legacy railingsObject (ignored)',0,65535);
            } else {
                var surface=requirePathObject('footpath_surface',args.object);
                requirePathObject('footpath_railings',args.railingsObject);
                var isQueue=pathSurfaceIsQueue(surface);
                if(isQueue===null)error('Cannot verify footpath_surface queue flags; construction is blocked. Use OpenRCT2 v0.5.5 / API 122');
                if(isQueue!==((args.constructFlags&1)!==0))error('Path queue flag does not match footpath_surface '+args.object+'; use a queue surface with constructFlags 1 or a regular surface with constructFlags 0');
            }
        }
        function segmentView(s){return Object.assign(pick(s,['type','description','beginZ','endZ','endX','endY','beginDirection','endDirection','beginSlope','endSlope','beginBank','endBank','length','elements','trackGroup','allowsChainLift','isSteepUp','isInversion','isBanked','mirrorSegment']),{name:reverseNames[s.type],requiresChainLift:!!(TRACK_SUPPORT.segments[s.type] && TRACK_SUPPORT.segments[s.type].forceChain)});}
        var reverseNames={};Object.keys(TRACK_NAMES).forEach(function(k){reverseNames[TRACK_NAMES[k]]=k;});
        function walk(args){
            C.integer(args.x,'tile x',0,map.size.x-1);C.integer(args.y,'tile y',0,map.size.y-1);C.integer(args.elementIndex,'elementIndex',0,255);
            var it=map.getTrackIterator({x:args.x*32,y:args.y*32},args.elementIndex);
            if(!it || !it.segment)error('No track iterator at tile/element');
            var visited={}, out=[], first=null, limit=args.limit===undefined?2048:C.integer(args.limit,'limit',1,4096);
            for(var i=0;i<limit;i++){
                var p=it.position, s=it.segment;
                if(!s)return {closed:false,reason:'missing segment',segments:out};
                var key=[p.x,p.y,p.z,p.direction,s.type].join(',');
                if(visited[key])return {closed:key===first,reason:key===first?'circuit':'repeated non-start piece',segments:out};
                if(first===null)first=key;visited[key]=true;
                out.push({position:p,type:s.type,name:reverseNames[s.type],nextPosition:it.nextPosition});
                if(!it.next())return {closed:false,reason:'gap',nextPosition:out[out.length-1].nextPosition,segments:out};
            }
            return {closed:false,reason:'traversal limit',segments:out};
        }
        function tileView(x,y){
            var t=map.getTile(x,y);
            return {x:x,y:y,elements:t.elements.map(function(el,index){
                var result=Object.assign({elementIndex:index},pick(el,['type','baseZ','clearanceZ','slope','waterHeight','ownership','surfaceStyle','edgeStyle','direction','ride','station','trackType','sequence','hasChainLift','isInverted','edges','isQueue','isWide','queueBannerDirection','object','quadrant']));
                if(el.type==='footpath')Object.assign(result,pick(el,['surfaceObject','railingsObject']));
                if(el.type==='track'){
                    var ride=map.getRide(el.ride);
                    if(ride && ride.type===20){
                        try{var mazeEntry=el.mazeEntry;if(mazeEntry!==undefined)result.mazeEntry=mazeEntry;}catch(e){result.mazeEntry=null;}
                    }
                }
                return result;
            })};
        }
        function inspect(req){
            var a=req.args||{};
            switch(req.op){
            case 'hello':return {bridgeVersion:'0.1.1',apiVersion:context.apiVersion,session:session,armed:armed,busy:busy,mode:context.mode,network:network.mode,operations:['hello','arm','stop','receipt','park','rides','ride','map','guests','staff','objects','actions','capture','save','track.catalog','track.plan','track.walk','action.query','action.execute','batch.execute','track.build','coaster.build']};
            case 'actions':return ACTION_SCHEMAS;
            case 'receipt':if(typeof a.id!=='string')error('receipt id required');return Object.prototype.hasOwnProperty.call(receipts,a.id)?receipts[a.id]:null;
            case 'arm':playable();if(req.session!==session)error('Stale session');armed=true;return {armed:true,session:session};
            case 'stop':armed=false;generation++;return {armed:false,busy:busy,message:'Stops before the next action; an action already dispatched may finish.'};
            }
            playable();
            switch(req.op){
            case 'capture':{
                var capture={filename:'agent-'+newSession()+'.png',width:C.integer(a.width===undefined?1600:a.width,'width',320,2560),height:C.integer(a.height===undefined?1000:a.height,'height',240,1600),zoom:C.integer(a.zoom===undefined?1:a.zoom,'zoom',0,3),rotation:C.integer(a.rotation===undefined?0:a.rotation,'rotation',0,3),position:{x:C.integer(a.x===undefined?map.size.x*16:a.x,'world x',0,map.size.x*32-1),y:C.integer(a.y===undefined?map.size.y*16:a.y,'world y',0,map.size.y*32-1)}};
                context.captureImage(capture);return {filename:capture.filename,directory:'user-data/screenshot',options:capture};
            }
            case 'park':return {session:session,paused:context.paused,speed:context.gameSpeed,mapSize:map.size,park:Object.assign(pick(park,['name','cash','rating','bankLoan','maxBankLoan','entranceFee','guests','value','companyValue','suggestedGuestMaximum']),{messages:(park.messages||[]).map(function(m){return pick(m,['type','subject','text','month','tickCount','isArchived']);})}),scenario:Object.assign(pick(scenario,['name','status']),{objective:pick(scenario.objective||{},['type','guests','year','length','excitement','parkValue','monthlyIncome'])}),date:pick(date,['monthsElapsed','month','day'])};
            case 'rides':return map.rides.map(rideView);
            case 'ride':return rideView(getRide(a.ride));
            case 'map':{
                var x=C.integer(a.x,'tile x',0,map.size.x-1), y=C.integer(a.y,'tile y',0,map.size.y-1);
                var w=C.integer(a.width===undefined?1:a.width,'width',1,32), h=C.integer(a.height===undefined?1:a.height,'height',1,32);
                if(x+w>map.size.x || y+h>map.size.y)error('Rectangle outside map');
                var tiles=[];for(var j=y;j<y+h;j++)for(var i=x;i<x+w;i++)tiles.push(tileView(i,j));return tiles;
            }
            case 'guests':case 'staff':{
                var entities=map.getAllEntities(req.op==='guests'?'guest':'staff'), offset=C.integer(a.offset===undefined?0:a.offset,'offset',0,1000000), limit=C.integer(a.limit===undefined?100:a.limit,'limit',1,500);
                return {total:entities.length,offset:offset,entities:entities.slice(offset,offset+limit).map(function(e){var result=pick(e,['id','name','x','y','z','state','happiness','hunger','thirst','nausea','energy','cash','staffType','staffOrders','currentRide']);if(req.op==='guests')result.thoughts=(e.thoughts||[]).map(function(t){return pick(t,['type','item','freshness','freshTimeout']);});return result;})};
            }
            case 'objects':{
                var types=['ride','station','footpath','footpath_surface','footpath_railings','footpath_addition','small_scenery','large_scenery','wall','terrain_surface','terrain_edge'];
                if(types.indexOf(a.type)<0)error('Supported object types: '+types.join(', '));
                return objectManager.getAllObjects(a.type).map(function(o){var result=pick(o,['type','index','identifier','name','description','rideType','minCarsInTrain','maxCarsInTrain','carsPerFlatRide']);if(a.type==='ride')result.researched=rideResearchStatus(o.index);if(a.type==='footpath_surface'){Object.assign(result,pick(o,['flags']));result.isQueue=pathSurfaceIsQueue(o);}return result;});
            }
            case 'track.catalog':{
                var check=null;
                if(a.ride!==undefined){var target=getRide(a.ride);requireResearchedRide(target.type,target.object && target.object.index);check=trackGuard.support(target.type);}
                else if(a.rideType!==undefined || a.rideObject!==undefined){requireResearchedRide(a.rideType,a.rideObject);check=trackGuard.support(a.rideType);}
                var variant=a.inverted===true?2:0;
                return context.getAllTrackSegments().map(function(s){
                    var result=segmentView(s);
                    if(check){
                        try{result.requiresChainLift=check.requiresChain(s.type);}catch(e){}
                        try{check.validate(s.type,variant|(result.requiresChainLift?1:0),false);result.supported=true;}
                        catch(e){result.supported=false;result.supportReason=e.message;}
                        try{check.validate(s.type,variant|1,false);result.chainSupported=true;}
                        catch(e){result.chainSupported=false;result.chainReason=e.message;}
                    }
                    return result;
                });
            }
            case 'track.walk':return walk(a);
            case 'track.plan':{
                if(Object.keys(plans).length>=100)error('Plan cache full; reload park to clear');
                var plan=C.plan(a,function(t){var s=context.getTrackSegment(t);return s?segmentView(s):null;},TRACK_NAMES,map.size);
                var id=newSession();plans[id]={session:session,plan:plan};return Object.assign({planId:id,session:session},plan);
            }
            default:error('Unknown operation '+req.op);
            }
        }
        function query(action,args,cb){
            C.validateAction(action,args,ACTION_SCHEMAS);
            validateRideConstruction(action,args);
            validatePathConstruction(action,args);
            validateTrackConstruction(action,args);
            if(action==='mazeplacetrack'||action==='mazesettrack'){
                var mazeRide=getRide(args.ride);
                if(mazeRide.type!==20)error('Maze action requires a Maze ride');
                if(mazeRide.status!=='closed')error('Close the maze before construction');
                var grid=action==='mazeplacetrack'?32:16;
                C.integer(args.x,'maze x',0,map.size.x*32-grid);
                C.integer(args.y,'maze y',0,map.size.y*32-grid);
                C.integer(args.z,'maze z',0,2040);
                if(args.x%grid||args.y%grid||args.z%16)error('Maze coordinates must align to the native grid');
                if(action==='mazeplacetrack')C.integer(args.mazeEntry,'mazeEntry',0,65535);
                else {C.integer(args.direction,'maze direction',0,3);C.integer(args.mode,'maze mode',0,2);}
            }
            context.queryAction(action,args,cb);
        }
        function mutation(req,send){
            var fingerprint=JSON.stringify({op:req.op,args:req.args,session:req.session});
            if(Object.prototype.hasOwnProperty.call(receipts,req.id)){
                var old=receipts[req.id];if(old.fingerprint!==fingerprint)error('Request ID already used for different content');send({id:req.id,ok:true,result:old});return;
            }
            allowed(req);if(busy)error('Another mutation is running');
            if(Object.keys(receipts).length>=5000)error('Receipt journal full; archive it before continuing');
            if(req.op==='save'){
                var filename='agent-checkpoint-'+req.id;
                var saveReceipt={id:req.id,fingerprint:fingerprint,session:session,state:'started',filename:filename+'.park'};
                receipts[req.id]=saveReceipt;persist();
                try{context.saveGame({filename:filename});saveReceipt.state='completed';saveReceipt.fileVerified=false;}catch(e){saveReceipt.state='outcome_unknown';saveReceipt.detail=String(e);}
                persist();send({id:req.id,ok:true,result:saveReceipt});return;
            }
            var args=req.args||{}, budget=args.maxCost;
            C.integer(budget,'maxCost (game money units)',0,2147483647);
            var actions=[], rideId, plan;
            if(req.op==='action.execute')actions=[{action:args.action,args:args.args}];
            else if(req.op==='batch.execute'){
                if(!Array.isArray(args.actions)||!args.actions.length||args.actions.length>2048)error('actions must contain 1..2048 entries');actions=args.actions;
            } else {
                var saved=plans[args.planId];if(!saved||saved.session!==session)error('Unknown or stale plan');plan=saved.plan;
                if(req.op==='track.build'){
                    rideId=args.ride;var ride=getRide(rideId);if(ride.status!=='closed')error('Close the ride before construction');
                    plan.steps.forEach(function(p){actions.push({action:'trackplace',args:Object.assign({},p,{ride:rideId,rideType:ride.type})});});
                } else if(req.op==='coaster.build'){
                    C.validateAction('ridecreate',args.create,ACTION_SCHEMAS);
                    actions.push({action:'ridecreate',args:args.create});
                    if(args.name!==undefined)actions.push({action:'ridesetname',args:{ride:0,name:args.name},useRide:true});
                    plan.steps.forEach(function(p){actions.push({action:'trackplace',args:Object.assign({},p,{ride:0,rideType:args.create.rideType}),useRide:true});});
                    if(args.entrances!==undefined){
                        if(!Array.isArray(args.entrances)||args.entrances.length>8)error('entrances must be an array of at most 8 entrance/exit placements');
                        args.entrances.forEach(function(e){actions.push({action:'rideentranceexitplace',args:Object.assign({},e,{ride:0}),useRide:true});});
                    }
                    if(args.test===true)actions.push({action:'ridesetstatus',args:{ride:0,status:2},useRide:true});
                } else error('Unknown mutation');
            }
            actions.forEach(function(a){C.validateAction(a.action,a.args,ACTION_SCHEMAS);});
            var g=generation, currentSession=session, index=0;
            var receipt={id:req.id,fingerprint:fingerprint,state:'started',session:session,op:req.op,completed:[],spent:0,ride:rideId,startedAt:Date.now()};
            receipts[req.id]=receipt;persist();busy=true;
            function finish(state,detail){receipt.state=state;receipt.detail=detail;receipt.finishedAt=Date.now();busy=false;try{persist();}catch(e){receipt.persistenceError=String(e);}send({id:req.id,ok:true,result:receipt});}
            function valid(){return armed && generation===g && session===currentSession && network.mode==='none' && (context.mode==='normal'||context.mode==='track_designer');}
            function next(){
                try{
                    if(!valid()){finish('stopped','Session changed or STOP requested');return;}
                    if(index===actions.length){finish('completed',{actions:actions.length,planClosed:plan?plan.closed:undefined,physicsVerified:false});return;}
                    if(index===0 && plan){
                        var planType=req.op==='coaster.build'?args.create.rideType:getRide(rideId).type;
                        if(req.op==='coaster.build')requireResearchedRide(planType,args.create.rideObject);
                        else {var planRide=getRide(rideId);requireResearchedRide(planType,planRide.object && planRide.object.index);}
                        var support=trackGuard.support(planType);
                        plan.steps.forEach(function(step,i){try{support.validate(step.trackType,step.trackPlaceFlags,false);}catch(e){error('Plan piece '+i+': '+e.message);}});
                    }
                    var item=actions[index];if(item.useRide)item.args.ride=rideId;
                    receipt.next={index:index,action:item.action,args:item.args};persist();
                    query(item.action,item.args,function(q){
                        try{
                            if(q.error){finish('partial',{index:index,phase:'query',result:q});return;}
                            if(!valid()){finish('stopped','STOP or park change during query');return;}
                            if(receipt.spent+Math.max(0,q.cost||0)>budget){finish('partial',{index:index,phase:'budget',cost:q.cost,remaining:budget-receipt.spent});return;}
                            // Re-read live research and object state after the query;
                            // never execute on a stale successful precheck.
                            validateRideConstruction(item.action,item.args);
                            validatePathConstruction(item.action,item.args);
                            validateTrackConstruction(item.action,item.args);
                            receipt.inFlight={index:index,action:item.action,args:item.args};persist();
                            context.executeAction(item.action,item.args,function(r){
                                try{
                                    if(r.error){delete receipt.inFlight;finish('partial',{index:index,phase:'execute',result:r});return;}
                                    receipt.completed.push({index:index,action:item.action,args:item.args,result:r});receipt.spent+=Math.max(0,r.cost||0);delete receipt.inFlight;
                                    if(item.action==='ridecreate'){rideId=r.ride;receipt.ride=rideId;if(!Number.isInteger(rideId)){finish('outcome_unknown','Engine did not return new ride ID');return;}}
                                    index++;persist();context.setTimeout(next,1);
                                }catch(e){finish('outcome_unknown',String(e));}
                            });
                        }catch(e){finish(receipt.inFlight?'outcome_unknown':'partial',String(e));}
                    });
                }catch(e){finish(receipt.inFlight?'outcome_unknown':'partial',String(e));}
            }
            next();
        }
        var mutations=['action.execute','batch.execute','track.build','coaster.build','save'];
        function dispatch(req,send){
            try{
                if(!req || req.token!==BRIDGE_CONFIG.token)error('Authentication failed');
                if(typeof req.id!=='string'||!/^[-a-zA-Z0-9]{8,80}$/.test(req.id))error('id must be 8..80 letters/digits/hyphens');
                if(mutations.indexOf(req.op)>=0){mutation(req,send);return;}
                if(req.op==='action.query'){playable();query(req.args.action,req.args.args,function(r){send({id:req.id,ok:true,result:r});});return;}
                send({id:req.id,ok:true,result:inspect(req)});
            }catch(e){send({id:req&&req.id,ok:false,error:String(e.message||e)});}
        }
        var listener=network.createListener();
        listener.on('connection',function(socket){
            if(clients.length>=8){socket.end();return;}clients.push(socket);var buffer='';
            socket.on('error',function(){});
            socket.on('close',function(){clients=clients.filter(function(c){return c!==socket;});});
            socket.on('data',function(chunk){
                buffer+=chunk;if(buffer.length>1048576){socket.end();return;}
                var newline;
                while((newline=buffer.indexOf('\n'))>=0){
                    var line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
                    if(!line.trim())continue;
                    try{dispatch(JSON.parse(line),function(reply){try{socket.write(JSON.stringify(reply)+'\n');}catch(e){console.log('Agent bridge reply unavailable; consult receipt');}});}
                    catch(e){socket.write(JSON.stringify({ok:false,error:'Invalid JSON'})+'\n');}
                }
            });
        });
        listener.listen(BRIDGE_CONFIG.port,'127.0.0.1');
        if(typeof ui!=='undefined')ui.registerMenuItem('Agent bridge: STOP',function(){armed=false;generation++;console.log('Agent bridge stopped');});
        console.log('Agent bridge 0.1.1 listening on localhost:'+BRIDGE_CONFIG.port+' (read-only)');
    }
    registerPlugin({name:'Agent Bridge',version:'0.1.1',authors:['Local agent bridge'],type:'intransient',licence:'GPL-3.0-only',minApiVersion:122,targetApiVersion:122,main:main});
})();
