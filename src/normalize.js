const decimalCommaRegex = /,/g;

function normalizePrice(value) {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'number' ? value.toString() : value.trim();
  if (!raw) return null;
  const normalized = raw.replace(decimalCommaRegex, '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCoordinate(value) {
  if (value === null || value === undefined) {
    throw new Error('Missing coordinate value');
  }

  const raw = typeof value === 'number' ? value.toString() : String(value).trim();
  if (!raw) {
    throw new Error('Empty coordinate value');
  }

  const normalized = raw.replace(decimalCommaRegex, '.');
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid coordinate value: ${value}`);
  }

  return parsed;
}

function slugifyFuelName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '');
}

function parsePrice(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = String(value).replace(/[^0-9,.-]/g, '');
  return normalizePrice(numeric);
}

function normalizePrices(fuels) {
  if (!Array.isArray(fuels)) {
    return {};
  }

  return fuels.reduce((acc, fuel) => {
    const price = parsePrice(fuel?.Preco ?? fuel?.price);
    if (price === null || price === undefined) {
      return acc;
    }

    const fuelName = fuel?.TipoCombustivel ?? fuel?.tipoCombustivel ?? fuel?.Tipo;
    if (!fuelName) {
      return acc;
    }

    const slug = slugifyFuelName(fuelName);
    acc[slug] = price;
    return acc;
  }, {});
}

function normalizeSchedule(rawSchedule) {
  if (!rawSchedule || typeof rawSchedule !== 'object') {
    return undefined;
  }

  const labels = {
    DiasUteis: 'L-V',
    Sabado: 'Sábado',
    Domingo: 'Domingo',
    Feriado: 'Festivos',
  };

  const segments = Object.entries(labels)
    .map(([key, label]) => {
      const value = rawSchedule[key];
      const cleaned = typeof value === 'string' ? value.trim() : '';
      return cleaned ? `${label}: ${cleaned}` : '';
    })
    .filter(Boolean);

  return segments.length > 0 ? segments.join(' | ') : undefined;
}

function normalizeServices(rawServices, payments, otherServices) {
  const services = [];
  const push = (value) => {
    if (typeof value === 'string') {
      const cleaned = value.trim();
      if (cleaned && cleaned !== '-') {
        services.push(cleaned);
      }
    }
  };

  if (Array.isArray(rawServices)) {
    rawServices.forEach((service) => push(service?.Descritivo ?? service?.name));
  }

  if (Array.isArray(payments)) {
    payments.forEach((payment) => push(payment?.Descritivo ?? payment?.name));
  }

  push(otherServices);

  return services.length > 0 ? services : undefined;
}

function parsePointFromSig(sig, logger) {
  if (typeof sig !== 'string' || !sig.trim()) {
    return null;
  }

  const match = sig.match(/POINT\s*\(\s*([-0-9.,]+)\s+([-0-9.,]+)\s*\)/i);
  if (!match) {
    return null;
  }

  try {
    const longitude = normalizeCoordinate(match[1]);
    const latitude = normalizeCoordinate(match[2]);
    return [longitude, latitude];
  } catch (error) {
    logger.warn('Unable to parse SIG coordinates', { sig, error: error.message });
    return null;
  }
}

function extractCoordinates(rawStation = {}, detail = {}, logger) {
  const candidatePairs = [
    {
      lat: detail?.Latitude ?? detail?.Lat ?? detail?.latitude ?? detail?.lat,
      lon: detail?.Longitude ?? detail?.Lon ?? detail?.longitude ?? detail?.lng,
    },
    {
      lat: rawStation?.Latitude ?? rawStation?.Lat ?? rawStation?.latitude ?? rawStation?.lat,
      lon: rawStation?.Longitude ?? rawStation?.Lon ?? rawStation?.longitude ?? rawStation?.lng,
    },
  ];

  for (const pair of candidatePairs) {
    if (pair.lat !== undefined && pair.lon !== undefined) {
      return [normalizeCoordinate(pair.lon), normalizeCoordinate(pair.lat)];
    }
  }

  const sigCandidates = [detail?.SIG, rawStation?.SIG];
  for (const sig of sigCandidates) {
    const parsed = parsePointFromSig(sig, logger);
    if (parsed) {
      return parsed;
    }
  }

  throw new Error('Missing coordinates for station');
}

function parseLastUpdated(value) {
  if (typeof value !== 'string') {
    return new Date();
  }

  const trimmed = value.trim();
  const isoLikeMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (isoLikeMatch) {
    const [, year, month, day, hours = '0', minutes = '0'] = isoLikeMatch;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const match = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (match) {
    const [, day, month, year, hours = '0', minutes = '0'] = match;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const parsedIso = new Date(trimmed);
  return Number.isNaN(parsedIso.getTime()) ? new Date() : parsedIso;
}

function resolveAddress(detailAddress = {}, rawStation = {}) {
  const street = typeof detailAddress.Morada === 'string' ? detailAddress.Morada.trim() : '';
  const postalCode = typeof detailAddress.CodPostal === 'string' ? detailAddress.CodPostal.trim() : '';
  const fallback = typeof rawStation.Morada === 'string' ? rawStation.Morada.trim() : '';

  const addressParts = [street, postalCode].filter(Boolean);
  if (addressParts.length > 0) {
    return addressParts.join(', ');
  }

  return fallback || '';
}

function normalizeStation(rawStation, detail, country, logger) {
  const coordinates = extractCoordinates(rawStation, detail, logger);
  const prices = normalizePrices(detail?.Combustiveis);

  const stationId =
    detail?.Id ?? rawStation?.Id ?? rawStation?.Codigo ?? rawStation?.IdEntidade ?? rawStation?.id;

  return {
    source: 'dgeg',
    country,
    sourceStationId: String(stationId ?? '').trim(),
    name: detail?.Nome?.trim() || rawStation?.Nome?.trim() || 'Desconocido',
    address: resolveAddress(detail?.Morada, rawStation),
    municipality: detail?.Morada?.Localidade?.trim() || rawStation?.MunicipioDescritivo?.trim() || '',
    province: detail?.Morada?.Distrito?.trim() || rawStation?.DistritoDescritivo?.trim() || '',
    postalCode: detail?.Morada?.CodPostal?.trim() || undefined,
    schedule: normalizeSchedule(detail?.HorarioPosto),
    services: normalizeServices(detail?.Servicos, detail?.MeiosPagamento, detail?.OutrosServicos),
    location: {
      type: 'Point',
      coordinates,
    },
    prices,
    lastUpdated: parseLastUpdated(detail?.DataAtualizacao),
  };
}

function buildDetailFromListStation(station, fuels = []) {
  return {
    Id: station?.Id ?? station?.Codigo ?? station?.IdEntidade ?? station?.id,
    Nome: station?.Nome,
    Latitude: station?.Latitude ?? station?.Lat,
    Longitude: station?.Longitude ?? station?.Lon,
    Morada: {
      Morada: station?.Morada,
      CodPostal: station?.CodPostal,
      Localidade: station?.Localidade || station?.Municipio,
      Distrito: station?.Distrito,
    },
    DataAtualizacao: station?.DataAtualizacao,
    Combustiveis: fuels,
  };
}

function mergeDetailWithList(detailFromApi, fallbackDetail) {
  if (!detailFromApi) {
    return fallbackDetail;
  }

  const mergedMorada = detailFromApi.Morada || fallbackDetail.Morada;
  const mergedFuels = Array.isArray(detailFromApi.Combustiveis)
    ? detailFromApi.Combustiveis
    : fallbackDetail.Combustiveis;

  return {
    ...fallbackDetail,
    ...detailFromApi,
    Latitude: detailFromApi.Latitude ?? fallbackDetail.Latitude,
    Longitude: detailFromApi.Longitude ?? fallbackDetail.Longitude,
    Morada: mergedMorada,
    Combustiveis: mergedFuels,
    DataAtualizacao: detailFromApi.DataAtualizacao ?? fallbackDetail.DataAtualizacao,
  };
}

function groupStationsById(rawStations) {
  const grouped = new Map();

  rawStations.forEach((station) => {
    const stationId = station?.Id ?? station?.Codigo ?? station?.IdEntidade ?? station?.id;
    const key = stationId === undefined || stationId === null ? null : String(stationId).trim();
    if (!key) {
      return;
    }

    if (!grouped.has(key)) {
      grouped.set(key, { rawStation: station, fuels: [] });
    }

    const group = grouped.get(key);
    const fuelName = station?.Combustivel ?? station?.TipoCombustivel ?? station?.Tipo;
    const price = station?.Preco ?? station?.price;

    if (fuelName && price !== undefined && price !== null) {
      group.fuels.push({ TipoCombustivel: fuelName, Preco: price });
    }

    group.lastUpdated = group.lastUpdated || station?.DataAtualizacao;
  });

  return Array.from(grouped.values()).map(({ rawStation, fuels, lastUpdated }) => ({
    rawStation,
    detail: buildDetailFromListStation({ ...rawStation, DataAtualizacao: lastUpdated }, fuels),
  }));
}

function normalizeGroupedStations(groupedStations, country, logger, reportProgress) {
  const normalizedStations = [];

  groupedStations.forEach(({ rawStation, detail }, index) => {
    const stationId = detail?.Id ?? rawStation?.Id;
    try {
      const normalized = normalizeStation(rawStation, detail, country, logger);
      if (!normalized.sourceStationId) {
        throw new Error('Missing sourceStationId');
      }
      normalizedStations.push(normalized);
    } catch (error) {
      logger.warn('Skipping DGEG station', {
        stationId,
        message: error.message,
      });
    } finally {
      const progress = 20 + Math.round(((index + 1) / groupedStations.length) * 80);
      reportProgress(Math.min(progress, 99), {
        stage: 'normalizing_stations',
        processed: index + 1,
        total: groupedStations.length,
      });
    }
  });

  return normalizedStations;
}

module.exports = {
  normalizePrice,
  normalizeCoordinate,
  slugifyFuelName,
  parsePrice,
  normalizePrices,
  normalizeSchedule,
  normalizeServices,
  parsePointFromSig,
  extractCoordinates,
  parseLastUpdated,
  resolveAddress,
  normalizeStation,
  buildDetailFromListStation,
  mergeDetailWithList,
  groupStationsById,
  normalizeGroupedStations,
};
