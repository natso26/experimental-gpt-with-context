const isNonEmptyString = (v) => typeof v === 'string' && v;

const isInteger = (v) => typeof v === 'number' && v % 1 === 0;

export default {
    isNonEmptyString,
    isInteger,
};
