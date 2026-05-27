const fs = require('fs');
const path = require('path');
const listEndpoints = require('express-list-endpoints');

const app = require('./server_export.js');

// Alias router for express-list-endpoints (Express 5 compatibility)
app._router = app.router;

const endpoints = listEndpoints(app);
console.log(`Total endpoints found: ${endpoints.length}`);
if (endpoints.length > 0) {
  console.log('First 5 endpoints:');
  endpoints.slice(0, 5).forEach(ep => {
    console.log(`[${ep.methods.join(',')}] ${ep.path}`);
  });
}
process.exit(0);
