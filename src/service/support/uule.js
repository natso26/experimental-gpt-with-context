import * as uuid from 'uuid';
import serp from '../../repository/web/serp.js';
import cache from '../../util/cache.js';
import number from '../../util/number.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';
import time from '../../util/time.js';

const canonicalNameCache = cache.lruTtl(100, 30 * time.MINUTE);
let locationGrid = {};

const init = async () => {
    await serp.getLocations(uuid.v4(), getLocationsCallback).catch((_) => '');
};

const getCanonicalName = (() => {
    const f = wrapper.cache(canonicalNameCache, (correlationId, lat, lon, warnings) => `${lat},${lon}`,
        wrapper.logCorrelationId('service.support.uule.getCanonicalName', async (correlationId, lat, lon, warnings) => {
            await serp.getLocations(correlationId, getLocationsCallback);
            const loc = findBestLocation(correlationId, lat, lon, scoreFn);
            if (!loc) {
                warnings(`getCanonicalName: no close location found for ${lat},${lon}`,
                    {correlationId, lat, lon});
                return '';
            } else {
                log.log(`getCanonicalName: ${JSON.stringify(loc)} chosen for ${lat},${lon}`,
                    {correlationId, lat, lon, loc});
                return loc.canonicalName;
            }
        }));
    return (correlationId, lat, lon, warnings) =>
        f(correlationId, number.round(lat, 5), number.round(lon, 5), warnings);
})();

// cover 1 degree diameter by 9 cells of half-degree grid
const getLocationsCallback = wrapper.logCorrelationId('service.support.uule.getLocationsCallback', async (correlationId, locations) => {
    const grid = {};
    for (const loc_ of locations) {
        const loc = {...loc_, lat: number.round(loc_.lat, 5), lon: number.round(loc_.lon, 5)};
        const k = gridKey(loc.lat, loc.lon);
        grid[k] ||= [];
        grid[k].push(loc);
    }
    locationGrid = grid;
    canonicalNameCache.clear();
});

const findBestLocation = (correlationId, lat, lon, scoreFn) => {
    let best = null;
    let bestScore = 0;
    for (const dx of [.5, 0, -.5]) {
        for (const dy of [.5, 0, -.5]) {
            const k = gridKey(lat + dx, lon + dy);
            const locations = locationGrid[k] || [];
            for (const loc of locations) {
                const dSq = distSq(lat, lon, loc.lat, loc.lon);
                const score = scoreFn(dSq, loc.reach);
                log.log(`getCanonicalName: find best location: ${JSON.stringify(loc)} scored ${score} for ${lat},${lon}`,
                    {lat, lon, loc, score});
                if (score > bestScore) {
                    best = loc;
                    bestScore = score;
                }
            }
        }
    }
    return best;
};

const gridKey = (lat, lon) => `${Math.floor(2 * lat) / 2},${Math.floor(2 * lon) / 2}`;
const distSq = (x0, y0, x1, y1) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    return dx * dx + dy * dy;
};
const scoreFn = (dSq, reach) => dSq > .5 ? 0 : (reach + 1) / (dSq || 1e-10);

export default {
    init,
    getCanonicalName,
};
