/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';

// OpenRCT2 v0.5.6 Config.cpp / Language.cpp. This reads explicit settings only:
// native locale defaults and live formatted money cannot be inferred here.
const currencies=new Set(['GBP','USD','FRF','DEM','JPY','ESP','ITL','NLG','SEK','EUR','KRW','RUB','CZK','HKD','TWD','CNY','HUF','CUSTOM']);
const languages=new Set(['ar-EG','ca-ES','zh-CN','zh-TW','cs-CZ','da-DK','de-DE','en-GB','en-US','eo-ZZ','es-ES','fr-FR','fr-CA','gl-ES','it-IT','ja-JP','ko-KR','hu-HU','nl-NL','nb-NO','pl-PL','pt-BR','ru-RU','fi-FI','sv-SE','tr-TR','uk-UA','vi-VN']);
const keys=new Set(['currency_format','language','custom_currency_rate','custom_currency_affix','custom_currency_symbol']);

function withoutComment(line){
    let quote=null,escaped=false;
    for(let i=0;i<line.length;i++){
        const c=line[i];
        if(!quote&&c==='#'&&!escaped)return line.slice(0,i);
        if(!escaped&&(c==='"'||c==="'"))quote=quote===c?null:quote||c;
        escaped=c==='\\'&&!escaped;
    }
    return line;
}

function valueOf(raw){
    raw=raw.trim();
    if(!raw.length)return null;
    const quote=raw[0]==='"'||raw[0]==="'"?raw[0]:null;
    let value='',escaped=false,closed=!quote;
    for(let i=quote?1:0;i<raw.length;i++){
        const c=raw[i];
        if(escaped){value+=c;escaped=false;continue;}
        if(c==='\\'){escaped=true;continue;}
        if(quote&&c===quote){if(i!==raw.length-1)return null;closed=true;break;}
        if(!quote&&(c==='"'||c==="'"))return null;
        value+=c;
    }
    return escaped||!closed?null:value;
}

/**
 * Parse an explicitly selected config.ini's [general] display settings.
 * Returns null for absent/ambiguous/invalid currency or language settings.
 * Custom fields are nullable when absent for a standard currency; CUSTOM
 * requires all three. Rates retain native integer units, not exchange rates.
 * No filesystem access, path discovery, money conversion or default currency.
 */
function parseDisplaySettings(text){
    if(typeof text!=='string'||text.includes('\0'))return null;
    let section=null,generalCount=0;
    const values=Object.create(null);
    for(const raw of text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/)){
        const line=withoutComment(raw).trim();
        if(!line||line.startsWith(';'))continue;
        if(line.startsWith('[')){
            const header=/^\[([^\[\]]+)\]$/.exec(line);
            if(!header)return null;
            section=header[1].toLowerCase();
            if(section==='general'&&++generalCount!==1)return null;
            continue;
        }
        if(section!=='general')continue;
        const equal=line.indexOf('='),name=(equal<0?line:line.slice(0,equal)).trim().toLowerCase();
        if(!keys.has(name))continue;
        if(equal<0||Object.hasOwn(values,name))return null;
        const value=valueOf(line.slice(equal+1));
        if(value===null||/[\u0000-\u001f\u007f]/.test(value))return null;
        values[name]=value;
    }
    if(generalCount!==1||!Object.hasOwn(values,'currency_format')||!Object.hasOwn(values,'language'))return null;
    const currencyCode=values.currency_format.toUpperCase(),language=values.language;
    // Native currency/affix enums ignore case; native language matching is exact.
    if(!currencies.has(currencyCode)||!languages.has(language))return null;
    let customCurrencyRate=null,customCurrencyAffix=null,customCurrencySymbol=null;
    if(Object.hasOwn(values,'custom_currency_rate')){
        if(!/^\+?\d+$/.test(values.custom_currency_rate))return null;
        customCurrencyRate=Number(values.custom_currency_rate);
        if(!Number.isSafeInteger(customCurrencyRate)||customCurrencyRate<1||customCurrencyRate>2147483647)return null;
    }
    if(Object.hasOwn(values,'custom_currency_affix')){
        customCurrencyAffix=values.custom_currency_affix.toUpperCase();
        if(customCurrencyAffix!=='PREFIX'&&customCurrencyAffix!=='SUFFIX')return null;
    }
    if(Object.hasOwn(values,'custom_currency_symbol')){
        customCurrencySymbol=values.custom_currency_symbol;
        // Native CurrencyDescriptor stores an 8-byte UTF-8 buffer including NUL.
        // Reject values that would truncate instead of reporting a different symbol.
        if(!customCurrencySymbol.trim()||Buffer.byteLength(customCurrencySymbol,'utf8')>7||/[\ud800-\udfff]/u.test(customCurrencySymbol))return null;
    }
    if(currencyCode==='CUSTOM'&&(customCurrencyRate===null||customCurrencyAffix===null||customCurrencySymbol===null))return null;
    return {currencyCode,language,customCurrencyRate,customCurrencyAffix,customCurrencySymbol};
}

module.exports={parseDisplaySettings};
