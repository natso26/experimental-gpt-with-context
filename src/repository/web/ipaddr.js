import common from '../common.js';
import fetch_ from '../../util/fetch.js';
import cache from '../../util/cache.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';

const URL = (ip) => `http://ip-api.com/json/${ip}`;

const geolocate = wrapper.cache(cache.lruTtl(100, 30 * 60 * 1000), (correlationId, ip) => ip,
    wrapper.logCorrelationId('repository.web.ipaddr.geolocate', async (correlationId, ip) => {
        const resp = await wrapper.retry((e, cnt) => cnt < 2, async (...args) => {
            const resp = await fetch_.withTimeout(...args);
            await common.checkRespOk(correlationId, log.log, (resp) => `ip api error, status: ${resp.status}`, resp);
            return resp;
        })(URL(ip), {method: 'GET'}, 30 * 1000);
        const data = await resp.json();
        log.log(`ip api: data for ip ${ip}`, {correlationId, ip, data});
        return data;
    }));

export default {
    geolocate,
};
