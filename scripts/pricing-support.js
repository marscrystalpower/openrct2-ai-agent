/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
// Extract monetary references from the pinned engine, not a currency-specific
// price table. Runtime display still uses the running game's money formatter.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { SOURCE_COMMIT } = require('./track-support');

function check(value, message) { if (!value) throw Error('Pricing support extraction: ' + message); }
function generatePricingSupport(sourceRoot) {
    sourceRoot = path.resolve(sourceRoot);
    const used = new Set();
    const git = args => cp.execFileSync('git', ['-C', sourceRoot, ...args], { encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim();
    check(git(['rev-parse','HEAD']) === SOURCE_COMMIT, 'upstream revision differs from pinned source');
    function read(relative) { used.add(relative); return fs.readFileSync(path.join(sourceRoot, relative), 'utf8'); }
    function strip(text) { return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' '); }
    function body(text, start) {
        check(text[start] === '{', 'missing initializer');
        let depth = 0;
        for (let i=start;i<text.length;i++) {
            if (text[i] === '{') depth++;
            if (text[i] === '}' && --depth === 0) return text.slice(start+1,i);
        }
        throw Error('Pricing support extraction: unbalanced initializer');
    }
    function enumValues(text, name) {
        const m = new RegExp('enum class '+name+'\\s*:\\s*uint8_t\\s*\\{').exec(text);
        check(m, 'missing '+name+' enum');
        let next=0; const values={};
        strip(body(text,m.index+m[0].length-1)).split(',').map(x=>x.trim()).filter(Boolean).forEach(entry=>{
            const match=/^(\w+)(?:\s*=\s*(\d+))?$/.exec(entry);
            check(match && !Object.hasOwn(values,match[1]), 'unknown '+name+' enum syntax');
            if(match[2])next=Number(match[2]); values[match[1]]=next++;
        });
        return values;
    }
    function money(text) {
        const m=/^([0-9]+)\.([0-9]{2})_GBP$/.exec(text.trim());
        check(m, 'unknown native money literal');
        const hundredths=Number(m[1])*100+Number(m[2]);
        check(hundredths%10===0, 'money literal has unsupported precision');
        return hundredths/10;
    }
    const moneyHeader=read('src/openrct2/core/Money.hpp');
    check(/operator""_GBP\(long double money\)[\s\S]*?return static_cast<double>\(money\) \* 10;/.test(moneyHeader), 'money unit conversion changed');
    const shopHeader=read('src/openrct2/ride/ShopItem.h');
    const itemIds=enumValues(shopHeader,'ShopItem');
    check(itemIds.count===56 && itemIds.none===255, 'shop item count or sentinel changed');
    const shops=read('src/openrct2/ride/ShopItem.cpp');
    const rows=[...shops.matchAll(/\/\*\s*(ShopItem::\w+|\d+)\s*\*\/\s*\{\s*([0-9.]+_GBP),\s*([0-9.]+_GBP),\s*([0-9.]+_GBP),\s*([0-9.]+_GBP),\s*([0-9.]+_GBP),([^\n]*)/g)];
    // The native fixed-size array has two implicit zero-initialized trailing
    // entries (54 and 55), which are not saleable items or enum names.
    check(rows.length===54 && itemIds.emptyBowlBlue===53, 'shop value table is incomplete');
    const items=rows.map((row,id)=>{
        const name=row[1].startsWith('ShopItem::')?row[1].slice(10):null;
        check(name===null?Number(row[1])===id:itemIds[name]===id, 'shop item identity/order changed');
        const flags=row[7];
        return {id,name,cost:money(row[2]),values:{base:money(row[3]),hot:money(row[4]),cold:money(row[5])},
            defaultPrice:money(row[6]),isFood:flags.includes('SHOP_ITEM_FLAG_IS_FOOD'),isDrink:flags.includes('SHOP_ITEM_FLAG_IS_DRINK'),
            isSouvenir:flags.includes('SHOP_ITEM_FLAG_IS_SOUVENIR'),isPhoto:flags.includes('SHOP_ITEM_FLAG_IS_PHOTO'),
            isContainer:flags.includes('SHOP_ITEM_FLAG_IS_CONTAINER')};
    });
    while(items.length<itemIds.count)items.push({id:items.length,name:null,cost:0,values:{base:0,hot:0,cold:0},defaultPrice:0,
        isFood:false,isDrink:false,isSouvenir:false,isPhoto:false,isContainer:false});
    const rideSource=read('src/openrct2/ride/RideData.cpp');
    const mapping=/kRideTypeDescriptors\[RIDE_TYPE_COUNT\]\s*=\s*\{/.exec(rideSource);
    check(mapping, 'missing ride type mapping');
    const rideNames=strip(body(rideSource,mapping.index+mapping[0].length-1)).split(',').map(x=>x.trim()).filter(Boolean);
    check(rideNames.length===103 && rideNames.every(n=>/^k\w+RTD$/.test(n)), 'ride type mapping changed');
    const descriptors={};
    function parseDescriptors(text) {
        text=strip(text);
        for(const m of text.matchAll(/constexpr RideTypeDescriptor (\w+)\s*=\s*\{/g)) {
            check(!Object.hasOwn(descriptors,m[1]),'duplicate ride descriptor');
            const fields=body(text,m.index+m[0].length-1);
            const name=/\.Name\s*=\s*"([^"]+)"/.exec(fields), photo=/\.PhotoItem\s*=\s*ShopItem::(\w+)/.exec(fields);
            const special=/\.specialType\s*=\s*RtdSpecialType::(\w+)/.exec(fields);
            const category=/\.Category\s*=\s*RideCategory::(\w+)/.exec(fields);
            check(name && photo && category && Object.hasOwn(itemIds,photo[1]) && items[itemIds[photo[1]]]?.isPhoto,'missing ride photo item');
            descriptors[m[1]]={name:name[1],photoItem:itemIds[photo[1]],category:category[1],specialType:special?special[1]:null};
        }
    }
    function visit(relative) {
        for(const entry of fs.readdirSync(path.join(sourceRoot,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
            const filename=relative+'/'+entry.name;
            if(entry.isDirectory())visit(filename);
            else if(entry.name.endsWith('.h')) {
                parseDescriptors(read(filename));
            }
        }
    }
    parseDescriptors(read('src/openrct2/ride/RideData.h'));
    visit('src/openrct2/ride/rtd');
    const rideTypes=rideNames.map((key,id)=>{check(descriptors[key],'unmapped ride descriptor');return {id,...descriptors[key]};});
    const rideHeader=read('src/openrct2/ride/Ride.h');
    const rideFlags=enumValues(rideHeader,'RideFlag');
    check(rideFlags.onRidePhoto===5,'native photo flag changed');
    const maxRide=/kRideMaxPrice\s*=\s*([0-9.]+_GBP)/.exec(rideHeader);
    const maxEntry=/kMaxEntranceFee\s*=\s*([0-9.]+_GBP)/.exec(read('src/openrct2/world/ParkData.h'));
    check(maxRide && maxEntry,'missing legal price limits');
    const guest=read('src/openrct2/entity/Guest.cpp');
    for(const expression of ['if (itemValue < price)','if (!isPrecipitatingAndUmbrella)','if (guest.happiness >= 128)',
        'if (guest.happiness >= 180)','ScenarioRand() & 0x07','guest.guestNumRides < 3','guest.cashInPocket',
        'return shopItemDescriptor.HotValue;','return shopItemDescriptor.ColdValue;','return shopItemDescriptor.BaseValue;'])
        check(guest.includes(expression),'native item purchase semantics changed: '+expression);
    check((guest.match(/itemValue \/= 2;/g)||[]).length===2,'native happiness price tolerance changed');
    const park=read('src/openrct2/world/Park.cpp');
    check(/if \(entranceFee > park.totalRideValueForMoney\)[\s\S]*?probability \/= 4;[\s\S]*?if \(entranceFee \/ 2 > park.totalRideValueForMoney\)[\s\S]*?probability \/= 4;/.test(park),'native admission generation thresholds changed');
    const weather=read('src/openrct2/world/Weather.cpp');
    check(/bool isPrecipitating\(\)\s*\{\s*return isRaining\(\) \|\| isSnowingHeavily\(\);/.test(weather),'precipitation semantics changed');
    for(const type of ['rain','heavyRain','thunder','heavySnow','blizzard'])check(weather.includes('weather == Type::'+type),'native precipitation type missing');
    const bindings=read('src/openrct2/scripting/bindings/object/ScObject.hpp');
    check(bindings.includes('rideEntry->shop_item[0]') && bindings.includes('rideEntry->shop_item[1]')
        && bindings.includes('"shopItem"') && bindings.includes('"shopItemSecondary"'),'native shop item bindings changed');
    try {git(['ls-files','--error-unmatch','--',...[...used].sort()]);git(['diff','--quiet',SOURCE_COMMIT,'--',...[...used].sort()]);}
    catch {throw Error('Pricing support extraction: upstream extraction sources differ from pinned revision');}
    return {sourceCommit:SOURCE_COMMIT,items,rideTypes,constants:{noneItem:itemIds.none,photoFlag:2**rideFlags.onRidePhoto,
        maxRidePrice:money(maxRide[1]),maxEntranceFee:money(maxEntry[1]),precipitationTypes:['rain','heavyRain','thunder','heavySnow','blizzard']}};
}
module.exports={generatePricingSupport,SOURCE_COMMIT};
if(require.main===module){
    const data=generatePricingSupport(process.argv[2]||path.resolve(__dirname,'../vendor/OpenRCT2'));
    fs.writeFileSync(process.argv[3]||path.resolve(__dirname,'../generated/pricing-support.json'),JSON.stringify(data,null,2)+'\n');
    console.log('Generated pricing support: '+data.items.length+' shop items, '+data.rideTypes.length+' ride types');
}
