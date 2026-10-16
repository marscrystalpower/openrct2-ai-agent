/* SPDX-License-Identifier: GPL-3.0-only */
var BridgePricingInspector = (function () {
    'use strict';
    function integer(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
    function read(object,key) { try { return object == null ? undefined : object[key]; } catch(e) { return undefined; } }
    function flag(park,key) { try { var value=park.getFlag(key);return typeof value==='boolean'?value:null; } catch(e) { return null; } }
    function inspect(ride,support,options) {
        options=options||{};
        var result={status:'ok',items:[],warnings:[],unavailable:[],profitOptimum:null,
            basis:'Pinned native item values; a price-refusal reference is not a profit optimum or a guaranteed sale.'};
        function missing(key) {if(result.unavailable.indexOf(key)<0)result.unavailable.push(key);}
        var constants=support&&support.constants, items=support&&support.items, rideTypes=support&&support.rideTypes;
        if(!constants||!Array.isArray(items)||!Array.isArray(rideTypes)){result.status='unknown';missing('pricingSupport');return result;}
        var object=read(ride,'object'), prices=read(ride,'price'), type=integer(read(ride,'type'));
        var descriptor=type===null?null:rideTypes[type];
        if(!descriptor||descriptor.id!==type){descriptor=null;missing('ride.type');}
        var flags=integer(read(ride,'flags'));
        if(flags!==null&&flags>4294967295)flags=null;
        var nativePhoto=flags===null?null:(flags&constants.photoFlag)!==0;
        var trackPhoto=typeof options.hasPhoto==='boolean'?options.hasPhoto:null;
        // The engine's exit purchase logic uses this native flag, even when an
        // extra photo piece is outside the reachable circuit. Track inventory
        // remains useful independent evidence, not authority to change the gate.
        var hasPhoto=nativePhoto===null?trackPhoto:nativePhoto;
        if(nativePhoto===null)missing('ride.flags.onRidePhoto');
        result.photoAvailability={nativeEnabled:nativePhoto,trackPresent:trackPhoto,
            source:nativePhoto===null?'track-evidence-only':'native-ride-flag'};
        var weather=read(options.weather,'weather'), precipitation=null;
        if(typeof weather==='string') {
            if(constants.precipitationTypes.indexOf(weather)>=0)precipitation=true;
            else if(['sunny','partiallyCloudy','cloudy','snow'].indexOf(weather)>=0)precipitation=false;
        }
        var noMoney=options.park?flag(options.park,'noMoney'):null;
        var moneyUnknown=!!options.park&&noMoney===null;
        if(moneyUnknown)missing('park.noMoney');
        result.moneyEnabled=noMoney===null?null:!noMoney;
        for(var slot=0;slot<2;slot++) {
            var key=slot===0?'shopItem':'shopItemSecondary', raw=integer(read(object,key));
            if(raw===null){missing('object.'+key);}
            var price=Array.isArray(prices)?integer(prices[slot]):null;
            if(price===null)missing('price['+slot+']');
            var itemId=raw, source='ride-object';
            if(slot===1&&hasPhoto===true&&descriptor){itemId=descriptor.photoItem;source='ride-type-photo';}
            if(itemId===constants.noneItem) {
                result.items.push({slot:slot,role:slot===0?(descriptor&&descriptor.specialType==='toilet'?'toilet-admission':descriptor&&descriptor.category==='shop'?'unused':'ride-admission'):'unused',
                    currentPrice:price,item:null,recommendation:null});
                continue;
            }
            var item=itemId===null?null:items[itemId];
            if(!item||item.id!==itemId||!item.name||item.isContainer||!(item.isFood||item.isDrink||item.isSouvenir||item.isPhoto)){missing('object.'+key+'.item');result.items.push({slot:slot,role:'unknown',currentPrice:price,item:null,recommendation:null});continue;}
            var values=item.values, min=Math.min(values.base,values.hot,values.cold), max=Math.max(values.base,values.hot,values.cold);
            var wetUmbrella=item.name==='umbrella'&&precipitation===true;
            var candidate=Math.min(min,constants.maxRidePrice);
            var entry={slot:slot,role:item.isPhoto?'photo':item.isFood?'food':item.isDrink?'drink':'souvenir',
                item:{id:item.id,name:item.name,source:source},currentPrice:price,stockCost:item.cost,
                unitMargin:price===null?null:price-item.cost,nativeValues:{base:values.base,hot:values.hot,cold:values.cold},
                noPriceRefusalReference:wetUmbrella?null:candidate,
                valueRange:{min:min,max:max},legalPriceLimit:constants.maxRidePrice,
                precipitation:precipitation,priceRefusalBypassed:wetUmbrella,
                commonPriceScope:'API 124 does not expose the shared-price item flags; a price change can also affect other shops or rides.',
                recommendation:{strategy:wetUmbrella?'rain-demand-review':'no-price-refusal-reference',candidatePrice:wetUmbrella||noMoney===true||moneyUnknown?null:candidate,
                    profitOptimum:null,requiresDemandReview:true},
                saleConditions:['Enough cash and no duplicate item; a price reference does not guarantee purchase.']};
            if(item.isSouvenir&&item.name!=='map'&&!wetUmbrella)entry.saleConditions.push('Souvenir purchase still depends on happiness and at least three previous rides, unless a matching voucher applies.');
            if(item.isFood||item.isDrink)entry.saleConditions.push('Hunger or thirst, nausea and unfinished food or drink can prevent purchase.');
            if(item.name==='balloon'||item.name==='iceCream'||item.name==='candyfloss'||item.name==='sunglasses')entry.saleConditions.push('Precipitation can prevent purchase; sunglasses and ice cream also require temperature of at least 12 C.');
            if(min!==max)entry.saleConditions.push('The current value depends on climate thresholds not exposed by API 124; the reference uses the lowest native weather value.');
            if(wetUmbrella)entry.saleConditions.push('During native precipitation, umbrella price refusal and souvenir happiness checks are bypassed; affordability still limits sales. The legal price limit is not a proven profit optimum.');
            if(noMoney===true)entry.saleConditions.push('Money is disabled in this park; price changes have no cash benefit.');
            if(price!==null&&noMoney!==true&&!moneyUnknown) {
                if(wetUmbrella&&price<constants.maxRidePrice)result.warnings.push({code:'umbrella_rain_pricing_review',severity:'info',slot:slot,currentPrice:price,referencePrice:null,
                    message:'Umbrella price refusal is bypassed in this weather. Review pricing against affordability and sales; no profit optimum can be inferred.'});
                else if(price<candidate)result.warnings.push({code:item.isPhoto?'photo_price_below_reference':'item_price_below_reference',severity:'info',slot:slot,currentPrice:price,referencePrice:candidate,
                    message:'Price is below the native reference that introduces no price refusal for any happiness or weather. Review raising it and verify sales and profit.'});
                else if(!wetUmbrella&&price>max)result.warnings.push({code:item.isPhoto?'photo_price_refusal_risk':'item_price_refusal_risk',severity:'info',slot:slot,currentPrice:price,referencePrice:candidate,
                    message:'Price exceeds every native weather value; guests can refuse on price depending on happiness and chance.'});
            }
            result.items.push(entry);
        }
        if(nativePhoto!==null&&trackPhoto!==null&&nativePhoto!==trackPhoto)result.warnings.push({code:'photo_flag_track_mismatch',severity:'info',
            message:'The native photo-sales flag and reachable-circuit photo inventory disagree. Photo pricing follows the native sales flag; review the track and flag state.'});
        if(result.unavailable.length)result.status='unknown';
        return result;
    }
    function inspectPark(park,support) {
        var configured=integer(read(park,'entranceFee')), value=integer(read(park,'totalRideValueForMoney'));
        var noMoney=flag(park,'noMoney'), free=flag(park,'freeParkEntry'), unlocked=flag(park,'unlockAllPrices');
        var enabled=unlocked===true?true:free===false?true:unlocked===false&&free===true?false:null;
        var effective=noMoney===true||enabled===false?0:noMoney===false&&enabled===true?configured:null;
        var max=support&&support.constants?integer(support.constants.maxEntranceFee):null;
        var result={status:'ok',configuredEntranceFee:configured,effectiveEntranceFee:effective,
            entranceFeeEnabled:enabled,noMoney:noMoney,totalRideValueForMoney:value,
            noGenerationPenaltyReference:value===null||max===null?null:Math.min(value,max),
            guestGenerationMultiplier:effective===null||value===null?null:effective>value?(Math.floor(effective/2)>value?1/16:1/4):1,
            recommendation:null,profitOptimum:null,warnings:[],unavailable:[],
            basis:'Native guest-generation thresholds; admissions also depend on arriving guests having enough cash and on vouchers.'};
        if(configured===null)result.unavailable.push('entranceFee');
        if(value===null)result.unavailable.push('totalRideValueForMoney');
        if(effective===null)result.unavailable.push('park pricing flags');
        if(max===null)result.unavailable.push('pricingSupport.constants.maxEntranceFee');
        if(effective!==null&&noMoney===false&&enabled===true&&result.noGenerationPenaltyReference!==null) {
            result.recommendation={strategy:'avoid-native-generation-penalty',candidatePrice:result.noGenerationPenaltyReference,profitOptimum:null,requiresDemandReview:true};
            if(result.guestGenerationMultiplier<1)result.warnings.push({code:'entrance_fee_generation_penalty',severity:'info',currentPrice:effective,referencePrice:result.noGenerationPenaltyReference,
                message:'The entrance fee reduces the native guest-generation probability relative to total ride value. Review admissions and affordability before changing it.'});
            else if(effective<result.noGenerationPenaltyReference)result.warnings.push({code:'entrance_fee_pricing_review',severity:'info',currentPrice:effective,referencePrice:result.noGenerationPenaltyReference,
                message:'The entrance fee is below the native generation-penalty reference. Review visitor affordability and admissions profit; this reference is not a proven profit optimum.'});
        }
        if(result.unavailable.length)result.status='unknown';
        return result;
    }
    return {inspect:inspect,inspectPark:inspectPark};
})();
if(typeof module!=='undefined')module.exports=BridgePricingInspector;
