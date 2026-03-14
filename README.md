# Deye Inverter Monitor Handler

Express handler that fetches inverter data from Deye Cloud and responds with JSON.

## Features

- Fetches cloud devices from Deye API
- Retrieves device list live on each request (no hardcoded device list)
- Uses device serial number (SN) as the identifier/display name
- Computes per-device status and summary
- Tracks battery mode duration
- Full TypeScript type definitions included

## Install

```bash
npm install deye-cloud-api
```

Express is a peer dependency — make sure it is installed in your project:

```bash
npm install express
```

## Quick Start

1. Set your Deye API token (see [Environment Variables](#environment-variables)).
2. Mount the handler in your Express app.
3. Call your route — it responds with JSON.

## Usage

### Express handler (JSON response)

```js
const express = require('express');
const { Temperatures } = require('deye-cloud-api');

const app = express();

app.get('/deye', Temperatures);
```

### Programmatic API

Use the lower-level functions directly when you need the raw data:

```js
const { getCloudDevices, getLatestBySn, buildSummary } = require('deye-cloud-api');

const token = process.env.DEYE_TOKEN;

const devices = await getCloudDevices(token);
const snList  = devices.map((d) => d.deviceSn);
const latest  = await getLatestBySn(token, snList);

for (const device of devices) {
    const metrics = latest.get(device.deviceSn)?.dataList ?? [];
    const summary = buildSummary(metrics.map((m) => ({
        key:   String(m.key),
        value: m.value !== undefined && m.value !== null ? String(m.value) : '-',
        unit:  m.unit ? String(m.unit) : ''
    })));
    console.log(device.deviceSn, summary.powerSource, summary.batteryCharge);
}
```

Backward-compatible export is also available:

```js
const { Tempretures } = require('deye-cloud-api'); // deprecated spelling
```

### TypeScript

```ts
import { Temperatures, getCloudDevices, DeviceResult, TemperaturesResponse } from 'deye-cloud-api';
```

## JSON Response Shape

`GET /deye` → `200 OK`

```json
{
  "data": [
    {
      "name": "SN ABC123",
      "deviceSn": "ABC123",
      "status": "up",
      "stationName": "My Plant",
      "collectionTime": "2026-03-14T10:00:00.000Z",
      "summary": {
        "powerSource": "On Grid",
        "batteryCharge": "85%",
        "temperature": "32℃",
        "gridPower": "1200 W",
        "pvPower": "2500 W",
        "onSolar": true,
        "operatingStatus": "On Grid"
      }
    }
  ],
  "pagination": { "page": 1, "size": 50, "count": 1 },
  "attention": { "hasIssue": false, "count": 0, "devices": [] },
  "title": "DeYe Inverter Monitor"
}
```

On error → `500` with `{ "apiError": "..." }`.

## Environment Variables

Set these in your runtime environment or `.env` file (copy `.env.example`):

| Variable | Required | Default |
|---|---|---|
| `DEYE_TOKEN` | Optional fallback | — |
| `DEYE_BASE_URL` | No | `https://eu1-developer.deyecloud.com/v1.0` |

## Passing Token From the Request

Your caller can supply the Deye token per-request. Priority order:

1. Header: `x-deye-token: <token>`
2. Header: `Authorization: Bearer <token>`
3. Query string: `?token=<token>`
4. Body field: `token`
5. Falls back to `DEYE_TOKEN` env var

## Smoke Test

```bash
npm run smoke-test -- --token <DEYE_TOKEN>
npm run smoke-test -- --token <DEYE_TOKEN> --mode header   # x-deye-token
npm run smoke-test -- --token <DEYE_TOKEN> --mode auth     # Authorization: Bearer
npm run smoke-test -- --token <DEYE_TOKEN> --mode query    # ?token=
npm run smoke-test -- --token <DEYE_TOKEN> --mode body     # body.token
```

Or set `DEYE_TOKEN` in `.env` and just run `npm run smoke-test`.

## Publish

1. Update `version` in `package.json`.
2. Run `npm pack --dry-run` to verify package contents.
3. `npm login`
4. `npm publish`

## License

MIT
