const timer = () => {
    const start = new Date();
    let last = start;
    return {
        getStart: () => start,
        elapsed: () => {
            last = new Date();
            return (last - start) / 1000;
        },
    };
};

export default {
    timer,
};
