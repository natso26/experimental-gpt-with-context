const indent = process.env.LOG_INDENT ? parseInt(process.env.LOG_INDENT) : null;

const log = (message, extra = {}) => {
    const entry = {
        timestamp: new Date().toISOString(),
        message,
        ...extra,
    };
    console.log(JSON.stringify(entry, null, indent));
};

export default {log};
