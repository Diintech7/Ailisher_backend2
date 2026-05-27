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
  // Check if it's a router mount
  if (layer.name === 'router' || (layer.handle && layer.handle.stack)) {
    const mountPath = layer.regexp.toString();
    console.log(`\nLayer ${idx}: mounted router with regexp ${mountPath}`);
    // Print first 3 paths in this sub-router
    const subStack = layer.handle.stack;
    console.log(`  Sub-router stack length: ${subStack.length}`);
    let printed = 0;
    subStack.forEach((subLayer) => {
      if (subLayer.route && printed < 3) {
        console.log(`    Route path: ${subLayer.route.path}, methods: ${Object.keys(subLayer.route.methods || {})}`);
        printed++;
      }
    });
  } else if (layer.route) {
    console.log(`\nLayer ${idx}: direct route ${layer.route.path}`);
  }
});

// Cleanup
try {
  fs.unlinkSync(path.join(__dirname, 'server_export.js'));
} catch (e) {}

process.exit(0);
