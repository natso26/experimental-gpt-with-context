import imagination from '../service/imagination.js';
import wrapper from '../util/wrapper.js';

const internalImagine = wrapper.logCorrelationId('handler.imagine.internalImagine', async (correlationId, _) => {
    return await imagination.imagine(correlationId);
});

export default {
    internalImagine,
};
