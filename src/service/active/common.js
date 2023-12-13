import ipaddr from '../../repository/web/ipaddr.js';
import log from '../../util/log.js';

const ipGeolocate = (correlationId, options, logMsgPrefix) => ipaddr.geolocate(correlationId, options.ip).then(
    ({district, city, regionName, country, lat, lon, offset}) => {
        const o = {district, city, regionName, country, lat, lon, offset};
        log.log(`${logMsgPrefix}: ip geolocation`, {correlationId, ip: options.ip, ...o});
        return o;
    }).catch((_) => ({}));

const promptOptions = (correlationId, options, ipGeolocateTask, warnings, logMsgPrefix) => ipGeolocateTask.then(
    ({district, city, regionName, country, offset}) => {
        const timezoneOffset_ = options.timezoneOffset;
        const ipTimezoneOffset = !offset ? null : -Math.round(offset / 60);
        const timezoneOffset = timezoneOffset_ !== 'auto' ? timezoneOffset_ : ipTimezoneOffset;
        if (typeof timezoneOffset_ === 'number' && typeof ipTimezoneOffset === 'number' && timezoneOffset_ !== ipTimezoneOffset) {
            warnings(`${logMsgPrefix}: timezone offset mismatch: ${timezoneOffset_} != ${ipTimezoneOffset}`,
                {correlationId, options, ipTimezoneOffset});
        }
        const location = [district, city, regionName, country].filter((v) => v)
            .filter((v, i, a) => !i || a[i - 1] !== v).join(', ');
        const o = {timezoneOffset, location};
        log.log(`${logMsgPrefix}: prompt options`, {correlationId, ...o});
        return o;
    });

export default {
    ipGeolocate,
    promptOptions,
};
