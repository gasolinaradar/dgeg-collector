# @gasolinaradar/dgeg-collector

<!-- EN -->

A Node.js collector for the **official DGEG fuel-price dataset** (Portugal). It downloads all fuel stations from the public REST API of the Portuguese Directorate-General for Energy and Geology (DGEG), enriches each station with its detail endpoint, and returns a **normalized, ready-to-use** array of stations.

<!-- ES -->

Collector de Node.js para el **dataset oficial de precios de carburantes de la DGEG** (Portugal). Descarga todas las estaciones de servicio desde el API REST público de la Dirección General de Energía y Geología portuguesa (DGEG), enriquece cada estación con su endpoint de detalle y devuelve un array de estaciones **normalizado y listo para usar**.

---

## Features / Características

**EN:**

- Official public source (DGEG, Portugal).
- Two-stage pipeline: station list + per-station detail enrichment.
- Concurrency-limited detail fetching (default 4) with per-station retry and fallback to list data.
- Normalizes Portuguese decimal commas (`1,759` → `1.759`), coordinates and WKT `POINT` SIGs.
- Parses opening hours, services, payment methods and PT/ISO date formats.
- Slugs fuel names (`Gasolina 95` → `gasolina95`).
- Built-in retry with exponential backoff.
- Injectable logger, HTTP client, and URL resolvers.
- Progress reporting hook for long runs.
- Zero configuration: works with sensible defaults.

**ES:**

- Fuente pública oficial (DGEG, Portugal).
- Pipeline de dos fases: listado de estaciones + enriquecimiento por detalle.
- Descarga de detalles con concurrencia limitada (por defecto 4) con reintento por estación y fallback a los datos del listado.
- Normaliza las comas decimales portuguesas (`1,759` → `1.759`), las coordenadas y los SIG WKT `POINT`.
- Parsea horarios, servicios, medios de pago y formatos de fecha PT/ISO.
- Slugifica los nombres de combustible (`Gasolina 95` → `gasolina95`).
- Reintentos con backoff exponencial integrados.
- Logger, cliente HTTP y resolución de URLs inyectables.
- Hook de reporte de progreso para ejecuciones largas.
- Cero configuración: funciona con valores por defecto sensatos.

---

## Installation / Instalación

```bash
npm install @gasolinaradar/dgeg-collector
```

---

## Quick start / Inicio rápido

```js
const { fetchStations } = require('@gasolinaradar/dgeg-collector');

async function main() {
  const stations = await fetchStations();
  console.log(`Fetched ${stations.length} fuel stations`);
  console.log(stations[0]);
}

main();
```

---

## API

### `fetchStations(options?) → Promise<Station[]>`

Downloads the list, enriches each station with its detail, and returns normalized stations in one step.

```js
const { fetchStations } = require('@gasolinaradar/dgeg-collector');

const stations = await fetchStations({
  listUrl:
    'https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PesquisarPostos?qtdPorPagina=999999&pagina=1&orderDesc=0',
  detailUrl: 'https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/GetDadosPostoMapa',
  detailConcurrency: 4,
  logger: console,
  timeout: 15000,
  retries: 3,
});
```

### `createDgegCollector(options?) → Collector`

Returns an object matching the common **collector contract** used by ingestion pipelines:

```js
{ name: 'dgeg', country: 'PT', fetch(context) }
```

```js
const { createDgegCollector } = require('@gasolinaradar/dgeg-collector');

const dgegCollector = createDgegCollector({
  listUrl: () => getSourceMetadata('dgeg').listUrl, // string or () => string
  detailUrl: () => getSourceMetadata('dgeg').detailUrl, // string or () => string
  detailConcurrency: () => getSourceMetadata('dgeg').detailConcurrency, // number or () => number
  country: () => getSourceMetadata('dgeg').country, // string or () => string
  logger,
});

const stations = await dgegCollector.fetch({
  reportProgress(percent, metadata = {}) {
    console.log(`${percent}%`, metadata);
  },
});
```

---

## Options / Opciones

| Option               | Type                            | Default | Description                                                                                             |
| -------------------- | ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `listUrl`            | `string \| () => string`        | DGEG URL | Station list URL. As a function, it is evaluated on every fetch.                                        |
| `detailUrl`          | `string \| () => string`        | DGEG URL | Station detail URL. As a function, it is evaluated on every fetch.                                      |
| `detailConcurrency`  | `number \| () => number`        | `4`     | Maximum number of simultaneous detail requests.                                                         |
| `country`            | `string \| () => string`        | `PT`    | Country code attached to every normalized station.                                                      |
| `timeout`            | `number`                        | `15000` | HTTP timeout in milliseconds.                                                                           |
| `retries`            | `number`                        | `3`     | Retry attempts before failing.                                                                          |
| `logger`             | `{ info, warn, debug }`         | `console` | Injectable logger.                                                                                    |
| `httpClient`         | `{ get(url, opts) }`            | `axios` | Injectable HTTP client (useful for tests or custom TLS settings).                                       |

