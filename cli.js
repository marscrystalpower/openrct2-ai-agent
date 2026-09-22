#!/usr/bin/env node
'use strict';
const net=require('node:net'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=__dirname;
const mutations=new Set(['action.execute','batch.execute','track.build','coaster.build','save']);
function rpc(config,req,timeout=120000){
    return new Promise((resolve,reject)=>{
        let buffer='',settled=false;
        const socket=net.createConnection({host:'127.0.0.1',port:config.port});
        socket.setEncoding('utf8');
        const timer=setTimeout(()=>finish(Error('Response timeout. Mutation outcome may be unknown. Use receipt; never resend.')),timeout);
        function finish(err,data){if(settled)return;settled=true;clearTimeout(timer);socket.destroy();err?reject(err):resolve(data);}
        socket.on('connect',()=>socket.write(JSON.stringify({...req,token:config.token})+'\n'));
        socket.on('error',err=>finish(err));
        socket.on('close',()=>{if(!settled)finish(Error('Connection closed before reply. Inspect receipt before any further mutation.'));});
        socket.on('data',data=>{
            buffer+=data.toString('utf8');
            if(buffer.length>32*1024*1024){finish(Error('Response exceeds 32 MiB'));return;}
            const i=buffer.indexOf('\n');if(i<0)return;
            try{const reply=JSON.parse(buffer.slice(0,i));if(reply.id!==req.id)throw Error('Reply ID mismatch');finish(null,reply);}catch(e){finish(e);}
        });
    });
}
function durableJson(file,value){
    const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
async function main(argv){
    const config=JSON.parse(fs.readFileSync(path.join(root,'bridge.config.json'),'utf8'));
    if(config.host!=='127.0.0.1')throw Error('Only localhost is supported');
    const command=argv[0]||'hello', arg=argv[1];
    const sessionFile=path.join(root,'logs/session.json');fs.mkdirSync(path.dirname(sessionFile),{recursive:true});
    let req;
    if(command==='request'){
        if(!arg)throw Error('Usage: node cli.js request request.json');
        req=JSON.parse(fs.readFileSync(path.resolve(arg),'utf8'));
    }else if(command==='arm'){
        const hello=await rpc(config,{id:crypto.randomUUID(),op:'hello'});
        if(!hello.ok)throw Error(hello.error);
        req={op:'arm',session:hello.result.session};
    }else if(command==='receipt'){
        if(!arg)throw Error('Usage: node cli.js receipt REQUEST-ID');
        req={op:'receipt',args:{id:arg}};
    }else if(command==='schema'){
        const schemas=require('./generated/actions.json');console.log(JSON.stringify(arg?schemas[arg]:schemas,null,2));return;
    }else req={op:command,args:arg?JSON.parse(arg):{}};
    req.id=req.id||crypto.randomUUID();
    if(!/^[-a-zA-Z0-9]{8,80}$/.test(req.id))throw Error('Invalid request ID');
    delete req.token;
    if(mutations.has(req.op)){
        if(!req.session && fs.existsSync(sessionFile))req.session=JSON.parse(fs.readFileSync(sessionFile)).session;
        if(!req.session)throw Error('Run node cli.js arm for this park session first');
        // Publish intent durably BEFORE opening a connection. An existing ID is never resent.
        durableJson(path.join(root,'logs',req.id+'.request.json'),req);
        console.error('Request ID: '+req.id+' (recover with: node cli.js receipt '+req.id+')');
    }
    const reply=await rpc(config,req);
    if(reply.ok && ['save','capture'].includes(req.op) && reply.result.filename){
        const filename=reply.result.filename;
        if(path.basename(filename)!==filename)throw Error('Unsafe artifact filename in response');
        const artifact=path.join(root,'user-data',req.op==='save'?'save':'screenshot',filename);
        try{
            const bytes=fs.readFileSync(artifact);if(!bytes.length)throw Error('Empty artifact');
            reply.result.fileVerified=true;reply.result.path=artifact;reply.result.bytes=bytes.length;
            reply.result.sha256=crypto.createHash('sha256').update(bytes).digest('hex');
        }catch(e){reply.result.fileVerified=false;reply.result.state='outcome_unknown';reply.result.detail='Engine returned, but output file could not be verified: '+e.message;}
    }
    durableJson(path.join(root,'logs',req.id+'.response.json'),reply);
    if(command==='arm' && reply.ok)fs.writeFileSync(sessionFile,JSON.stringify({session:reply.result.session}));
    if(command==='stop' && fs.existsSync(sessionFile))fs.unlinkSync(sessionFile);
    console.log(JSON.stringify(reply,null,2));
    if(!reply.ok || (reply.result && ['partial','stopped','outcome_unknown','started'].includes(reply.result.state)))process.exitCode=1;
}
if(require.main===module)main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={rpc,durableJson};
