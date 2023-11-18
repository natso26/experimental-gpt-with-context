import strictParse from './strictParse.js';

const INDENT = process.env.LOG_INDENT ? strictParse.int(process.env.LOG_INDENT) : null;

const log = (message, extra = {}) => {
    if ('time' in extra || 'message' in extra) {
        log('log: extra contains reserved keys which overwrite other information');
    }
    const entry = {
        time: new Date().toISOString(),
        message,
        ...extra,
    };
    console.log(JSON.stringify(entry, null, INDENT));
};

export default {
    log,
};
