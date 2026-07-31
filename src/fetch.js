const axios = require('axios');
const { groupStationsById, mergeDetailWithList, normalizeGroupedStations } = require('./normalize');
const { retry } = require('./retry');

const DEFAULT_LIST_URL =
  'https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PesquisarPostos?qtdPorPagina=999999&pagina=1&orderDesc=0';
const DEFAULT_DETAIL_URL = 'https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/GetDadosPostoMapa';
const DEFAULT_DETAIL_CONCURRENCY = 4;
const DEFAULT_TIMEOUT = 15000;
const DEFAULT_RETRIES = 3;

function resolveLogger(loggerOption) {
  return loggerOption && typeof loggerOption.info === 'function' ? loggerOption : console;
}

function resolveHttpClient(httpClientOption) {
  return httpClientOption && typeof httpClientOption.get === 'function' ? httpClientOption : axios;
}

function resolveUrl(urlOption, fallback) {
  const value = typeof urlOption === 'function' ? urlOption() : urlOption;
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function resolveConcurrency(concurrencyOption) {
  const value = typeof concurrencyOption === 'function' ? concurrencyOption() : concurrencyOption;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DETAIL_CONCURRENCY;
}

function resolveCountry(countryOption) {
  const value = typeof countryOption === 'function' ? countryOption() : countryOption;
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : 'PT';
}

function buildDetailRequestUrl(baseUrl, stationId) {
  const separator = baseUrl.includes('?') ? '&' : '?';
  const hasTrailingSeparator = baseUrl.endsWith('?') || baseUrl.endsWith('&');
  const effectiveSeparator = hasTrailingSeparator ? '' : separator;

  return `${baseUrl}${effectiveSeparator}id=${encodeURIComponent(stationId)}&f=json`;
}

async function fetchStationList(httpClient, logger, listUrl, timeout) {
  logger.info('Requesting DGEG station list', { url: listUrl });
  const response = await httpClient.get(listUrl, { timeout });

  if (!response.data?.status || !Array.isArray(response.data.resultado)) {
    throw new Error('Unexpected DGEG list response payload');
  }

  logger.info('Received DGEG station list', {
    url: listUrl,
    status: response.status,
    stationCount: response.data.resultado.length,
  });

  return response.data.resultado;
}

async function fetchStationDetail(httpClient, detailUrl, stationId, timeout) {
  const url = buildDetailRequestUrl(detailUrl, stationId);

  const response = await httpClient.get(url, { timeout });

  if (
    !response.data?.status ||
    typeof response.data.resultado !== 'object' ||
    Array.isArray(response.data.resultado)
  ) {
    throw new Error('Unexpected DGEG detail response payload');
  }

  return response.data.resultado;
}

function enrichStationsWithDetails(
  httpClient,
  logger,
  groupedStations,
  detailUrl,
  detailConcurrency,
  timeout,
  retries,
  reportProgress,
) {
  const total = groupedStations.length;
  const results = new Array(total);

  let inFlight = 0;
  let currentIndex = 0;
  let completed = 0;

  return new Promise((resolve) => {
    const next = () => {
      while (inFlight < detailConcurrency && currentIndex < total) {
        const index = currentIndex++;
        const group = groupedStations[index];
        const stationId = group.detail?.Id ?? group.rawStation?.Id;

        if (!stationId) {
          logger.warn('Skipping detail fetch due to missing station id');
          results[index] = group;
          completed += 1;
          const progress = 20 + Math.round((completed / total) * 60);
          reportProgress(Math.min(progress, 90), {
            stage: 'fetching_details',
            processed: completed,
            total,
          });
          continue;
        }

        inFlight += 1;

        retry(() => fetchStationDetail(httpClient, detailUrl, stationId, timeout), {
          retries,
          minTimeoutMs: 1000,
          logger,
        })
          .then((detailFromApi) => {
            results[index] = {
              rawStation: group.rawStation,
              detail: mergeDetailWithList(detailFromApi, group.detail),
            };
          })
          .catch((error) => {
            logger.warn('Failed to fetch DGEG station detail', {
              stationId,
              message: error.message,
            });
            results[index] = group;
          })
          .finally(() => {
            inFlight -= 1;
            completed += 1;
            const progress = 20 + Math.round((completed / total) * 60);
            reportProgress(Math.min(progress, 90), {
              stage: 'fetching_details',
              processed: completed,
              total,
            });
            if (completed === total) {
              resolve(results);
            } else {
              next();
            }
          });
      }
    };

    next();
  });
}

async function fetchStations(options = {}, hooks = {}) {
  const logger = resolveLogger(options.logger);
  const httpClient = resolveHttpClient(options.httpClient);
  const listUrl = resolveUrl(options.listUrl, DEFAULT_LIST_URL);
  const detailUrl = resolveUrl(options.detailUrl, DEFAULT_DETAIL_URL);
  const detailConcurrency = resolveConcurrency(options.detailConcurrency);
  const country = resolveCountry(options.country);
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const reportProgress =
    typeof hooks.reportProgress === 'function' ? hooks.reportProgress : () => {};

  reportProgress(5, { stage: 'requesting_dataset' });
  const rawStations = await retry(
    () => fetchStationList(httpClient, logger, listUrl, timeout),
    { retries, minTimeoutMs: 1000, logger },
  );

  reportProgress(20, { stage: 'fetched_list', stationCount: rawStations.length });
  logger.info(`Fetched ${rawStations.length} stations from DGEG list`);

  const groupedStations = groupStationsById(rawStations);
  logger.info('Grouped DGEG stations', {
    totalEntries: rawStations.length,
    uniqueStations: groupedStations.length,
  });

  const enrichedStations = await enrichStationsWithDetails(
    httpClient,
    logger,
    groupedStations,
    detailUrl,
    detailConcurrency,
    timeout,
    retries,
    reportProgress,
  );

  const normalized = normalizeGroupedStations(enrichedStations, country, logger, reportProgress);
  reportProgress(100, { stage: 'completed', stationCount: normalized.length });

  return normalized;
}

module.exports = {
  fetchStations,
  fetchStationList,
  fetchStationDetail,
  enrichStationsWithDetails,
  buildDetailRequestUrl,
  DEFAULT_LIST_URL,
  DEFAULT_DETAIL_URL,
  DEFAULT_DETAIL_CONCURRENCY,
};
