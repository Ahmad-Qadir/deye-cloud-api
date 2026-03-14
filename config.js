const axios = require('axios');

const DEYE_BASE_URL = process.env.DEYE_BASE_URL || 'https://eu1-developer.deyecloud.com/v1.0';
const DEYE_TOKEN = process.env.DEYE_TOKEN || null;

// Track when each device (by SN) first entered 'On Battery'
const batteryStartTimes = new Map();

const formatDuration = (ms) => {
    if (!ms || ms < 0) return null;
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return parts.join(' ');
};

const getCandidateArrays = (obj, visited = new Set()) => {
    if (!obj || typeof obj !== 'object') return [];
    if (visited.has(obj)) return [];
    visited.add(obj);

    const arrays = [];
    if (Array.isArray(obj)) {
        arrays.push(obj);
        for (const item of obj) {
            if (item && typeof item === 'object') arrays.push(...getCandidateArrays(item, visited));
        }
        return arrays;
    }

    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (Array.isArray(val)) {
            arrays.push(val);
            for (const item of val) {
                if (item && typeof item === 'object') arrays.push(...getCandidateArrays(item, visited));
            }
        } else if (val && typeof val === 'object') {
            arrays.push(...getCandidateArrays(val, visited));
        }
    }

    return arrays;
};

const postDeye = async (endpoint, token, body = {}) => {
    const response = await axios.post(`${DEYE_BASE_URL}${endpoint}`, body, {
        timeout: 15000,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `bearer ${token}`
        }
    });
    return response.data;
};

const normalizeToken = (value) => {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    return text.toLowerCase().startsWith('bearer ') ? text.slice(7).trim() : text;
};

const getRequestToken = (req) => {
    const headerToken = req?.headers?.['x-deye-token'];
    const authHeader = req?.headers?.authorization || req?.headers?.Authorization;
    const queryToken = req?.query?.token;
    const bodyToken = req?.body?.token;

    return normalizeToken(headerToken)
        || normalizeToken(authHeader)
        || normalizeToken(queryToken)
        || normalizeToken(bodyToken)
        || null;
};

const getAuthToken = async (req) => {
    const requestToken = getRequestToken(req);
    if (requestToken) return requestToken;
    if (DEYE_TOKEN) return DEYE_TOKEN;
    throw new Error('Missing Deye API token. Provide token from request (x-deye-token, Authorization, query/body token) or set DEYE_TOKEN.');
};

const normalizeDevice = (item) => {
    const sn = item?.deviceSn || item?.sn || item?.serialNo || item?.serialNumber || null;
    if (!sn) return null;

    const snText = String(sn);
    const displayName = `SN ${snText}`;

    return {
        deviceSn: snText,
        alias: '',
        name: displayName,
        branch: item?.branch || item?.stationBranch || null,
        stationName: item?.stationName || null,
        raw: item
    };
};

const getCloudDevices = async (token, page = 1, size = 200) => {
    const stationResponse = await postDeye('/station/listWithDevice', token, {
        page,
        size,
        deviceType: 'INVERTER'
    });

    const stationDevices = Array.isArray(stationResponse?.stationList)
        ? stationResponse.stationList.flatMap((station) => {
            if (!Array.isArray(station?.deviceListItems)) return [];
            return station.deviceListItems.map((device) => ({
                ...device,
                stationName: station?.name || null
            }));
        })
        : [];

    const arrays = getCandidateArrays(stationResponse);
    const flat = [...stationDevices, ...arrays.flat()];
    const found = flat
        .map(normalizeDevice)
        .filter(Boolean);

    const dedupe = new Map();
    for (const item of found) {
        if (!dedupe.has(item.deviceSn)) dedupe.set(item.deviceSn, item);
    }

    if (dedupe.size > 0) return Array.from(dedupe.values());

    const fallbackResponse = await postDeye('/device/list', token, { page, size });
    const fallbackArrays = getCandidateArrays(fallbackResponse);
    const fallbackFlat = fallbackArrays.flat();
    const fallbackFound = fallbackFlat
        .map(normalizeDevice)
        .filter(Boolean);

    const fallbackDedupe = new Map();
    for (const item of fallbackFound) {
        if (!fallbackDedupe.has(item.deviceSn)) fallbackDedupe.set(item.deviceSn, item);
    }

    return Array.from(fallbackDedupe.values());
};

