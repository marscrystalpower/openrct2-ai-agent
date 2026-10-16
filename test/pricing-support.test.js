/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {generatePricingSupport,SOURCE_COMMIT}=require('../scripts/pricing-support');
const source=path.resolve(__dirname,'../vendor/OpenRCT2');
const data=generatePricingSupport(source);
function alteredRead(t,suffix,transform) {
    const original=fs.readFileSync;let changed=false;
    t.mock.method(fs,'readFileSync',function(filename,...args){
        const value=original.call(this,filename,...args);
        if(typeof filename==='string'&&filename.replaceAll('\\','/').endsWith(suffix)){
            const next=transform(value);assert.notEqual(next,value);changed=true;return next;
        }
        return value;
    });
    return ()=>assert.equal(changed,true);
}
test('pricing metadata is deterministic and covers native items, ride photo variants and legal limits',()=>{
    assert.deepEqual(generatePricingSupport(source),data);
    assert.deepEqual(data,JSON.parse(fs.readFileSync(path.resolve(__dirname,'../generated/pricing-support.json'),'utf8')));
    assert.equal(data.sourceCommit,SOURCE_COMMIT);assert.equal(data.items.length,56);assert.equal(data.rideTypes.length,103);
    assert.deepEqual(data.items.filter(i=>i.isPhoto).map(i=>[i.id,i.name,i.cost,i.values]),[
        [3,'photo',2,{base:30,hot:30,cold:30}],[32,'photo2',2,{base:30,hot:30,cold:30}],
        [33,'photo3',2,{base:30,hot:30,cold:30}],[34,'photo4',2,{base:30,hot:30,cold:30}]
    ]);
    assert.equal(data.rideTypes[52].photoItem,33);assert.equal(data.rideTypes[36].specialType,'toilet');
    assert.deepEqual(data.constants,{noneItem:255,photoFlag:32,maxRidePrice:200,maxEntranceFee:9990,
        precipitationTypes:['rain','heavyRain','thunder','heavySnow','blizzard']});
    assert.equal(data.items[54].name,null);assert.equal(data.items[55].name,null);
});
test('extraction follows modified native photo and food value fields instead of a hardcoded price table',t=>{
    const checked=alteredRead(t,'/ride/ShopItem.cpp',text=>text.replace(
        /(?:\/\* ShopItem::photo \*\/\s*\{\s*0.20_GBP, )3.00_GBP/,
        match=>match.replace('3.00_GBP','3.10_GBP')));
    const changed=generatePricingSupport(source);checked();assert.equal(changed.items[3].values.base,31);
});
test('extraction refuses unknown item table precision or missing native rows',t=>{
    const checked=alteredRead(t,'/ride/ShopItem.cpp',text=>text.replace('1.40_GBP','1.45_GBP'));
    assert.throws(()=>generatePricingSupport(source),/unsupported precision/);checked();
});
test('extraction refuses altered native willingness semantics',t=>{
    const checked=alteredRead(t,'/entity/Guest.cpp',text=>text.replace('if (guest.happiness >= 128)','if (guest.happiness >= 129)'));
    assert.throws(()=>generatePricingSupport(source),/purchase semantics changed/);checked();
});
test('extraction refuses changed park generation penalty math',t=>{
    const checked=alteredRead(t,'/world/Park.cpp',text=>text.replace('if (entranceFee / 2 > park.totalRideValueForMoney)','if (entranceFee / 3 > park.totalRideValueForMoney)'));
    assert.throws(()=>generatePricingSupport(source),/admission generation thresholds changed/);checked();
});
test('extraction refuses a ride mapping to a non-photo item',t=>{
    const checked=alteredRead(t,'/rtd/coaster/WoodenRollerCoaster.h',text=>text.replace('.PhotoItem = ShopItem::photo3','.PhotoItem = ShopItem::umbrella'));
    assert.throws(()=>generatePricingSupport(source),/missing ride photo item/);checked();
});
test('extraction refuses an upstream revision mismatch',t=>{
    const cp=require('node:child_process'),original=cp.execFileSync;
    t.mock.method(cp,'execFileSync',function(command,args,...rest){
        if(command==='git'&&args.includes('rev-parse'))return '0'.repeat(40);
        return original.call(this,command,args,...rest);
    });
    assert.throws(()=>generatePricingSupport(source),/revision differs/);
});
