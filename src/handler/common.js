const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const isNonEmptyString = (v) => typeof v === 'string' && Boolean(v);

const isInteger = (v) => typeof v === 'number' && v % 1 === 0;

const isUuidV4 = (v) => typeof v === 'string' && UUID_V4_REGEX.test(v);

export default {
    isNonEmptyString,
    isInteger,
    isUuidV4,
};