| Opción               | Tipo                            | Por defecto | Descripción                                                                                            |
| -------------------- | ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `listUrl`            | `string \| () => string`        | URL DGEG    | URL del listado de estaciones. Como función, se evalúa en cada fetch.                                  |
| `detailUrl`          | `string \| () => string`        | URL DGEG    | URL del detalle de estación. Como función, se evalúa en cada fetch.                                    |
| `detailConcurrency`  | `number \| () => number`        | `4`         | Número máximo de peticiones de detalle simultáneas.                                                    |
| `country`            | `string \| () => string`        | `PT`        | Código de país que se añade a cada estación normalizada.                                               |
| `timeout`            | `number`                        | `15000`     | Timeout HTTP en milisegundos.                                                                          |
| `retries`            | `number`                        | `3`         | Intentos de reintento antes de fallar.                                                                 |
| `logger`             | `{ info, warn, debug }`         | `console`   | Logger inyectable.                                                                                     |
| `httpClient`         | `{ get(url, opts) }`            | `axios`     | Cliente HTTP inyectable (útil en tests o para configuración TLS personalizada).                        |

> **Note:** When `httpClient` is injected, the collector does not build any HTTP client itself. Pass an axios instance with your own TLS settings (e.g. `rejectUnauthorized`) if you need custom certificate validation.

> **Nota:** Cuando se inyecta `httpClient`, el collector no construye ningún cliente HTTP propio. Pasa una instancia de axios con tu propia configuración TLS (p. ej. `rejectUnauthorized`) si necesitas validación de certificados personalizada.

---

## Output schema / Esquema de salida

Each normalized station looks like this / Cada estación normalizada tiene esta forma:

```js
{
  source: 'dgeg',
  country: 'PT',
  sourceStationId: '1000',
  name: 'Posto A',
  address: 'Rua das Flores 1, 1000-001',
  municipality: 'Lisboa',
  province: 'Lisboa',
  postalCode: '1000-001',
  schedule: 'L-V: 06:00-24:00 | Sábado: 07:00-24:00 | Domingo: 08:00-22:00',
  services: ['WC', 'Cartão', 'Loja 24H'],
  location: {
    type: 'Point',
    coordinates: [-9.1393366, 38.7222524], // [longitude, latitude]
  },
  prices: {
    gasolina95: 1.759,
    gasleo: 1.489,
  },
  lastUpdated: Date,
}
```

Notes / Notas:

- Prices are keyed by slug: `Gasolina 95` → `gasolina95`. All prices are `number | null`.
- Coordinates are `[longitude, latitude]` (GeoJSON order) and are parsed from Portuguese decimal commas, plain `Latitude`/`Longitude` fields or WKT `POINT` SIG strings.
- Stations that cannot be resolved with coordinates are skipped (logged as warnings).
- If a station detail fetch fails, the collector falls back to the data already present in the list response.

---

## Progress reporting / Reporte de progreso

The collector accepts an optional `context.reportProgress(percent, metadata)` callback:

```js
const stations = await dgegCollector.fetch({
  reportProgress(percent, metadata) {
    // percent: 5   -> requesting the dataset list
    // percent: 20  -> list fetched, grouping by station
    // percent: 20-90 -> fetching per-station details
    // percent: 20-99 -> normalizing stations
    // percent: 100 -> completed
    console.log(percent, metadata.stage);
  },
});
```

---

## Data source / Fuente de datos

**EN:** The data is the public fuel-price dataset of the Portuguese Directorate-General for Energy and Geology (DGEG), published at:

**ES:** Los datos provienen del dataset público de precios de carburantes de la Dirección General de Energía y Geología portuguesa (DGEG), publicado en:

- `https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PesquisarPostos`
- `https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/GetDadosPostoMapa`

This project is **not affiliated with** the Portuguese State or DGEG. The data belongs to the State and is provided "as is". See the legal documents below.

Este proyecto **no está afiliado** al Estado portugués ni a la DGEG. Los datos pertenecen al Estado y se proporcionan "tal cual". Consulta los documentos legales a continuación.

---

## Legal / Legal

**EN:**

- [LEGAL.md](./LEGAL.md) — Legal notice and disclaimer (bilingual).
- [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) — Data attribution and third-party licenses.
- [LICENSE](./LICENSE) — MIT License (applies to this software, **not** to the underlying DGEG data).

**ES:**

- [LEGAL.md](./LEGAL.md) — Aviso legal y descargo de responsabilidad (bilingüe).
- [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) — Atribución de datos y licencias de terceros.
- [LICENSE](./LICENSE) — Licencia MIT (aplica a este software, **no** a los datos subyacentes de la DGEG).

---

## Tests

```bash
npm test
```

---

## License / Licencia

**EN:** MIT. See [LICENSE](./LICENSE). The DGEG data is **not** covered by this license; it is public information of the Portuguese State.

**ES:** MIT. Consulta [LICENSE](./LICENSE). Los datos de la DGEG **no** están cubiertos por esta licencia; son información pública del Estado portugués.
