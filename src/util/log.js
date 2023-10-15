const log = (message, extra = {}) => {
    const entry = {
        timestamp: new Date().toISOString(),
        message,
        ...extra,
    };
    console.log(JSON.stringify(entry, null, 2));
};

export default {log};
