const explain = (e) => ({
    error: `${e.name || ''}: ${e.message || ''}`,
    stack: e.stack || '',
});

export default {
    explain,
};
