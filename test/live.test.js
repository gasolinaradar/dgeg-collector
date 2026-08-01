const { test, before } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const {
  fetchStationList,
  fetchStationDetail,
  enrichStationsWithDetails,
  DEFAULT_LIST_URL,
  DEFAULT_DETAIL_URL,
} = require('../src/fetch');
const { groupStationsById, normalizeGroupedStations } = require('../src/normalize');

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {} };
const TIMEOUT = 30000;
const SAMPLE_SIZE = 10;

const PORTUGAL_LATITUDE_RANGE = [30, 44];
const PORTUGAL_LONGITUDE_RANGE = [-32, -5];

let list;
let grouped;
let stations;

before(async () => {
  list = await fetchStationList(axios, silentLogger, DEFAULT_LIST_URL, TIMEOUT);
  grouped = groupStationsById(list);
  const enriched = await enrichStationsWithDetails(
    axios,
    silentLogger,
    grouped.slice(0, SAMPLE_SIZE),
    DEFAULT_DETAIL_URL,
    4,
    TIMEOUT,
    2,
    () => {},
  );
  stations = normalizeGroupedStations(enriched, 'PT', silentLogger, () => {});
});

test('real DGEG API: list, detail enrichment and normalization flow', () => {
  assert.ok(list.length > 0, `expected list entries, got ${list.length}`);
  assert.ok(grouped.length > 0, `expected unique stations, got ${grouped.length}`);
  assert.ok(grouped.length < list.length, 'grouping should merge fuel rows per station');
  assert.ok(stations.length > 0, `expected normalized stations, got ${stations.length}`);

  const withDetail = stations.filter((station) => station.schedule || station.services);
  assert.ok(
    withDetail.length > 0,
    'expected at least one station enriched with detail data (schedule/services)',
  );

  const sampleStation = stations[0];
  assert.equal(sampleStation.source, 'dgeg');
  assert.equal(sampleStation.country, 'PT');
  assert.ok(sampleStation.sourceStationId, 'station should have a source id');
  assert.ok(sampleStation.name, 'station should have a name');
  assert.ok(Number.isFinite(sampleStation.location?.coordinates?.[0]));
  assert.ok(Number.isFinite(sampleStation.location?.coordinates?.[1]));
  assert.ok(sampleStation.lastUpdated instanceof Date);
});

test('real DGEG API: normalized stations fall within Portugal and have unique ids', () => {
  assert.ok(stations.length > 0);

  const ids = stations.map((station) => station.sourceStationId);
  assert.equal(new Set(ids).size, ids.length, 'sourceStationId must be unique');

  for (const station of stations) {
    const [lon, lat] = station.location.coordinates;
    assert.ok(
      lat >= PORTUGAL_LATITUDE_RANGE[0] && lat <= PORTUGAL_LATITUDE_RANGE[1],
      `latitude out of Portugal range for ${station.sourceStationId}: ${lat}`,
    );
    assert.ok(
      lon >= PORTUGAL_LONGITUDE_RANGE[0] && lon <= PORTUGAL_LONGITUDE_RANGE[1],
      `longitude out of Portugal range for ${station.sourceStationId}: ${lon}`,
    );
  }
});

test('real DGEG API: list entries carry the expected fuel rows', () => {
  assert.ok(list.length > 0);

  const withFuel = list.filter(
    (entry) =>
      entry.Id &&
      entry.Nome &&
      typeof entry.Combustivel === 'string' &&
      typeof entry.Preco === 'string' &&
      Number.parseFloat(entry.Preco.replace(',', '.')) > 0,
  );

  assert.ok(
    withFuel.length > list.length / 2,
    `expected most entries with fuel+price, got ${withFuel.length}/${list.length}`,
  );
});

test('real DGEG API: prices in the list parse to positive numbers', () => {
  assert.ok(list.length > 0);

  for (const entry of list) {
    const amount = Number.parseFloat(String(entry.Preco ?? '').replace(',', '.'));
    assert.ok(Number.isFinite(amount) && amount > 0, `invalid price for ${entry.Id}: ${entry.Preco}`);
  }
});

test('real DGEG API: detail endpoint responds for a known station', async () => {
  const stationId = list[0]?.Id;
  assert.ok(stationId, 'expected a station id in the list');

  const detail = await fetchStationDetail(axios, DEFAULT_DETAIL_URL, stationId, TIMEOUT);
  assert.ok(detail, 'detail should be an object');
  assert.ok(detail.Nome, 'detail should include the station name');
});
