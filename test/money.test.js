/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Money=require('../src/money');
test('uses the live native scalar formatter for USD, GBP and custom currencies',()=>{
    let prefix='$',suffix='',calls=[];
    const m=Money.create({configuration:{get:()=> 'en-US'},formatString:(token,value)=>{assert.equal(token,'{CURRENCY2DP}');assert.equal(typeof value,'number');calls.push(value);return prefix+(value/10).toFixed(2)+suffix;}});
    assert.equal(m.format(426402),'$42640.20');
    prefix='£';assert.equal(m.format(426402),'£42640.20');
    prefix='';suffix=' Tokens';assert.equal(m.format(100),'10.00 Tokens');
    assert.equal(m.info().code,null);assert.equal(m.info().language,'en-US');assert(calls.includes(426402));
});
test('raw money is unchanged and a non-rate-10 currency uses native conversion',()=>{
    const m=Money.create({formatString:(token,value)=>'¥'+value*10});
    const raw={park:{cash:10000,bankLoan:0,value:100},session:'test'};
    const enriched=m.enrich('park',raw);
    assert.equal(enriched.park.cash,10000);assert.equal(enriched.moneyDisplay.cash,'¥100000');
    assert.equal(raw.moneyDisplay,undefined);assert.equal(enriched.currency.sample,'¥100');
});
test('out-of-range money64 and malformed values never reach the narrowing formatter',()=>{
    let calls=0;const m=Money.create({formatString:()=>{calls++;return 'formatted';}});
    for(const n of [2147483648,-2147483649,Number.MAX_SAFE_INTEGER,null,undefined,NaN,1.5,'10'])assert.equal(m.format(n),null);
    assert.equal(calls,0);assert.equal(m.format(-2147483648),'formatted');assert.equal(m.format(2147483647),'formatted');
    assert.equal(calls,2);
});
test('unavailable or failing formatter returns null without a GBP fallback',()=>{
    for(const ctx of [{},{formatString:()=>{throw Error('unavailable');}},{formatString:()=>''}]){
        const m=Money.create(ctx);assert.equal(m.format(100),null);assert.equal(m.info().available,false);assert.equal(m.info().sample,null);
    }
});
test('ride prices, native query costs and receipt costs are formatted without editing stored receipts',()=>{
    const m=Money.create({formatString:(token,value)=>'$'+value});
    const ride=m.enrich('ride',{price:[20,0],profit:null});assert.deepEqual(ride.moneyDisplay,{price:['$20','$0'],profit:null});
    assert.equal(m.enrich('action.query',{cost:250}).costDisplay,'$250');
    const stored={spent:250,completed:[{result:{cost:250}}],detail:{remaining:100,cost:300}};
    const receipt=m.enrich('receipt',stored);
    assert.equal(receipt.spentDisplay,'$250');assert.equal(receipt.completed[0].result.costDisplay,'$250');assert.equal(receipt.detail.remainingDisplay,'$100');
    assert.equal(stored.spentDisplay,undefined);assert.equal(stored.completed[0].result.costDisplay,undefined);assert.equal(stored.detail.remainingDisplay,undefined);
    assert.equal(m.enrich('receipt',null),null);
});
