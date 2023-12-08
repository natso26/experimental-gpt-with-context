const int = (s) => {
    const v = parseInt(s);
    if (isNaN(v)) {
        throw new Error(`invalid integer: ${s}`);
    }
    return v;
};

const float = (s) => {
    const v = parseFloat(s);
    if (isNaN(v)) {
        throw new Error(`invalid float: ${s}`);
    }
    return v;
};

const json = (s) => {
    try {
        return JSON.parse(s);
    } catch (e) {
        throw new Error(`invalid json: ${s}`);
    }
};

export default {
    int,
    float,
    json,
};
