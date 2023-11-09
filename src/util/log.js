const indent = process.env.LOG_INDENT ? parseInt(process.env.LOG_INDENT) : null;

const log = (message, extra = {}) => {
    if ('time' in extra || 'message' in extra) {
        log('log: extra contains reserved keys which overwrite other information');
    }
    const entry = {
        time: new Date().toISOString(),
        message,
        ...extra,
    };
    console.log(JSON.stringify(entry, null, indent));
};

export default {log};
