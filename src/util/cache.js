const lruTtl = (size, ttl) => {
    const memory = new Map();
    return {
        get: (k) => {
            const e = memory.get(k);
            if (!e) {
                return null;
            }
            memory.delete(k);
            const {v, exp} = e;
            if (exp < Date.now()) {
                return null;
            } else {
                memory.set(k, e);
                return v;
            }
        },
        set: (k, v) => {
            if (memory.size >= size) {
                memory.delete(memory.keys().next().value);
            }
            const exp = Date.now() + ttl;
            const e = {v, exp};
            memory.set(k, e);
        },
        clear: () => memory.clear(),
    };
};

export default {
    lruTtl,
};
