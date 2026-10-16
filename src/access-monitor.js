/* SPDX-License-Identifier: GPL-3.0-only */
var BridgeAccessMonitor = (function () {
    'use strict';
    var MAX_OVERVIEW_WARNINGS = 64;
    function amenityView(report,id){
        var value=report.amenities;
        if(!value)return {status:'unknown',complete:false,sites:[],observations:[],unavailable:['Local amenity report unavailable']};
        var sites=(value.sites||[]).filter(function(site){return id===undefined||site.ride===id;}),observations=(value.observations||[]).filter(function(item){return id===undefined||item.ride===id;}),out={};
        Object.keys(value).forEach(function(k){if(k!=='sites'&&k!=='observations')out[k]=value[k];});
        if(id!==undefined){
            var known=value.status!=='checking'&&!value.truncated&&(sites.length>0?sites.every(function(site){return site.complete;}):value.complete===true);
            out.complete=known;out.status=value.status==='checking'?'checking':!known?'unknown':!sites.length?'not_applicable':sites.some(function(site){return site.status==='advisories';})?'advisories':'ok';
            out.summary={sites:sites.length,advisorySites:sites.filter(function(site){return site.status==='advisories';}).length,unknownSites:sites.filter(function(site){return !site.complete;}).length};
        }
        out.siteCount=sites.length;out.sites=sites.slice(0,64);out.sitesOmitted=Math.max(0,sites.length-64);
        out.observationCount=observations.length;out.observations=observations.slice(0,64);out.observationsOmitted=Math.max(0,observations.length-64);
        return out;
    }
    function summarize(report) {
        var warnings = Array.isArray(report.warnings) ? report.warnings : [];
        var observations = Array.isArray(report.observations) ? report.observations : [];
        return {status:report.status,complete:report.complete,truncated:report.truncated,
            warningCount:warnings.length,warnings:warnings.slice(0,MAX_OVERVIEW_WARNINGS),
            warningsOmitted:Math.max(0,warnings.length-MAX_OVERVIEW_WARNINGS),summary:report.summary,
            checkedAt:report.checkedAt,elapsedMs:report.elapsedMs,revision:report.revision,
            observationCount:observations.length,observations:observations.slice(0,16),
            unavailable:report.unavailable,furniture:report.furniture||{status:'unknown',complete:false,unavailable:['Path furniture report unavailable']},amenities:amenityView(report),detailsOperation:'path.access'};
    }
    function forRide(report,id) {
        var endpoints = (report.endpoints || []).filter(function (endpoint) { return endpoint.ride === id; });
        var warnings = (report.warnings || []).filter(function (warning) { return warning.ride === id; });
        var observations = (report.observations || []).filter(function (observation) { return observation.ride === id; });
        var known=report.complete && endpoints.length>0 && endpoints.every(function(endpoint){return endpoint.status==='healthy'||endpoint.status==='unreachable';});
        return {status:warnings.length ? 'problems' : !known ? 'unknown' : observations.length ? 'inactive' : 'ok',
            complete:known,warningCount:warnings.length,warnings:warnings,
            endpoints:endpoints,observations:observations,checkedAt:report.checkedAt,revision:report.revision,amenities:amenityView(report,id)};
    }
    // A job yields between bounded steps; it never sends native actions. Cache
    // invalidation also cancels subscribers so an old map cannot look current.
    function create(context,map,metadata,inspector,options) {
        options = options || {};
        var clock = options.now || Date.now, revision = 0, active = null, cached = null, finishedAt = 0;
        var maxAge = options.maxAgeMs === undefined ? 2000 : options.maxAgeMs;
        function fresh() { return cached !== null && clock()-finishedAt >= 0 && clock()-finishedAt <= maxAge; }
        function checking() { return {status:'checking',complete:false,warningCount:null,warnings:[],
            revision:revision,progress:active ? active.job.status() : null,furniture:{status:'checking',complete:false},amenities:{status:'checking',complete:false,sites:[],observations:[]},detailsOperation:'path.access'}; }
        function failed(message) { return {status:'unknown',complete:false,truncated:false,warnings:[],endpoints:[],
            summary:{},unavailable:[message],furniture:{status:'unknown',complete:false,unavailable:[message]},amenities:{status:'unknown',complete:false,sites:[],observations:[],unavailable:[message]},checkedAt:clock(),elapsedMs:0,revision:revision}; }
        function deliver(run,error,result) {
            var callbacks = run.callbacks.splice(0);
            callbacks.forEach(function (callback) { try { callback(error,result); } catch (ignored) { } });
        }
        function start() {
            if (active) return active;
            var run = {revision:revision,startedAt:clock(),callbacks:[],job:null};
            active = run;
            try { run.job = inspector.create(map,metadata,{furniture:options.furniture,pricingSupport:options.pricingSupport,amenities:options.amenities}); }
            catch (error) {
                cached = failed(String(error.message || error)); finishedAt = clock(); active = null;
                return null;
            }
            function tick() {
                if (active !== run || run.revision !== revision) return;
                try {
                    if (context.mode !== 'normal' && context.mode !== 'track_designer') throw new Error('Park is no longer loaded');
                    if (options.canRead && !options.canRead()) throw new Error('Access audit is no longer in a supported single-player session');
                    run.job.step(1024);
                    if (!run.job.done) { context.setTimeout(tick,1); return; }
                    var report = run.job.result();
                    report.checkedAt = clock(); report.elapsedMs = Math.max(0,clock()-run.startedAt); report.revision = revision;
                    cached = report; finishedAt = clock(); active = null; deliver(run,null,report);
                } catch (error) {
                    cached = failed(String(error.message || error)); finishedAt = clock(); active = null; deliver(run,null,cached);
                }
            }
            context.setTimeout(tick,1);
            return run;
        }
        function invalidate(reason) {
            revision++; cached = null;
            var old = active; active = null;
            if (old) deliver(old,new Error('Access audit invalidated: '+(reason || 'park geometry changed')+'; request a fresh audit'),null);
        }
        function overview() {
            if (fresh()) return summarize(cached);
            start();
            return fresh() ? summarize(cached) : checking();
        }
        function wait(args,callback) {
            args = args || {};
            if (!args || typeof args !== 'object' || Array.isArray(args) ||
                Object.keys(args).some(function (name) { return name !== 'refresh'; }) ||
                (args.refresh !== undefined && typeof args.refresh !== 'boolean')) throw new Error('path.access accepts only optional boolean refresh');
            if (args.refresh === true && !active) cached = null;
            if (fresh()) { callback(null,cached); return; }
            var run = start();
            if (run) { if(run.callbacks.length>=32)throw new Error('Too many pending access audits');run.callbacks.push(callback); }
            else callback(null,cached);
        }
        function ride(id) {
            if (fresh()) return forRide(cached,id);
            return checking();
        }
        return {overview:overview,wait:wait,invalidate:invalidate,ride:ride};
    }
    return {create:create,summarize:summarize,forRide:forRide};
})();
if (typeof module !== 'undefined') module.exports = BridgeAccessMonitor;
