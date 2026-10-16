/* SPDX-License-Identifier: GPL-3.0-only */
var BridgeMoney = (function () {
    'use strict';
    function create(context) {
        function format(value) {
            // API 124 narrows numeric format arguments to signed int32.
            // Never let an otherwise-valid money64 amount silently wrap.
            if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647) return null;
            if (!context || typeof context.formatString !== 'function') return null;
            try {
                var text = context.formatString('{CURRENCY2DP}', value);
                return typeof text === 'string' && text.length > 0 ? text : null;
            } catch (e) { return null; }
        }
        function info() {
            var language = null;
            try { language = context.configuration.get('general.language', null); } catch (e) { }
            if (typeof language !== 'string') language = null;
            return {source:'native-game-formatter',code:null,language:language,available:format(10)!==null,
                formatToken:'{CURRENCY2DP}',sample:format(10),rawUnits:'OpenRCT2 money units',
                formatRange:{min:-2147483648,max:2147483647}};
        }
        function fields(object, names) {
            var result = {};
            names.forEach(function (name) {
                if (object[name] !== undefined) result[name] = Array.isArray(object[name]) ? object[name].map(format) : format(object[name]);
            });
            return result;
        }
        function pricing(value) {
            if(!value || typeof value!=='object')return value;
            var result=Object.assign({},value),display=fields(value,['currentPrice','referencePrice','stockCost','unitMargin','noPriceRefusalReference','legalPriceLimit','candidatePrice',
                'configuredEntranceFee','effectiveEntranceFee','totalRideValueForMoney','noGenerationPenaltyReference']);
            if(Object.keys(display).length)result.moneyDisplay=display;
            ['items','warnings','observations'].forEach(function(key){if(Array.isArray(value[key]))result[key]=value[key].map(pricing);});
            if(value.recommendation)result.recommendation=pricing(value.recommendation);
            if(value.nativeValues)result.nativeValues=Object.assign({},value.nativeValues,{moneyDisplay:fields(value.nativeValues,['base','hot','cold'])});
            if(value.valueRange)result.valueRange=Object.assign({},value.valueRange,{moneyDisplay:fields(value.valueRange,['min','max'])});
            return result;
        }
        function ride(value) {
            return Object.assign({}, value, {moneyDisplay:fields(value,['price','incomePerHour','profit'])},value.pricing?{pricing:pricing(value.pricing)}:{});
        }
        function enrich(op, value) {
            if (!value || typeof value !== 'object') return value;
            if (op === 'park') {
                var enriched=Object.assign({}, value, {currency:info(),moneyDisplay:fields(value.park,['cash','bankLoan','maxBankLoan','entranceFee','value','companyValue'])});
                if(value.pricing)enriched.pricing=pricing(value.pricing);
                if(value.rideReview)enriched.rideReview=Object.assign({},value.rideReview,{rides:value.rideReview.rides.map(function(r){return Object.assign({},r,{pricing:pricing(r.pricing)});}),observations:value.rideReview.observations.map(pricing)});
                return enriched;
            }
            if (op === 'ride') return ride(value);
            if (op === 'rides') return value.map(ride);
            if (op === 'action.query') return Object.assign({}, value, {costDisplay:format(value.cost)});
            if (['action.execute','batch.execute','track.build','coaster.build','receipt'].indexOf(op) >= 0) {
                var result = Object.assign({}, value);
                if(value.postBuildReview && value.postBuildReview.pricing)result.postBuildReview=Object.assign({},value.postBuildReview,{pricing:pricing(value.postBuildReview.pricing)});
                if (value.spent !== undefined) result.spentDisplay = format(value.spent);
                if (Array.isArray(value.completed)) result.completed = value.completed.map(function (item) {
                    return Object.assign({}, item, {result:Object.assign({},item.result,{costDisplay:format(item.result && item.result.cost)})});
                });
                if (value.detail && typeof value.detail === 'object') {
                    result.detail = Object.assign({}, value.detail);
                    ['cost','remaining'].forEach(function (key) { if (value.detail[key] !== undefined) result.detail[key+'Display'] = format(value.detail[key]); });
                }
                return result;
            }
            return value;
        }
        return {format:format,info:info,fields:fields,enrich:enrich};
    }
    return {create:create};
})();
if (typeof module !== 'undefined') module.exports = BridgeMoney;
