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

const layer = app.router.stack.find(l => l.name === 'router' || (l.handle && l.handle.stack));
if (layer) {
  console.log('Found a router layer keys:');
  console.log(Object.getOwnPropertyNames(layer));
  console.log('Is there a path or mount path?');
  console.log('keys of handle:', Object.getOwnPropertyNames(layer.handle));
  console.log('keys of route if any:', layer.route ? Object.getOwnPropertyNames(layer.route) : 'no route');
  // Check if there is a match method or path matching pattern
  console.log('layer properties:');
  for (let key of Object.getOwnPropertyNames(layer)) {
    console.log(`${key}: ${typeof layer[key]}`, (typeof layer[key] !== 'function' && typeof layer[key] !== 'object') ? layer[key] : '');
  }
} else {
  console.log('No router layer found');
}

// Cleanup
try {
  fs.unlinkSync(path.join(__dirname, 'server_export.js'));
} catch (e) {}

process.exit(0);
