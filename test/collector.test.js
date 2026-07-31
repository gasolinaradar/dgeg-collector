const { test } = require('node:test');
const assert = require('node:assert');
const { createDgegCollector, fetchStations } = require('../src');
const {
  normalizePrices,
  normalizeSchedule,
  parseLastUpdated,
  parsePointFromSig,
  groupStationsById,
} = require('../src/normalize');

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {} };

const SAMPLE_LIST_PAYLOAD = {
  status: true,
  resultado: [
    {
      Id: 1000,
      Nome: 'Posto A',
      Morada: 'Rua das Flores 1',
      CodPostal: '1000-001',
      Localidade: 'Lisboa',
      Distrito: 'Lisboa',
      Latitude: '38,7222524',
      Longitude: '-9,1393366',
      DataAtualizacao: '2026-01-01 12:00',
      Combustivel: 'Gasolina 95',
      Preco: '1,759',
    },
    {
      Id: 1000,
      Nome: 'Posto A',
      Morada: 'Rua das Flores 1',
      CodPostal: '1000-001',
      Localidade: 'Lisboa',
      Distrito: 'Lisboa',
      Latitude: '38,7222524',
      Longitude: '-9,1393366',
      Combustivel: 'Gasóleo',
      Preco: '1,489',
    },
    {
      Id: 1001,
      Nome: 'Posto B',
      Morada: 'Av. Central 10',
      CodPostal: '4000-000',
      Localidade: 'Porto',
      Distrito: 'Porto',
      SIG: 'POINT (-8.609170 41.149610)',
      Combustivel: 'Gasolina 98',
      Preco: '1,859',
    },
  ],
};

const SAMPLE_DETAIL_PAYLOAD = {
  status: true,
  resultado: {
    Id: 1000,
    Nome: 'Posto A',
    Latitude: '38,7222524',
    Longitude: '-9,1393366',
    Morada: {
      Morada: 'Rua das Flores 1',
      CodPostal: '1000-001',
      Localidade: 'Lisboa',
      Distrito: 'Lisboa',
    },
    HorarioPosto: {
      DiasUteis: '06:00-24:00',
      Sabado: '07:00-24:00',
      Domingo: '08:00-22:00',
    },
    Servicos: [{ Descritivo: 'WC' }],
    MeiosPagamento: [{ Descritivo: 'Cartão' }],
    OutrosServicos: 'Loja 24H',
    DataAtualizacao: '01-01-2026 12:00',
    Combustiveis: [
      { TipoCombustivel: 'Gasolina 95', Preco: '1,759' },
      { TipoCombustivel: 'Gasóleo', Preco: '1,489' },
    ],
  },
};

function createFakeClient(listPayload, details = []) {
  return {
    get: async (url) => {
      if (url.includes('PesquisarPostos')) {
        return { status: 200, data: listPayload };
      }
      const query = url.split('?')[1] ?? '';
      const id = query
        .split('&')
        .find((param) => param.startsWith('id='))
        ?.split('=')[1];
      const detail = details.find((item) => String(item.Id) === String(id));
      return {
        status: 200,
        data: detail ? { status: true, resultado: detail } : { status: true, resultado: {} },
      };
    },
  };
}

test('fetchStations returns normalized stations merging list and detail data', async () => {
  const stations = await fetchStations({
    httpClient: createFakeClient(SAMPLE_LIST_PAYLOAD, [SAMPLE_DETAIL_PAYLOAD.resultado]),
    logger: silentLogger,
  });

  assert.equal(stations.length, 2);

  const [a, b] = stations;
  assert.equal(a.source, 'dgeg');
  assert.equal(a.country, 'PT');
  assert.equal(a.sourceStationId, '1000');
  assert.equal(a.name, 'Posto A');
  assert.equal(a.address, 'Rua das Flores 1, 1000-001');
  assert.equal(a.municipality, 'Lisboa');
  assert.equal(a.province, 'Lisboa');
  assert.equal(a.postalCode, '1000-001');
  assert.equal(a.schedule, 'L-V: 06:00-24:00 | Sábado: 07:00-24:00 | Domingo: 08:00-22:00');
  assert.deepEqual(a.services, ['WC', 'Cartão', 'Loja 24H']);
  assert.deepEqual(a.location, { type: 'Point', coordinates: [-9.1393366, 38.7222524] });
  assert.deepEqual(a.prices, { gasolina95: 1.759, gasleo: 1.489 });
  assert.ok(a.lastUpdated instanceof Date);

  assert.equal(b.sourceStationId, '1001');
  assert.equal(b.address, 'Av. Central 10, 4000-000');
  assert.deepEqual(b.location, { type: 'Point', coordinates: [-8.60917, 41.14961] });
  assert.deepEqual(b.prices, { gasolina98: 1.859 });
});

test('createDgegCollector exposes the collector contract', async () => {
  const collector = createDgegCollector({
    httpClient: createFakeClient(SAMPLE_LIST_PAYLOAD, [SAMPLE_DETAIL_PAYLOAD.resultado]),
    logger: silentLogger,
  });

  assert.equal(collector.name, 'dgeg');
  assert.equal(collector.country, 'PT');
  assert.equal(typeof collector.fetch, 'function');

  const stations = await collector.fetch({});
  assert.equal(stations.length, 2);
});

