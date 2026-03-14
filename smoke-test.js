'use strict';

const fs = require('fs');
const path = require('path');
const { Temperatures } = require('./index');

const loadDotEnv = (fileName = '.env') => {
    const envPath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(envPath)) return;

    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const sep = line.indexOf('=');
        if (sep <= 0) continue;

        const key = line.slice(0, sep).trim();
        const value = line.slice(sep + 1).trim();
        if (!key) continue;
        if (process.env[key] === undefined) process.env[key] = value;
    }
};

const getArgValue = (name) => {
    const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
    if (direct) return direct.slice(name.length + 1).trim();

    const idx = process.argv.findIndex((arg) => arg === name);
    if (idx >= 0 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim();

    return '';
};

const printUsage = () => {
    console.log('Smoke test usage:');
    console.log('  npm run smoke-test -- --token <DEYE_TOKEN>');
    console.log('  npm run smoke-test -- --token <DEYE_TOKEN> --mode header');
    console.log('  npm run smoke-test -- --token <DEYE_TOKEN> --mode auth');
    console.log('  npm run smoke-test -- --token <DEYE_TOKEN> --mode query');
    console.log('  npm run smoke-test -- --token <DEYE_TOKEN> --mode body');
    console.log('');
    console.log('You can also set DEYE_TOKEN in .env or environment variables.');
};

const createRequest = (token, mode) => {
    const req = {
        query: {},
        headers: {},
        body: {}
    };

    if (mode === 'auth') {
        req.headers.authorization = `Bearer ${token}`;
    } else if (mode === 'query') {
        req.query.token = token;
    } else if (mode === 'body') {
        req.body.token = token;
    } else {
        req.headers['x-deye-token'] = token;
    }

    return req;
};

const run = async () => {
    loadDotEnv();

    const token = getArgValue('--token') || process.env.DEYE_TOKEN || '';
    const mode = (getArgValue('--mode') || 'header').toLowerCase();
    const supportedModes = new Set(['header', 'auth', 'query', 'body']);

    if (!token) {
        console.error('Smoke test failed: missing token.');
        printUsage();
        process.exit(1);
    }

    if (!supportedModes.has(mode)) {
        console.error(`Smoke test failed: unsupported mode "${mode}".`);
        printUsage();
        process.exit(1);
    }

    const req = createRequest(token, mode);

    const res = {
        render: (view, data) => {
            if (data?.apiError) {
                console.error(`Smoke test failed: ${data.apiError}`);
                process.exit(1);
            }

            const output = {
                ok: true,
                tokenMode: mode,
                view,
                fetchedAt: data?.fetchedAt || null,
                totalDevices: Array.isArray(data?.data) ? data.data.length : 0,
                sample: Array.isArray(data?.data) ? data.data.slice(0, 3) : []
            };
            console.log(JSON.stringify(output, null, 2));
            process.exit(0);
        }
    };

    try {
        await Temperatures(req, res, () => {});
    } catch (error) {
        console.error('Smoke test failed:', error?.message || error);
        process.exit(1);
    }
};

run();
