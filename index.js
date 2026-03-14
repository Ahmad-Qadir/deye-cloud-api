'use strict';

const {
    Temperatures,
    Tempretures,
    getCloudDevices,
    getLatestBySn,
    buildSummary
} = require('./config');

module.exports = {
    // Express handlers
    Temperatures,
    Tempretures,
    // Programmatic API
    getCloudDevices,
    getLatestBySn,
    buildSummary
};
