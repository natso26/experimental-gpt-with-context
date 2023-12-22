const cleanQuery = (s) => s.replaceAll(/["“”]/g, '').trim();

export default {
    cleanQuery,
};
