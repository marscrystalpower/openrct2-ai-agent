/* SPDX-License-Identifier: GPL-3.0-only */
(function () {
    'use strict';
    function main() {
        var C=BridgeCore, armed=false, busy=false, generation=0, plans=Object.create(null), clients=[];
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
        function rideView(r){var result=pick(r,['id','type','name','classification','status','mode','departFlags','minimumWaitingTime','maximumWaitingTime','liftHillSpeed','minLiftHillSpeed','maxLiftHillSpeed','price','excitement','intensity','nausea','vehicles','reliability','downtime','guestCount','incomePerHour','profit','totalCustomers','maxSpeed','averageSpeed','rideTime','rideLength','maxPositiveVerticalGs','maxNegativeVerticalGs','maxLateralGs','totalAirTime','numDrops','numLiftHills']);result.stations=(r.stations||[]).map(function(s,i){return Object.assign({index:i},pick(s,['start','length','entrance','exit','queueTime']));}).filter(function(s){return s.length>0;});return result;}
        function getRide(id){C.integer(id,'ride',0,65534);var r=map.getRide(id);if(!r)error('Ride does not exist');return r;}
        function segmentView(s){return Object.assign(pick(s,['type','description','beginZ','endZ','endX','endY','beginDirection','endDirection','beginSlope','endSlope','beginBank','endBank','length','elements','trackGroup','allowsChainLift','isInversion','isBanked','mirrorSegment']),{name:reverseNames[s.type]});}
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
        function tileView(x,y){var t=map.getTile(x,y);return {x:x,y:y,elements:t.elements.map(function(el,index){return Object.assign({elementIndex:index},pick(el,['type','baseZ','clearanceZ','slope','waterHeight','ownership','surfaceStyle','edgeStyle','direction','ride','station','trackType','sequence','hasChainLift','isInverted','edges','isQueue','isWide','queueBannerDirection','object','quadrant']));})};}
        function inspect(req){
            var a=req.args||{};
            switch(req.op){
            case 'hello':return {bridgeVersion:'0.1.0',apiVersion:context.apiVersion,session:session,armed:armed,busy:busy,mode:context.mode,network:network.mode,operations:['hello','arm','stop','receipt','park','rides','ride','map','guests','staff','objects','actions','capture','save','track.catalog','track.plan','track.walk','action.query','action.execute','batch.execute','track.build','coaster.build']};
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
                var types=['ride','station','footpath_surface','footpath_railings','footpath_addition','small_scenery','large_scenery','wall','terrain_surface','terrain_edge'];
                if(types.indexOf(a.type)<0)error('Supported object types: '+types.join(', '));
                return objectManager.getAllObjects(a.type).map(function(o){return pick(o,['index','identifier','name','description','rideType','minCarsInTrain','maxCarsInTrain','carsPerFlatRide']);});
            }
            case 'track.catalog':return context.getAllTrackSegments().map(segmentView);
            case 'track.walk':return walk(a);
            case 'track.plan':{
                if(Object.keys(plans).length>=100)error('Plan cache full; reload park to clear');
                var plan=C.plan(a,function(t){return context.getTrackSegment(t);},TRACK_NAMES,map.size);
                var id=newSession();plans[id]={session:session,plan:plan};return Object.assign({planId:id,session:session},plan);
            }
            default:error('Unknown operation '+req.op);
            }
        }
        function query(action,args,cb){C.validateAction(action,args,ACTION_SCHEMAS);context.queryAction(action,args,cb);}
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
                    var item=actions[index];if(item.useRide)item.args.ride=rideId;
                    receipt.next={index:index,action:item.action,args:item.args};persist();
                    query(item.action,item.args,function(q){
                        try{
                            if(q.error){finish('partial',{index:index,phase:'query',result:q});return;}
                            if(!valid()){finish('stopped','STOP or park change during query');return;}
                            if(receipt.spent+Math.max(0,q.cost||0)>budget){finish('partial',{index:index,phase:'budget',cost:q.cost,remaining:budget-receipt.spent});return;}
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
        console.log('Agent bridge 0.1.0 listening on localhost:'+BRIDGE_CONFIG.port+' (read-only)');
    }
    registerPlugin({name:'Agent Bridge',version:'0.1.0',authors:['Local agent bridge'],type:'intransient',licence:'GPL-3.0-only',minApiVersion:122,targetApiVersion:122,main:main});
})();
