const cosineSimilarity = (a, b) => a.map((e, i) => e * b[i]).reduce((x, y) => x + y);

export default {cosineSimilarity};
