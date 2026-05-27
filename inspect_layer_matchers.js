const fs = require('fs');
const path = require('path');

// Read server.js
const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const modifiedServerCode = serverCode.replace(
  /app\.listen\([\s\S]*/, 
  'module.exports = app;'
);
fs.writeFileSync(path.join(__dirname, 'server_export.js'), modifiedServerCode);

const app = require('./server_export.js');

app.router.stack.forEach((layer, idx) => {
  if (layer.name === 'router' || (layer.handle && layer.handle.stack)) {
    console.log(`\nLayer ${idx}: name = ${layer.name}`);
    console.log(`  keys:`, layer.keys);
    console.log(`  path:`, layer.path);
    console.log(`  slash:`, layer.slash);
    console.log(`  matchers:`, typeof layer.matchers, layer.matchers ? Object.keys(layer.matchers) : 'null');
    if (layer.matchers) {
      // Let's print matchers details
      // In Express 5, matchers is likely a path-to-regexp or router-specific matching object
      console.log('  matchers structure:', JSON.stringify(layer.matchers, (k, v) => v instanceof RegExp ? v.toString() : v, 2));
    }
  }
});

// Cleanup
try {
  fs.unlinkSync(path.join(__dirname, 'server_export.js'));
} catch (e) {}

process.exit(0);