const chunk = (arr, size) => {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
};

const getLatestBySn = async (token, snList) => {
    const latestMap = new Map();
    const batches = chunk(snList, 10);

    for (const batch of batches) {
        const response = await postDeye('/device/latest', token, { deviceList: batch });
        const arrays = getCandidateArrays(response);
        const rows = arrays.flat();

        for (const row of rows) {
            const sn = row?.deviceSn || row?.sn || row?.serialNo || row?.serialNumber;
            if (sn) latestMap.set(String(sn), row);
        }
    }

    return latestMap;
};

const toStatus = (device, latest) => {
    const merged = { ...(device?.raw || {}), ...(latest || {}) };

    const boolFields = ['online', 'isOnline', 'alive', 'connected'];
    for (const key of boolFields) {
        if (typeof merged[key] === 'boolean') return merged[key] ? 'up' : 'down';
    }

    const textFields = ['status', 'deviceStatus', 'runningStatus', 'connectStatus', 'state'];
    for (const key of textFields) {
        const value = merged[key];
        if (!value) continue;
        const text = String(value).toLowerCase();
        if (text.includes('offline') || text.includes('down') || text.includes('disconnect') || text === '0') return 'down';
        if (text.includes('online') || text.includes('up') || text.includes('connect') || text.includes('normal') || text === '1') return 'up';
    }

    return 'up';
};

const normalizeMetrics = (latest) => {
    const metricList = Array.isArray(latest?.dataList) ? latest.dataList : [];
    return metricList
        .filter((item) => item && item.key)
        .map((item) => ({
            key: String(item.key),
            value: item.value !== undefined && item.value !== null ? String(item.value) : '-',
            unit: item.unit ? String(item.unit) : ''
        }));
};

const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const getMetricValue = (metrics, keys = []) => {
    for (const key of keys) {
        const found = metrics.find((m) => m.key === key);
        if (found && found.value !== '-') return found.value;
    }
    return null;
};

const buildSummary = (metrics) => {
    const temperature = getMetricValue(metrics, ['Temperature- Battery', 'DC Temperature', 'AC Temperature']);
    const soc = getMetricValue(metrics, ['SOC']);
    const gridPowerRaw = getMetricValue(metrics, ['TotalGridPower', 'GridPower']);
    const batteryPowerRaw = getMetricValue(metrics, ['BatteryPower']);
    const pvPowerRaw = getMetricValue(metrics, ['TotalDCInputPower', 'DCPowerPV1']);

    const gridPower = toNumber(gridPowerRaw);
    const batteryPower = toNumber(batteryPowerRaw);
    const pvPower = toNumber(pvPowerRaw);
    const onSolar = pvPower !== null && pvPower > 50;

    let powerSource = 'Unknown';
    const gridAbs = gridPower !== null ? Math.abs(gridPower) : 0;
    const batteryAbs = batteryPower !== null ? Math.abs(batteryPower) : 0;

    if (gridAbs > 50 && batteryAbs <= 50) powerSource = 'On Grid';
    else if (batteryAbs > 50 && gridAbs <= 50) powerSource = 'On Battery';
    else if (gridAbs > 50 && batteryAbs > 50) powerSource = 'Hybrid';

    const operatingStatus = powerSource;

    return {
        temperature: temperature ? `${temperature}℃` : 'N/A',
        batteryCharge: soc ? `${soc}%` : 'N/A',
        gridPower: gridPowerRaw ? `${gridPowerRaw} W` : 'N/A',
        pvPower: pvPower !== null ? `${pvPowerRaw} W` : 'N/A',
        onSolar,
        powerSource,
        operatingStatus
    };
};

