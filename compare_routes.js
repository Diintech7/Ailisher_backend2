const fs = require('fs');
const path = require('path');
const listEndpoints = require('express-list-endpoints');

// 1. Create a temporary server file that exports the app instead of listening
const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const modifiedServerCode = serverCode.replace(
  /app\.listen\([\s\S]*/, 
  'module.exports = app;'
);
fs.writeFileSync(path.join(__dirname, 'server_export.js'), modifiedServerCode);

// 2. Load the app and extract endpoints
const app = require('./server_export.js');

if (!app || typeof app.use !== 'function') {
  console.error("Failed to extract app from server.js.");
  process.exit(1);
}

// Support Express 5
app._router = app.router;

const endpoints = listEndpoints(app);
console.log(`Total endpoints found in app: ${endpoints.length}`);

// 3. Filter client endpoints
const activeClientEndpoints = [];
endpoints.forEach(ep => {
  const p = ep.path;
  const isClient = p.includes('/api/client') || 
                   p.includes('/api/clients') || 
                   p.includes('/api/organizations') ||
                   p.includes('/api/mobile') ||
                   p.includes('/api/mobile-qr-auth') ||
                   p.includes('/api/subjectivetest/clients') ||
                   p.includes('/api/objectivetest/clients') ||
                   p.includes('/api/objectivetest-questions/clients') ||
                   p.includes('/api/subjectivetest-questions/clients');
  
  if (isClient) {
    ep.methods.forEach(method => {
      activeClientEndpoints.push({
        method: method.toUpperCase(),
        path: ep.path
      });
    });
  }
});

console.log(`Total Active Client Endpoints in backend: ${activeClientEndpoints.length}`);

// 4. Load the collection endpoints
const collectionData = JSON.parse(fs.readFileSync('client_api_collection.json', 'utf8'));
const collectionEndpoints = [];
const traverse = (items) => {
  items.forEach(item => {
    if (item.item) traverse(item.item);
    else if (item.request) {
      const method = item.request.method.toUpperCase();
      let pathSegments = item.request.url.path || [];
      // Reconstruct path
      let rawPath = '/api/' + pathSegments.filter(s => s !== 'api').join('/');
      
      // Convert postman variables back to express params for comparison
      let normalizedPath = rawPath
        .replace(/\{\{client_id\}\}/g, ':clientId')
        .replace(/\{\{id\}\}/g, ':id')
        .replace(/\{\{user_id\}\}/g, ':userId')
        .replace(/\{\{plan_id\}\}/g, ':planId')
        .replace(/\{\{item_id\}\}/g, ':itemId')
        .replace(/\{\{question_id\}\}/g, ':questionId')
        .replace(/\{\{set_id\}\}/g, ':setId')
        .replace(/\{\{chapter_id\}\}/g, ':chapterId')
        .replace(/\{\{topic_id\}\}/g, ':topicId')
        .replace(/\{\{book_id\}\}/g, ':bookId')
        .replace(/\{\{workbook_id\}\}/g, ':workbookId');
      
      collectionEndpoints.push({
        method,
        path: normalizedPath,
        originalRaw: item.request.url.raw
      });
    }
  });
};
traverse(collectionData.item);
console.log(`Total Endpoints in client_api_collection.json: ${collectionEndpoints.length}`);

// Helper to compare paths (e.g. trailing slashes, param casing)
const normalize = (p) => {
  return p.toLowerCase()
    .replace(/\/+$/, '')
    .replace(/:clientid/g, ':clientid')
    .replace(/:bookid/g, ':bookid')
    .replace(/:chapterid/g, ':chapterid')
    .replace(/:topicid/g, ':topicid')
    .replace(/:questionid/g, ':questionid')
    .replace(/:setid/g, ':setid')
    .replace(/:workbookid/g, ':workbookid')
    .replace(/:planid/g, ':planid')
    .replace(/:itemid/g, ':itemid')
    .replace(/:userid/g, ':userid');
};

// 5. Find missing endpoints
const missingFromCollection = [];
activeClientEndpoints.forEach(active => {
  const found = collectionEndpoints.some(coll => {
    return coll.method === active.method && normalize(coll.path) === normalize(active.path);
  });
  if (!found) {
    missingFromCollection.push(active);
  }
});

// 6. Find stale/extra endpoints in collection
const staleInCollection = [];
collectionEndpoints.forEach(coll => {
  const found = activeClientEndpoints.some(active => {
    return active.method === coll.method && normalize(active.path) === normalize(coll.path);
  });
  if (!found) {
    staleInCollection.push(coll);
  }
});

console.log('\n--- MISSING FROM COLLECTION ---');
console.log(missingFromCollection.length, 'endpoints missing:');
missingFromCollection.forEach(ep => console.log(`[${ep.method}] ${ep.path}`));

console.log('\n--- STALE/EXTRA IN COLLECTION ---');
console.log(staleInCollection.length, 'endpoints stale:');
staleInCollection.forEach(ep => console.log(`[${ep.method}] ${ep.path} (Raw in collection: ${ep.originalRaw})`));

// Cleanup
try {
  fs.unlinkSync(path.join(__dirname, 'server_export.js'));
} catch (e) {}

process.exit(0);