test('reports progress through the context hook', async () => {
  const collector = createDgegCollector({
    httpClient: createFakeClient(SAMPLE_LIST_PAYLOAD, [SAMPLE_DETAIL_PAYLOAD.resultado]),
    logger: silentLogger,
  });
  const steps = [];

  const stations = await collector.fetch({
    reportProgress(percent, metadata = {}) {
      steps.push({ percent, metadata });
    },
  });

  assert.equal(stations.length, 2);
  assert.equal(steps[0].percent, 5);
  assert.equal(steps[0].metadata.stage, 'requesting_dataset');
  assert.ok(steps.some((step) => step.percent === 20 && step.metadata.stage === 'fetched_list'));
  assert.ok(steps.some((step) => step.metadata.stage === 'fetching_details'));
  assert.ok(steps.some((step) => step.metadata.stage === 'normalizing_stations'));
  assert.equal(steps[steps.length - 1].percent, 100);
  assert.equal(steps[steps.length - 1].metadata.stage, 'completed');
});

test('throws on unexpected list payload', async () => {
  await assert.rejects(
    () => fetchStations({ httpClient: createFakeClient({ foo: 1 }, []), retries: 0, logger: silentLogger }),
    /Unexpected DGEG list response payload/,
  );
});

test('skips stations without coordinates', async () => {
  const list = {
    status: true,
    resultado: [{ Id: 900, Nome: 'Sin coords', Combustivel: 'Gasolina 95', Preco: '1,500' }],
  };

  const stations = await fetchStations({
    httpClient: createFakeClient(list, []),
    logger: silentLogger,
  });

  assert.deepEqual(stations, []);
});

test('falls back to list data when detail fetch fails', async () => {
  const failingClient = {
    get: async (url) => {
      if (url.includes('PesquisarPostos')) {
        return { status: 200, data: SAMPLE_LIST_PAYLOAD };
      }
      throw new Error('network down');
    },
  };

  const stations = await fetchStations({
    httpClient: failingClient,
    retries: 0,
    logger: silentLogger,
  });

  assert.equal(stations.length, 2);
  assert.deepEqual(stations[0].prices, { gasolina95: 1.759, gasleo: 1.489 });
  assert.deepEqual(stations[0].location, { type: 'Point', coordinates: [-9.1393366, 38.7222524] });
});

test('limits detail fetch concurrency', async () => {
  const list = {
    status: true,
    resultado: Array.from({ length: 8 }, (_, i) => ({
      Id: i + 1,
      Nome: `P${i + 1}`,
      Latitude: '38,7',
      Longitude: '-9,1',
      Combustivel: 'Gasolina 95',
      Preco: '1,500',
    })),
  };

  let active = 0;
  let maxActive = 0;
  const client = {
    get: async (url) => {
      if (url.includes('PesquisarPostos')) {
        return { status: 200, data: list };
      }
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return { status: 200, data: { status: true, resultado: {} } };
    },
  };

  const stations = await fetchStations({
    httpClient: client,
    detailConcurrency: 2,
    logger: silentLogger,
  });

  assert.equal(stations.length, 8);
  assert.ok(maxActive <= 2);
});

test('groupStationsById merges fuel rows of the same station', () => {
  const grouped = groupStationsById(SAMPLE_LIST_PAYLOAD.resultado);

  assert.equal(grouped.length, 2);

  const [a, b] = grouped;
  assert.equal(a.rawStation.Id, 1000);
  assert.deepEqual(a.detail.Combustiveis, [
    { TipoCombustivel: 'Gasolina 95', Preco: '1,759' },
    { TipoCombustivel: 'Gasóleo', Preco: '1,489' },
  ]);
  assert.equal(b.rawStation.Id, 1001);
});

test('normalizePrices parses Portuguese decimal commas', () => {
  assert.deepEqual(
    normalizePrices([
      { TipoCombustivel: 'Gasolina 95', Preco: '1,759' },
      { TipoCombustivel: 'Gasóleo', Preco: '1,489' },
      { TipoCombustivel: 'Sem preço', Preco: undefined },
    ]),
    { gasolina95: 1.759, gasleo: 1.489 },
  );
});

test('normalizeSchedule formats opening hours', () => {
  assert.equal(
    normalizeSchedule({
      DiasUteis: '06:00-24:00',
      Sabado: '',
      Domingo: '08:00-22:00',
      Feriado: '09:00-20:00',
    }),
    'L-V: 06:00-24:00 | Domingo: 08:00-22:00 | Festivos: 09:00-20:00',
  );
});

test('parseLastUpdated handles ISO and PT date formats', () => {
  assert.equal(
    parseLastUpdated('2026-01-01 12:00').getTime(),
    new Date(2026, 0, 1, 12, 0).getTime(),
  );
  assert.equal(
    parseLastUpdated('01-01-2026 12:00').getTime(),
    new Date(2026, 0, 1, 12, 0).getTime(),
  );
  assert.ok(parseLastUpdated(undefined) instanceof Date);
});

test('parsePointFromSig parses WKT points', () => {
  assert.deepEqual(parsePointFromSig('POINT (-8.609170 41.149610)', silentLogger), [
    -8.60917,
    41.14961,
  ]);
  assert.equal(parsePointFromSig('no es un punto', silentLogger), null);
});
