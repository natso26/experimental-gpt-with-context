import user_ from '../../repository/db/user.js';
import cache from '../../util/cache.js';
import wrapper from '../../util/wrapper.js';
import time from '../../util/time.js';

const roleCache = cache.lruTtl(100, 15 * time.MINUTE);

const getRole = wrapper.cache(roleCache, (correlationId, userId) => userId,
    wrapper.logCorrelationId('service.support.user.getRole', async (correlationId, userId) => {
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
