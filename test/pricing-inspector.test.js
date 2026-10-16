/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const support=require('../generated/pricing-support.json');
const {inspect,inspectPark}=require('../src/pricing-inspector');
const item=name=>support.items.find(i=>i.name===name);
function ride(primary='none',secondary='none') {
    return {id:7,type:52,flags:32,object:{shopItem:primary==='none'?255:item(primary).id,shopItemSecondary:secondary==='none'?255:item(secondary).id},price:[10,10]};
}
function park(entranceFee=10,value=300,flags={}) {
    const all={noMoney:false,freeParkEntry:false,unlockAllPrices:false,...flags};
    return {entranceFee,totalRideValueForMoney:value,getFlag:key=>all[key]};
}
test('wooden coaster photo slot uses native photo3 item and identifies underpricing',()=>{
    const r=ride(),before=JSON.stringify(r),out=inspect(r,support);
    assert.equal(out.status,'ok');assert.equal(out.items[0].role,'ride-admission');
    assert.deepEqual(out.items[1].item,{id:33,name:'photo3',source:'ride-type-photo'});
    assert.equal(out.items[1].currentPrice,10);assert.equal(out.items[1].stockCost,2);
    assert.equal(out.items[1].unitMargin,8);assert.equal(out.items[1].recommendation.candidatePrice,30);
    assert.equal(out.items[1].noPriceRefusalReference,30);
    assert.equal(out.warnings[0].code,'photo_price_below_reference');
    assert.equal(out.warnings[0].referencePrice,30);assert.equal(out.profitOptimum,null);
    assert(out.items[1].saleConditions.some(s=>s.includes('three previous rides')));
    assert.equal(JSON.stringify(r),before);
});
test('photo no-price-refusal reference is exact at every native photo variant and raw price boundary',()=>{
    for(const name of ['photo','photo2','photo3','photo4'])for(const price of [0,29,30,31,200]) {
        const r=ride('none',name);r.flags=0;r.price[1]=price;
        const out=inspect(r,support),p=out.items[1];
        assert.deepEqual(p.nativeValues,{base:30,hot:30,cold:30});
        assert.equal(p.noPriceRefusalReference,30);
        assert.equal(out.warnings.length,price===30?0:1);
        if(price<30)assert.equal(out.warnings[0].code,'photo_price_below_reference');
        if(price>30)assert.equal(out.warnings[0].code,'photo_price_refusal_risk');
    }
});
test('native photo sales flag remains authoritative when reachable-circuit evidence disagrees',()=>{
    const r=ride();r.flags=0;
    assert.equal(inspect(r,support).items[1].role,'unused');
    const absent=inspect(r,support,{hasPhoto:true});
    assert.equal(absent.items[1].role,'unused');assert.equal(absent.warnings[0].code,'photo_flag_track_mismatch');
    const detached=inspect({...r,flags:32},support,{hasPhoto:false});
    assert.equal(detached.items[1].role,'photo');assert(detached.warnings.some(w=>w.code==='photo_flag_track_mismatch'));
    delete r.flags;
    const fallback=inspect(r,support,{hasPhoto:true});
    assert.equal(fallback.status,'unknown');assert.equal(fallback.items[1].role,'photo');
    assert.deepEqual(fallback.photoAvailability,{nativeEnabled:null,trackPresent:true,source:'track-evidence-only'});
});
test('shop primary and secondary identities use actual loaded object item metadata',()=>{
    const r=ride('burger','drink');r.type=28;r.flags=0;r.price=[10,10];
    const out=inspect(r,support);
    assert.deepEqual(out.items.map(i=>i.role),['food','drink']);
    assert.equal(out.items[0].item.name,'burger');assert.equal(out.items[0].stockCost,5);
    assert.equal(out.items[0].recommendation.candidatePrice,19);
    assert.deepEqual(out.items[1].nativeValues,{base:12,hot:20,cold:10});
    assert.equal(out.items[1].recommendation.candidatePrice,10);
    assert(out.items[1].saleConditions.some(s=>s.includes('climate thresholds')));
});
test('native photo flag selects the ride-type photo even if a custom object has a secondary shop item',()=>{
    const out=inspect(ride('none','drink'),support);
    assert.equal(out.items[1].role,'photo');assert.equal(out.items[1].item.name,'photo3');
});
test('souvenirs and weather-sensitive items retain their native eligibility limitations',()=>{
    const r=ride('map','sunglasses');r.flags=0;
    const out=inspect(r,support);
    assert.equal(out.items[0].noPriceRefusalReference,7);
    assert(!out.items[0].saleConditions.some(s=>s.includes('three previous rides')));
    assert.equal(out.items[1].noPriceRefusalReference,12);
    assert(out.items[1].saleConditions.some(s=>s.includes('12 C')));
});
test('rain and heavy snow umbrellas bypass price refusal without inventing a profit-maximizing price',()=>{
    for(const weather of ['rain','heavyRain','thunder','heavySnow','blizzard']) {
        const r=ride('umbrella');r.price[0]=25;
        const p=inspect(r,support,{weather:{weather,temperature:8}});
        assert.equal(p.items[0].priceRefusalBypassed,true);
        assert.equal(p.items[0].noPriceRefusalReference,null);
        assert.equal(p.items[0].legalPriceLimit,200);
        assert.equal(p.items[0].recommendation.candidatePrice,null);
        assert.equal(p.warnings[0].code,'umbrella_rain_pricing_review');
        assert(!p.items[0].saleConditions.some(s=>s.includes('three previous rides')));
    }
});
test('light snow is not native precipitation for umbrella purchase and unknown weather is unknown',()=>{
    for(const weather of ['sunny','partiallyCloudy','cloudy','snow']) {
        const p=inspect(ride('umbrella'),support,{weather:{weather}}).items[0];
        assert.equal(p.precipitation,false);assert.equal(p.priceRefusalBypassed,false);
        assert.equal(p.noPriceRefusalReference,25);
    }
    assert.equal(inspect(ride('umbrella'),support,{weather:{weather:'unexpected'}}).items[0].precipitation,null);
});
test('no-money parks retain pricing facts but suppress cash recommendations',()=>{
    const out=inspect(ride(),support,{park:park(0,0,{noMoney:true})});
    assert.equal(out.items[1].currentPrice,10);assert.equal(out.items[1].noPriceRefusalReference,30);
    assert.equal(out.items[1].recommendation.candidatePrice,null);assert.deepEqual(out.warnings,[]);
});
test('unreadable park money rules remain unknown and suppress actionable price recommendations',()=>{
    const out=inspect(ride(),support,{park:{getFlag(){throw Error('unavailable');}}});
    assert.equal(out.status,'unknown');assert(out.unavailable.includes('park.noMoney'));
    assert.equal(out.moneyEnabled,null);assert.equal(out.items[1].recommendation.candidatePrice,null);
    assert.deepEqual(out.warnings,[]);
});
test('invalid and throwing native metadata is unknown rather than a fabricated item or price',()=>{
    for(const id of [null,-1,256,54,55,31,14,10]) {
        const r=ride();r.object.shopItem=id;
        const out=inspect(r,support);assert.equal(out.status,'unknown');
        assert.equal(out.items[0].role,'unknown');assert.equal(out.items[0].recommendation,null);
    }
    const r=ride();Object.defineProperty(r.object,'shopItemSecondary',{get(){throw Error('unavailable');}});
    assert(inspect(r,support).unavailable.includes('object.shopItemSecondary'));
    delete r.price;assert(inspect(r,support).unavailable.includes('price[0]'));
    assert.equal(inspect(r,null).status,'unknown');
});
test('toilet admission is separate from items and ordinary ride admission is not priced by shop values',()=>{
    const r=ride();r.type=36;r.flags=0;
    assert.equal(inspect(r,support).items[0].role,'toilet-admission');
    assert.equal(inspect(r,support).items[0].recommendation,null);
    r.type=45;assert.equal(inspect(r,support).items[0].role,'unused');
    r.type=48;assert.equal(inspect(r,support).items[0].role,'unused');
});
test('admission inspection uses exact native quarter and sixteenth generation thresholds',()=>{
    for(const [fee,multiplier] of [[0,1],[299,1],[300,1],[301,1/4],[600,1/4],[601,1/4],[602,1/16]]) {
        const p=inspectPark(park(fee,300),support);
        assert.equal(p.status,'ok');assert.equal(p.guestGenerationMultiplier,multiplier);
        assert.equal(p.noGenerationPenaltyReference,300);assert.equal(p.recommendation.candidatePrice,300);
        assert.equal(p.profitOptimum,null);
    }
});
test('free entry and no-money flags use effective zero admission; unlock-all-prices overrides free-entry lock',()=>{
    const free=inspectPark(park(100,300,{freeParkEntry:true}),support);
    assert.equal(free.configuredEntranceFee,100);assert.equal(free.effectiveEntranceFee,0);assert.equal(free.recommendation,null);
    assert.equal(inspectPark(park(100,300,{freeParkEntry:true,unlockAllPrices:true}),support).effectiveEntranceFee,100);
    assert.equal(inspectPark(park(100,300,{noMoney:true}),support).effectiveEntranceFee,0);
    assert.equal(inspectPark(park(100,300,{noMoney:true}),support).recommendation,null);
});
test('admission references respect legal limit and missing data never means free or healthy',()=>{
    assert.equal(inspectPark(park(100,20000),support).recommendation.candidatePrice,9990);
    const p=park();delete p.totalRideValueForMoney;
    const out=inspectPark(p,support);assert.equal(out.status,'unknown');assert.equal(out.recommendation,null);assert.equal(out.guestGenerationMultiplier,null);
    const missingFlags=inspectPark({entranceFee:100,totalRideValueForMoney:300},support);
    assert.equal(missingFlags.status,'unknown');assert.equal(missingFlags.effectiveEntranceFee,null);assert.equal(missingFlags.recommendation,null);
});
