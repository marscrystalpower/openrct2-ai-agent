/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {parseDisplaySettings}=require('../scripts/display-settings');
const ini=(currency='USD',language='en-US',extra='')=>'[general]\ncurrency_format = '+currency+'\nlanguage = '+language+'\n'+extra;
const expected=(currencyCode,language)=>({currencyCode,language,customCurrencyRate:null,customCurrencyAffix:null,customCurrencySymbol:null});
const custom='custom_currency_rate = 25\ncustom_currency_affix = PREFIX\ncustom_currency_symbol = "¢"\n';

test('explicit USD, GBP and JPY are preserved without currency conversion or defaults',()=>{
    for(const [currency,language] of [['USD','en-US'],['GBP','en-GB'],['JPY','ja-JP']])assert.deepEqual(parseDisplaySettings(ini(currency,language)),expected(currency,language));
});

test('native BOM, line endings, case-insensitive keys/enums, quoted values and hash comments are handled',()=>{
    assert.deepEqual(parseDisplaySettings('\uFEFF # comment\r\n [GENERAL] # profile\r\nCurrency_Format = "usd" # dollars\r\nLANGUAGE = \'en-US\'\r\n'),expected('USD','en-US'));
});

test('only the selected general section supplies settings and unrelated values are excluded',()=>{
    const text='currency_format = GBP\n[network]\ncurrency_format = GBP\nlanguage = en-GB\npassword = "private"\n'+ini()+'[sound]\ncurrency_format = JPY\nlanguage = ja-JP\n';
    assert.deepEqual(parseDisplaySettings(text),expected('USD','en-US'));
});

test('CUSTOM preserves validated rate, affix and UTF-8 symbol',()=>{
    assert.deepEqual(parseDisplaySettings(ini('CUSTOM','en-US',custom)),{currencyCode:'CUSTOM',language:'en-US',customCurrencyRate:25,customCurrencyAffix:'PREFIX',customCurrencySymbol:'¢'});
    assert.deepEqual(parseDisplaySettings(ini('custom','en-US','custom_currency_rate = +00010\ncustom_currency_affix = suffix\ncustom_currency_symbol = " kr"\n')),{currencyCode:'CUSTOM',language:'en-US',customCurrencyRate:10,customCurrencyAffix:'SUFFIX',customCurrencySymbol:' kr'});
});

test('quoted custom symbols preserve literal hashes and native escaped quotes/backslashes',()=>{
    for(const [encoded,symbol] of [['"A#B" # comment','A#B'],['"A\\"B"','A"B'],['"A\\\\B"','A\\B']]){
        const parsed=parseDisplaySettings(ini('CUSTOM','en-US','custom_currency_rate = 1\ncustom_currency_affix = PREFIX\ncustom_currency_symbol = '+encoded+'\n'));
        assert.equal(parsed.customCurrencySymbol,symbol);
    }
});

test('explicit custom settings are available for standard currencies without being used as their display rate',()=>{
    assert.deepEqual(parseDisplaySettings(ini('USD','en-US',custom)),{currencyCode:'USD',language:'en-US',customCurrencyRate:25,customCurrencyAffix:'PREFIX',customCurrencySymbol:'¢'});
    const partial=parseDisplaySettings(ini('GBP','en-GB','custom_currency_rate = 12\n'));
    assert.equal(partial.customCurrencyRate,12);assert.equal(partial.customCurrencyAffix,null);assert.equal(partial.customCurrencySymbol,null);
});

test('missing currency, missing language, missing general section and partial CUSTOM return null',()=>{
    for(const text of ['',null,undefined,{},'[general]\nlanguage = en-US\n','[general]\ncurrency_format = USD\n','[network]\ncurrency_format = USD\nlanguage = en-US\n',ini('CUSTOM'),ini('CUSTOM','en-US','custom_currency_rate = 10\ncustom_currency_affix = PREFIX\n')])assert.equal(parseDisplaySettings(text),null);
});

test('duplicate general sections and duplicate display keys are rejected as ambiguous',()=>{
    for(const text of [ini()+ini('GBP','en-GB'),ini()+'[GENERAL]\n',ini()+'currency_format = USD\n',ini()+'CURRENCY_FORMAT = GBP\n',ini()+'language = en-GB\n',ini('CUSTOM','en-US',custom+'custom_currency_rate = 25\n')])assert.equal(parseDisplaySettings(text),null);
});

test('unknown currency, wrong language casing, malformed quotes and invalid section syntax return null',()=>{
    for(const text of [ini('CAD'),ini('PLN','pl-PL'),ini('USD','en-us'),ini('USD','xx-XX'),ini('USD; comment'),ini('"USD'),ini('USD"'),ini()+ '[general\n',ini()+'[general] trailing\n',ini().replace('[general]','[ general ]'),ini().replace('currency_format = USD','currency_format'),ini().replace('language = en-US','language = "en-US"junk'),ini()+'\0'])assert.equal(parseDisplaySettings(text),null);
});

test('CUSTOM rejects unsafe rates, invalid affixes and symbols that would be empty, control-containing or truncated',()=>{
    for(const value of ['0','-1','1.5','10suffix','2147483648','99999999999999999999'])assert.equal(parseDisplaySettings(ini('CUSTOM','en-US',custom.replace('rate = 25','rate = '+value))),null);
    for(const value of ['MIDDLE','0',''])assert.equal(parseDisplaySettings(ini('CUSTOM','en-US',custom.replace('affix = PREFIX','affix = '+value))),null);
    for(const value of ['""','"   "','"12345678"','"€€€"','"a\t"','"a\\"','"\ud800"'])assert.equal(parseDisplaySettings(ini('CUSTOM','en-US',custom.replace('symbol = "¢"','symbol = '+value))),null);
    assert.equal(parseDisplaySettings(ini('CUSTOM','en-US',custom.replace('rate = 25','rate = 2147483647'))).customCurrencyRate,2147483647);
});

test('accepted config currency and language names agree with the pinned native source',()=>{
    const source=path.resolve(__dirname,'../vendor/OpenRCT2/src/openrct2');
    const config=fs.readFileSync(path.join(source,'config/Config.cpp'),'utf8');
    const nativeCurrencies=[...config.matchAll(/ConfigEnumEntry<CurrencyType>\("([A-Z]+)"/g)].map(m=>m[1]);
    for(const currency of nativeCurrencies)assert.equal(parseDisplaySettings(ini(currency,'en-US',currency==='CUSTOM'?custom:'')).currencyCode,currency);
    const languageSource=fs.readFileSync(path.join(source,'localisation/Language.cpp'),'utf8');
    for(const match of languageSource.matchAll(/\{ "([a-z]{2}-[A-Z]{2})"/g))assert.equal(parseDisplaySettings(ini('USD',match[1])).language,match[1]);
});
