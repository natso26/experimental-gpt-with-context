import cloudrun from '@google-cloud/run';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';

const CLOUD_RUN_SERVICES_CLIENT_CALL_OPTIONS = {
    timeout: strictParse.int(process.env.CLOUD_RUN_SERVICES_CLIENT_TIMEOUT_SECS) * 1000,
    maxRetries: strictParse.int(process.env.CLOUD_RUN_SERVICES_CLIENT_RETRY_COUNT),
};
const ENV_INFO = (() => {
    const {ENV, GCP_PROJECT, GCP_REGION, K_SERVICE, K_REVISION, BASE_URL, NIGHTLY_BASE_URL} = process.env;
    switch (ENV) {
        case 'local':
            if (!BASE_URL) {
                throw new Error(`local env not properly set: ${BASE_URL}`);
            }
            return {
                env: 'local',
                baseUrl: BASE_URL,
            };
        case 'dev':
            if (!GCP_PROJECT || !GCP_REGION || !K_SERVICE || !K_REVISION || !BASE_URL || !NIGHTLY_BASE_URL) {
                throw new Error(`dev env not properly set: ${GCP_PROJECT}, ${GCP_REGION},${K_SERVICE}, ${K_REVISION}, ${BASE_URL}, ${NIGHTLY_BASE_URL}`);
            }
            const name = `projects/${GCP_PROJECT}/locations/${GCP_REGION}/services/${K_SERVICE}`;
            const revision = strictParse.int(K_REVISION.split('-').at(-2));
            return {
                env: 'dev',
                baseUrl: BASE_URL,
                nightlyBaseUrl: NIGHTLY_BASE_URL,
                name,
                revision,
            };
        default:
            throw new Error(`ENV not properly set: ${ENV}`);
    }
})();

const runClient = new cloudrun.ServicesClient();

// deploy stable and nightly by fixing stable and tagging nightly,
// but calling internal apis require knowing which we currently are
const getBaseUrl = async (correlationId) => {
    const {env, baseUrl, nightlyBaseUrl, name, revision} = ENV_INFO;
    switch (env) {
        case 'local':
            return baseUrl;
        case 'dev':
            try {
                const [service] = await runClient.getService({name}, CLOUD_RUN_SERVICES_CLIENT_CALL_OPTIONS);
                log.log('getBaseUrl: service', {correlationId, service});
                const r = service.traffic.filter((t) => t.revision);
                if (r.length !== 1) {
                    return baseUrl;
                }
                const stableRevision = strictParse.int(r[0].revision.split('-').at(-2));
                return revision === stableRevision ? baseUrl : nightlyBaseUrl;
            } catch (e) {
                log.log('getBaseUrl: error',
                    {correlationId, error: e.message || '', stack: e.stack || ''});
                throw e;
            }
    }
};

export default {
    getBaseUrl,
};