const toIsoTime = (collectionTime) => {
    if (!collectionTime) return null;
    const numeric = Number(collectionTime);
    if (!Number.isFinite(numeric)) return null;
    const timestampMs = numeric < 1000000000000 ? numeric * 1000 : numeric;
    return new Date(timestampMs).toISOString();
};

const temperaturesHandler = async (req, res, next) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const size = Math.min(Math.max(parseInt(req.query.size, 10) || 50, 1), 200);

        const token = await getAuthToken(req);
        const devices = await getCloudDevices(token, page, size);

        const snList = devices.map((d) => d.deviceSn);
        const latestBySn = await getLatestBySn(token, snList);

        const results = devices.map((device) => {
            const latest = latestBySn.get(device.deviceSn);
            const isUp = toStatus(device, latest) === 'up';
            const metrics = normalizeMetrics(latest);
            const summary = buildSummary(metrics);

            return {
                name: device.name,
                alias: device.alias || '',
                ip: device.deviceSn,
                status: isUp ? 'up' : 'down',
                deviceSn: device.deviceSn,
                collectionTime: toIsoTime(latest?.collectionTime),
                deviceType: latest?.deviceType || device?.raw?.deviceType || 'INVERTER',
                deviceState: latest?.deviceState ?? device?.raw?.connectStatus ?? null,
                stationId: latest?.stationId || device?.raw?.stationId || null,
                stationName: device.stationName || latest?.stationName || device?.raw?.stationName || 'Unknown Plant',
                productId: latest?.productId || device?.raw?.productId || null,
                summary
            };
        });

        const dataWithStats = results
            .map((device) => ({
                ...device,
                lastDown: null,
                totalDownMin: 0,
                key: `${device.name} (${device.deviceSn})`
            }))
            .sort((a, b) => {
                const rank = (d) => {
                    if (d?.summary?.powerSource === 'On Battery') return 0;
                    if (d.status === 'down') return 1;
                    return 2;
                };
                const ra = rank(a), rb = rank(b);
                if (ra !== rb) return ra - rb;
                return a.name.localeCompare(b.name);
            });

        const now = Date.now();
        const notOnGrid = dataWithStats.filter((device) => device?.summary?.powerSource === 'On Battery');
        const notOnGridSns = new Set(notOnGrid.map((d) => d.deviceSn));

        // Record start time for newly detected battery devices; clear resolved ones
        for (const device of notOnGrid) {
            if (!batteryStartTimes.has(device.deviceSn)) {
                batteryStartTimes.set(device.deviceSn, now);
            }
        }
        for (const sn of batteryStartTimes.keys()) {
            if (!notOnGridSns.has(sn)) batteryStartTimes.delete(sn);
        }

        const attention = {
            hasIssue: notOnGrid.length > 0,
            count: notOnGrid.length,
            devices: notOnGrid.map((device) => {
                const startedAt = batteryStartTimes.get(device.deviceSn);
                const sinceText = startedAt ? formatDuration(now - startedAt) : null;
                return {
                    name: device.name,
                    alias: device.alias || device.name,
                    powerSource: device?.summary?.powerSource || 'Unknown',
                    batteryCharge: device?.summary?.batteryCharge || 'N/A',
                    onSolar: device?.summary?.onSolar || false,
                    pvPower: device?.summary?.pvPower || 'N/A',
                    sinceText
                };
            })
        };

        res.json({
            data: dataWithStats,
            title: 'DeYe Inverter Monitor',
            pagination: { page, size, count: dataWithStats.length },
            attention
        });
    } catch (error) {
        console.error('[DeYe API Error]', error?.response?.data || error.message || error);
        res.status(500).json({
            data: [],
            title: 'DeYe Inverter Monitor',
            apiError: error?.response?.data?.message || error.message || 'Failed to fetch DeYe Cloud API'
        });
    }
};

// Handler exports
exports.Tempretures = temperaturesHandler; // backward-compat alias
exports.Temperatures = temperaturesHandler;

// Programmatic API — useful when you want the raw data without an Express route
exports.getCloudDevices = getCloudDevices;
exports.getLatestBySn = getLatestBySn;
exports.buildSummary = buildSummary;
