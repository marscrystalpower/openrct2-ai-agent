'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {rpc,durableJson}=require('../cli');
test('real TCP roundtrip handles split response frames',async()=>{
    const server=net.createServer(socket=>socket.once('data',data=>{const r=JSON.parse(data);socket.write('{"id":');setTimeout(()=>socket.end(JSON.stringify(r.id)+',"ok":true,"result":42}\n'),5);}));
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try{assert.equal((await rpc({port:server.address().port,token:'test'},{id:'test1234',op:'hello'},1000)).result,42);}finally{server.close();}
});
test('disconnect does not cause an automatic resend',async()=>{
    let connections=0;const server=net.createServer(socket=>{connections++;socket.once('data',()=>socket.destroy());});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try{await assert.rejects(rpc({port:server.address().port,token:'test'},{id:'test1234',op:'hello'},1000),/closed/);assert.equal(connections,1);}finally{server.close();}
});
test('request journal refuses to overwrite any existing request ID',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rct2-bridge-test-')),file=path.join(dir,'request.json');
    try{durableJson(file,{a:1});assert.throws(()=>durableJson(file,{a:2}),/EEXIST/);assert.deepEqual(JSON.parse(fs.readFileSync(file)),{a:1});}finally{fs.unlinkSync(file);fs.rmdirSync(dir);}
});
