import imagination from '../service/imagination.js';
import wrapper from '../util/wrapper.js';

const imagine = wrapper.logCorrelationId('handler.imagine.imagine', async (correlationId, _) => {
    return await imagination.imagine(correlationId);
});

export default {imagine};
