const fs = require('fs');
const path = require('path');
const listEndpoints = require('express-list-endpoints');

// 1. Create a temporary server file that exports the app instead of listening
const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const modifiedServerCode = serverCode.replace(
  /app\.listen\([\s\S]*/, 
  'module.exports = app;'
);
fs.writeFileSync(path.join(__dirname, '../server_export.js'), modifiedServerCode);

// 2. Load the app and extract endpoints
const app = require('../server_export.js');

if (!app || typeof app.use !== 'function') {
  console.error("Failed to extract app from server.js. Check the regex replacement.");
  process.exit(1);
}

const endpoints = listEndpoints(app);
console.log(`Total endpoints found in app: ${endpoints.length}`);

// 3. Filter client endpoints
const clientEndpoints = endpoints.filter(ep => {
  const p = ep.path;
  return p.includes('/api/client') || 
         p.includes('/api/clients') || 
         p.includes('/api/organizations') ||
         p.includes('/api/mobile-qr-auth') ||
         p.includes('/api/subjectivetest/clients') ||
         p.includes('/api/objectivetest/clients') ||
         p.includes('/api/objectivetest-questions/clients') ||
         p.includes('/api/subjectivetest-questions/clients') ||
         p.includes('/api/mobile/public-chat');
});

// 4. Group endpoints by folder
function getFolderName(epPath) {
  const p = epPath;
  if (p.includes('/api/client/')) return 'Web Dashboard';
  if (p.includes('/api/organizations')) return 'Organization Management';
  if (p.includes('/auth') || p.includes('/qr-auth') || p.includes('/mobile-qr-auth') || p.includes('delete-user') || p.includes('check-user')) return 'Authentication';
  if (p.includes('/myquestion') || p.includes('/userAnswers') || p.includes('/evaluations') || p.includes('/review') || p.includes('/submitted-answers') || p.includes('/answerapis') || p.includes('/aiswb')) return 'Answers & Evaluations';
  if (p.includes('/subjectivetest') || p.includes('/objectivetest')) return 'Tests & Exams';
  if (p.includes('/books') || p.includes('/workbooks') || p.includes('/cart') || p.includes('/paytm') || p.includes('/homepage') || p.includes('/banners')) return 'Books & Store';
  if (p.includes('/public-chat') || p.includes('/pdf-chat') || p.includes('/reels') || p.includes('/marketing') || p.includes('/scoreboard') || p.includes('/telegram') || p.includes('/app-analytics') || p.includes('/user-analytics') || p.includes('/user-profile') || p.includes('/credit')) return 'Engagement & Analytics';
  
  return 'Other Client APIs';
}

const groupedEndpoints = {};

clientEndpoints.forEach(ep => {
  const folder = getFolderName(ep.path);
  if (!groupedEndpoints[folder]) groupedEndpoints[folder] = [];
  
  ep.methods.forEach(method => {
    groupedEndpoints[folder].push({
      method: method,
      path: ep.path
    });
  });
});

// 5. Build Postman Collection JSON
const collection = {
  info: {
    name: "Ailishar Client APIs",
    description: "Complete collection of all B2B and Tenant Mobile App APIs for Ailishar.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  item: [],
  variable: [
    {
      key: "base_url",
      value: "http://localhost:5000",
      type: "string"
    },
    {
      key: "client_id",
      value: "CLIENT_ID_HERE",
      type: "string"
    },
    {
      key: "token",
      value: "YOUR_AUTH_TOKEN_HERE",
      type: "string"
    }
  ]
};

// Create folders and items
Object.keys(groupedEndpoints).forEach(folderName => {
  const folderItem = {
    name: folderName,
    item: []
  };

  groupedEndpoints[folderName].forEach(api => {
    // Replace Express params like :clientId with Postman variables like {{client_id}}
    let rawPath = api.path;
    rawPath = rawPath.replace(/:clientId/g, '{{client_id}}');
    rawPath = rawPath.replace(/:id/g, '{{id}}');
    rawPath = rawPath.replace(/:userId/g, '{{user_id}}');
    rawPath = rawPath.replace(/:planId/g, '{{plan_id}}');
    rawPath = rawPath.replace(/:itemId/g, '{{item_id}}');
    rawPath = rawPath.replace(/:questionId/g, '{{question_id}}');
    rawPath = rawPath.replace(/:setId/g, '{{set_id}}');
    rawPath = rawPath.replace(/:chapterId/g, '{{chapter_id}}');
    rawPath = rawPath.replace(/:topicId/g, '{{topic_id}}');
    rawPath = rawPath.replace(/:bookId/g, '{{book_id}}');
    rawPath = rawPath.replace(/:workbookId/g, '{{workbook_id}}');
    
    // Split path into segments
    // Clean leading slash for path segments
    const cleanPath = rawPath.startsWith('/') ? rawPath.substring(1) : rawPath;
    const pathSegments = cleanPath.split('/');

    const requestItem = {
      name: `[${api.method}] ${api.path}`,
      request: {
        method: api.method,
        header: [
          {
            key: "Authorization",
            value: "Bearer {{token}}",
            type: "text"
          }
        ],
        url: {
          raw: `{{base_url}}/${cleanPath}`,
          host: [
            "{{base_url}}"
          ],
          path: pathSegments
        }
      },
      response: []
    };
    
    folderItem.item.push(requestItem);
  });

  collection.item.push(folderItem);
});

// 6. Write JSON to file
const outputPath = path.join(__dirname, '../client_api_collection.json');
fs.writeFileSync(outputPath, JSON.stringify(collection, null, 2));

console.log(`Successfully generated Postman collection at: ${outputPath}`);
console.log(`Total Client APIs extracted: ${clientEndpoints.length}`);
console.log(`Total Endpoint Combinations: ${collection.item.reduce((acc, folder) => acc + folder.item.length, 0)}`);

// Cleanup
setTimeout(() => {
  fs.unlinkSync(path.join(__dirname, '../server_export.js'));
  process.exit(0);
}, 1000);
