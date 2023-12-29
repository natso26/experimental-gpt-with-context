const int = (s) => {
    const v = parseInt(s);
    if (Number.isNaN(v)) {
        throw new Error(`invalid integer: ${s}`);
    }
    return v;
};

const float = (s) => {
    const v = parseFloat(s);
    if (Number.isNaN(v)) {
        throw new Error(`invalid float: ${s}`);
    }
    return v;
};

const json = (s) => {
    try {
        return JSON.parse(s);
    } catch (_) {
        throw new Error(`invalid json: ${s}`);
    }
};

const eval_ = (s) => {
    try {
        if (!s) throw new Error('');
        return eval(s);
    } catch (_) {
        throw new Error(`invalid eval: ${s}`);
    }
};

export default {
    int,
    float,
    json,
    eval: eval_,
};
