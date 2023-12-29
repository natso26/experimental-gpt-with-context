const orNull = (v) => {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
};

const round = (v, prec) => {
    return parseFloat(v.toFixed(prec));
};

const sum = (arr) => arr.reduce((acc, v) => acc + (v || 0), 0);

export default {
    orNull,
    round,
    sum,
};
