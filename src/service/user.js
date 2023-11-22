import user_ from '../repository/user.js';
import cache from '../util/cache.js';
import wrapper from '../util/wrapper.js';

const roleCache = cache.lruTtl(100, 30 * 60 * 1000);

const getRole = wrapper.cache(roleCache, (correlationId, userId) => userId, wrapper.logCorrelationId('service.user.getRole', async (correlationId, userId) => {
    const role = await user_.getRole(correlationId, userId);
    if (role === user_.ROLES.user) {
        return {
            isDev: false,
        };
    } else if (role === user_.ROLES.dev) {
        return {
            isDev: true,
        };
    } else {
        throw new Error(`user: user ${userId} not found`);
    }
}));

export default {
    getRole,
};
