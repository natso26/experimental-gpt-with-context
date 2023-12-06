const round = (v, prec) => {
    return parseFloat(v.toFixed(prec));
};

const sum = (arr) => arr.reduce((acc, v) => acc + (v || 0), 0);

export default {
    round,
    sum,
};
