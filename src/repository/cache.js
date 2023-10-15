const cache = [];

const add = async (item) => {
    cache.push(item);
};

const search = async (maximizingObjective, limit) => {
    return cache.map((item, i) => [item, maximizingObjective(item, i, cache.length)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);
};

export default {add, search};
