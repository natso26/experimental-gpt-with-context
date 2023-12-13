const toISOStringWithOffset = (date, timezoneOffset) => {
    const dt = new Date(date.getTime() - timezoneOffset * 60000).toISOString().slice(0, -1);
    const sign = -timezoneOffset >= 0 ? '+' : '-';
    const mag = Math.abs(timezoneOffset);
    const hh = `${Math.floor(mag / 60)}`.padStart(2, '0');
    const mm = `${mag % 60}`.padStart(2, '0');
    return `${dt}${sign}${hh}:${mm}`;
};

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
    toISOStringWithOffset,
    timer,
};
