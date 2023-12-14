const UUID_V4_REGEXP = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const isNonEmptyString = (v) => typeof v === 'string' && Boolean(v);

const isInteger = (v) => typeof v === 'number' && v % 1 === 0;

const isUuidV4 = (v) => typeof v === 'string' && UUID_V4_REGEXP.test(v);

const isTimezoneOffsetOption = (v) => v === null || v === 'auto' || isInteger(v);

export default {
    isNonEmptyString,
    isInteger,
    isUuidV4,
    isTimezoneOffsetOption,
};
