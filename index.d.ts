import { RequestHandler } from 'express';

export interface DeviceSummary {
    temperature: string;
    batteryCharge: string;
    gridPower: string;
    pvPower: string;
    onSolar: boolean;
    powerSource: 'On Grid' | 'On Battery' | 'Hybrid' | 'Unknown';
    operatingStatus: string;
}

export interface DeviceResult {
    name: string;
    alias: string;
    /** Device serial number (used as unique identifier) */
    ip: string;
    status: 'up' | 'down';
    deviceSn: string;
    collectionTime: string | null;
    deviceType: string;
    deviceState: unknown;
    stationId: string | null;
    stationName: string;
    productId: string | null;
    summary: DeviceSummary;
    lastDown: null;
    totalDownMin: number;
    key: string;
}

export interface AttentionDevice {
    name: string;
    alias: string;
    powerSource: string;
    batteryCharge: string;
    onSolar: boolean;
    pvPower: string;
    sinceText: string | null;
}

export interface Attention {
    hasIssue: boolean;
    count: number;
    devices: AttentionDevice[];
}

export interface Pagination {
    page: number;
    size: number;
    count: number;
}

export interface TemperaturesResponse {
    data: DeviceResult[];
    title: string;
    pagination: Pagination;
    attention: Attention;
}

export interface TemperaturesErrorResponse {
    data: never[];
    title: string;
    apiError: string;
}

export interface NormalizedDevice {
    deviceSn: string;
    alias: string;
    name: string;
    branch: unknown;
    stationName: string | null;
    raw: Record<string, unknown>;
}

export interface MetricItem {
    key: string;
    value: string;
    unit: string;
}

/**
 * Fetches all inverter devices from the Deye Cloud station list.
 * Falls back to `/device/list` if the station endpoint returns no devices.
 */
export declare function getCloudDevices(
    token: string,
    page?: number,
    size?: number
): Promise<NormalizedDevice[]>;

/**
 * Fetches the latest telemetry data for a list of device serial numbers.
 * Queries in batches of 10.
 */
export declare function getLatestBySn(
    token: string,
    snList: string[]
): Promise<Map<string, Record<string, unknown>>>;

/**
 * Derives a human-readable summary (power source, SOC, temperatures, etc.)
 * from a normalised `dataList` array returned by the Deye Cloud API.
 */
export declare function buildSummary(metrics: MetricItem[]): DeviceSummary;

/**
 * Express request handler.
 * Fetches live data from Deye Cloud and responds with JSON
 * (`TemperaturesResponse` on success, `TemperaturesErrorResponse` on failure).
 *
 * Token resolution order:
 *  1. `x-deye-token` header
 *  2. `Authorization: Bearer <token>` header
 *  3. `?token=` query parameter
 *  4. `token` body field
 *  5. `DEYE_TOKEN` environment variable
 */
export declare const Temperatures: RequestHandler;

/**
 * Alias of `Temperatures` kept for backward compatibility.
 * @deprecated Use `Temperatures` instead.
 */
export declare const Tempretures: RequestHandler;
