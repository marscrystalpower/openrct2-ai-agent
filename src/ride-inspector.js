/* SPDX-License-Identifier: GPL-3.0-only */
var BridgeRideInspector = (function () {
    'use strict';
    // OpenRCT2 0.5.6 / API 124: Ride.h, ScRide.cpp and ScVehicle.cpp.
    // Only read public scripting properties. Never infer capacity from colours,
    // requested settings, object maxima, or the number of guest slots.
    var MAX_TRAINS = 255, MAX_VEHICLES = 4096;
    function inspect(ride, map) {
        var unavailable = [], issues = [];
        function read(object, key, path) {
            try {
                var value = object == null ? undefined : object[key];
                if (value !== undefined && !(typeof value === 'number' && !Number.isSafeInteger(value))) return value;
            } catch (e) { }
            if (unavailable.indexOf(path) < 0) unavailable.push(path);
            return undefined;
        }
        function integer(object, key, path, min, max) {
            var value = read(object, key, path);
            if (Number.isInteger(value) && value >= min && value <= max) return value;
            if (unavailable.indexOf(path) < 0) unavailable.push(path);
            return null;
        }
        function number(key, min, max) { return integer(ride, key, key, min, max); }
        var flags = number('flags', 0, 4294967295);
        function flag(bit) { return flags === null ? null : (flags & (1 << bit)) !== 0; }
        var depart = number('departFlags', 0, 255);
        function departure(bit) { return depart === null ? null : (depart & (1 << bit)) !== 0; }
        var ratings = ['excitement', 'intensity', 'nausea'].map(function (key) { return number(key, -32768, 32767); });
        var object = read(ride, 'object', 'object');
        var zeroCars = integer(object, 'zeroCars', 'object.zeroCars', 0, 255);
        var heads = read(ride, 'vehicles', 'vehicles');
        var validHeads = Array.isArray(heads) && heads.length <= MAX_TRAINS;
        if (!validHeads) { issues.push('Train head list unavailable or exceeds inspection limit'); heads = []; }
        var seen = Object.create(null), visited = 0, spawned = 0;
        var trains = heads.map(function (head, index) {
            var train = {index:index, headVehicleId:head === 65535 ? null : head,
                spawned:false, complete:false, vehicleCount:null, carsPerTrain:null,
                seatCapacity:null, assignedSeats:null, status:null, velocity:null,
                trackLocation:null, cars:[], issues:[]};
            if (head === null || head === 65535) return train;
            var id = head, seats = 0, occupied = 0, seatsKnown = true, occupiedKnown = true;
            while (id !== null) {
                if (!Number.isInteger(id) || id < 0 || id >= 65535) { train.issues.push('Invalid vehicle link'); break; }
                if (seen[id]) { train.issues.push('Repeated vehicle link (cycle or shared train)'); break; }
                if (visited >= MAX_VEHICLES) { train.issues.push('Vehicle inspection limit reached'); break; }
                seen[id] = true; visited++;
                var car;
                try { car = map.getEntity(id); } catch (e) { }
                if (!car || read(car, 'id', 'vehicle.id') !== id || read(car, 'type', 'vehicle.type') !== 'car' || read(car, 'ride', 'vehicle.ride') !== ride.id) {
                    train.issues.push('Missing vehicle or vehicle belongs to another ride'); break;
                }
                if (!train.spawned) {
                    train.spawned = true; spawned++;
                    var status = read(car, 'status', 'vehicle.status');
                    train.status = typeof status === 'string' ? status : null;
                    train.velocity = integer(car, 'velocity', 'vehicle.velocity', -2147483648, 2147483647);
                    var location = read(car, 'trackLocation', 'vehicle.trackLocation');
                    if (location) {
                        train.trackLocation = {};
                        ['x','y','z','direction','trackType'].forEach(function (key) {
                            train.trackLocation[key] = integer(location, key, 'vehicle.trackLocation.'+key, -2147483648, 2147483647);
                        });
                    }
                }
                // ScVehicle.numSeats already removes the native high-bit flag.
                var capacity = integer(car, 'numSeats', 'vehicle.numSeats', 0, 127);
                // Guest slots are assignments, including boarding/stale slots;
                // they are not the native num_peeps/ride.guestCount counter.
                var guests = read(car, 'guests', 'vehicle.guests'), count = null;
                if (Array.isArray(guests) && guests.every(function (g) { return g === null || (Number.isInteger(g) && g >= 0 && g < 65535); })) {
                    count = guests.filter(function (g) { return g !== null; }).length;
                } else if (unavailable.indexOf('vehicle.guests') < 0) unavailable.push('vehicle.guests');
                if (capacity === null) seatsKnown = false; else seats += capacity;
                if (count === null) occupiedKnown = false; else occupied += count;
                train.cars.push({id:id, seats:capacity, assignedSeats:count});
                var next = read(car, 'nextCarOnTrain', 'vehicle.nextCarOnTrain');
                if (next === undefined) { train.issues.push('Next vehicle link unavailable'); break; }
                id = next;
                if (id === null) train.complete = true;
            }
            if (train.complete) {
                train.vehicleCount = train.cars.length;
                // This is the vehicle-tab count, excluding the object's dummy cars.
                if (zeroCars !== null && train.vehicleCount >= zeroCars) train.carsPerTrain = train.vehicleCount - zeroCars;
                train.seatCapacity = seatsKnown ? seats : null;
                train.assignedSeats = occupiedKnown ? occupied : null;
            }
            return train;
        });
        var complete = validHeads && flag(0) === true && trains.length > 0 && trains.every(function (t) { return t.complete; });
        function uniform(key) {
            if (!complete || trains[0][key] === null) return null;
            return trains.every(function (t) { return t[key] === trains[0][key]; }) ? trains[0][key] : null;
        }
        function total(key) {
            return complete && trains.every(function (t) { return t[key] !== null; }) ? trains.reduce(function (sum, t) { return sum + t[key]; }, 0) : null;
        }
        var breakdown = read(ride, 'breakdown', 'breakdown');
        var isEmpty = read(ride, 'isEmpty', 'isEmpty');
        return {
            source:'OpenRCT2 scripting API 124',
            testing:{flags:flags, onTrack:flag(0), tested:flag(1), testInProgress:flag(2),
                noRawStats:flag(3), ratingsAvailable:ratings.some(function (r) { return r === null; }) ? null : ratings.every(function (r) { return r >= 0; }),
                fixedRatings:flag(20), crashed:flag(10), stalledVehicle:flag(11)},
            operation:{departFlags:depart, minimumWaitingTime:number('minimumWaitingTime',0,255), maximumWaitingTime:number('maximumWaitingTime',0,255),
                waitForMinimumTime:departure(6), waitForMaximumTime:departure(7), waitForLoad:departure(3),
                load:depart === null ? null : (['quarter','half','three_quarters','full','any'][depart & 7] || null),
                leaveWhenAnotherArrives:departure(4), synchroniseWithAdjacentStations:departure(5),
                liftHillSpeed:number('liftHillSpeed',0,255), musicEnabled:flag(13), musicObject:number('music',0,65535)},
            maintenance:{breakdown:typeof breakdown === 'string' && breakdown.length ? breakdown : null,
                breakdownPending:flag(6), brokenDown:flag(7), dueInspection:flag(8),
                inspectionInterval:number('inspectionInterval',0,255), isEmpty:typeof isEmpty === 'boolean' ? isEmpty : null},
            fleet:{configuredTrains:validHeads ? heads.length : null, spawnedTrains:validHeads ? spawned : null,
                complete:complete, vehiclesPerTrain:uniform('vehicleCount'), carsPerTrain:uniform('carsPerTrain'),
                totalSeats:total('seatCapacity'), assignedSeats:total('assignedSeats'), trains:trains,
                objectCarLimits:{minCarsInTrain:integer(object,'minCarsInTrain','object.minCarsInTrain',0,255),
                    maxCarsInTrain:integer(object,'maxCarsInTrain','object.maxCarsInTrain',0,255), zeroCars:zeroCars},
                rideLimits:{maxTrains:null,maxCarsPerTrain:null}, issues:issues},
            unavailable:unavailable,
            limitations:[
                'API 124 does not expose ride-specific maximum trains/cars or configured cars while vehicles are absent. Object limits are not ride limits.',
                'Fleet capacity is verified only for a complete on-track fleet; carsPerTrain excludes object zeroCars. Null is unknown, not zero.',
                'tested is the native flag, not proof that every train completed a circuit. Ratings and raw test statistics are separate; observe a full-fleet test.'
            ]
        };
    }
    return {inspect:inspect};
})();
if (typeof module !== 'undefined') module.exports = BridgeRideInspector;
