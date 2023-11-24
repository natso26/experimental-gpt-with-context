const API_ROUTE_PREFIX = '/api';
const INTERNAL_ROUTE_PREFIX = '/internal';
const INDEX_ROUTE = '/';
const HISTORY_ROUTE = '/history';
const QUERY_API_ROUTE = `${API_ROUTE_PREFIX}/query`;
const HISTORY_API_ROUTE = `${API_ROUTE_PREFIX}/history`;
const PING_INTERNAL_ROUTE = `${INTERNAL_ROUTE_PREFIX}/ping`;
const QUERY_INTERNAL_ROUTE = `${INTERNAL_ROUTE_PREFIX}/query`;
const CONSOLIDATE_INTERNAL_ROUTE = `${INTERNAL_ROUTE_PREFIX}/consolidate`;
const INTROSPECT_INTERNAL_ROUTE = `${INTERNAL_ROUTE_PREFIX}/introspect`;
const IMAGINE_INTERNAL_ROUTE = `${INTERNAL_ROUTE_PREFIX}/imagine`;
const RESEARCH_INTERNAL_ROUTE = `${INTERNAL_ROUTE_PREFIX}/research`;
const CORRELATION_ID_HEADER = 'X-Correlation-ID';
const INTERNAL_API_ACCESS_KEY_HEADER = 'X-Internal-API-Access-Key';
const SECRETS = (() => {
    const {
        INTERNAL_API_ACCESS_KEY,
        OPENAI_API_KEY,
        WOLFRAM_ALPHA_APP_ID,
        SERPAPI_API_KEY,
        ZENROWS_API_KEY,
    } = process.env;
    if (!(INTERNAL_API_ACCESS_KEY
        && OPENAI_API_KEY
        && WOLFRAM_ALPHA_APP_ID
        && SERPAPI_API_KEY
        && ZENROWS_API_KEY)) {
        throw new Error('env secrets not properly set');
    }
    return {
        INTERNAL_API_ACCESS_KEY,
        OPENAI_API_KEY,
        WOLFRAM_ALPHA_APP_ID,
        SERPAPI_API_KEY,
        ZENROWS_API_KEY,
    };
})();

export default {
    API_ROUTE_PREFIX,
    INTERNAL_ROUTE_PREFIX,
    INDEX_ROUTE,
    HISTORY_ROUTE,
    QUERY_API_ROUTE,
    HISTORY_API_ROUTE,
    PING_INTERNAL_ROUTE,
    QUERY_INTERNAL_ROUTE,
    CONSOLIDATE_INTERNAL_ROUTE,
    INTROSPECT_INTERNAL_ROUTE,
    IMAGINE_INTERNAL_ROUTE,
    RESEARCH_INTERNAL_ROUTE,
    CORRELATION_ID_HEADER,
    INTERNAL_API_ACCESS_KEY_HEADER,
    SECRETS,
};
