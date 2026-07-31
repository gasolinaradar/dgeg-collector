const { fetchStations } = require('./fetch');

function createDgegCollector(options = {}) {
  const country =
    typeof options.country === 'string' && options.country.trim()
      ? options.country.trim().toUpperCase()
      : 'PT';

  return {
    name: 'dgeg',
    country,
    async fetch(context = {}) {
      const reportProgress =
        typeof context?.reportProgress === 'function' ? context.reportProgress : () => {};
      return fetchStations(options, { reportProgress });
    },
  };
}

module.exports = {
  createDgegCollector,
};
