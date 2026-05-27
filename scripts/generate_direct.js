const fs = require('fs');
const path = require('path');
const listEndpoints = require('express-list-endpoints');

const clientRoutesMap = [
  { prefix: '/api/client', file: '../routes/client.js', folder: 'Web Dashboard' },
  { prefix: '/api/organizations', file: '../routes/organizations.js', folder: 'Organization Management' },
  { prefix: '/api/clients/:clientId/mobile/user-profile', file: '../routes/userProfile.js', folder: 'Authentication' },
  { prefix: '/api/clients/:clientId/mobile/user-analytics', file: '../routes/userAnalytics.js', folder: 'Engagement & Analytics' },
  { prefix: '/api/clients/:clientId/mobile/auth', file: '../routes/mobileAuth.js', folder: 'Authentication' },
  { prefix: '/api/clients/:clientId/mobile/myquestion', file: '../routes/myquestion.js', folder: 'Answers & Evaluations' },
  { prefix: '/api/clients/:clientId/mobile/books', file: '../routes/mobileBooks.js', folder: 'Books & Store' },
  { prefix: '/api/clients/:clientId/mobile/mybooks', file: '../routes/myBooks.js', folder: 'Books & Store' },
  { prefix: '/api/clients/:clientId/mobile/myworkbooks', file: '../routes/myworkbook.js', folder: 'Books & Store' },
  { prefix: '/api/clients/:clientId/mobile/cart', file: '../routes/cart.js', folder: 'Books & Store' },
  { prefix: '/api/clients/:clientId/mobile/userAnswers', file: '../routes/userAnswers.js', folder: 'Answers & Evaluations' },
  { prefix: '/api/clients/:clientId/mobile/userAnswers', file: '../routes/userAnswer1.js', folder: 'Answers & Evaluations' },
  { prefix: '/api/clients/:clientId/mobile/evaluations', file: '../routes/evaluations.js', folder: 'Answers & Evaluations' },
  { prefix: '/api/clients/:clientId/mobile/submitted-answers', file: '../routes/mobileSubmittedAnswers.js', folder: 'Answers & Evaluations' },
  { prefix: '/api/clients/:clientId/mobile/review', file: '../routes/reviewRequests.js', folder: 'Answers & Evaluations' },
  { prefix: '/api/clients/:clientId/mobile/banners', file: '../routes/mobileBanners.js', folder: 'Books & Store' },
  { prefix: '/api/mobile/public-chat', file: '../routes/mobilePublicChat.js', folder: 'Chat & Extras' },
  { prefix: '/api/mobile/public-chat', file: '../routes/mobilePDFChat.js', folder: 'Chat & Extras' },
  { prefix: '/api/mobile-qr-auth', file: '../routes/mobileQRAuth.js', folder: 'Authentication' },
  { prefix: '/api/clients/:clientId/mobile/reels', file: '../routes/reel.js', folder: 'Engagement & Analytics' },
  { prefix: '/api/clients/:clientId/mobile/marketing', file: '../routes/marketing.js', folder: 'Engagement & Analytics' },
  { prefix: '/api/clients/:clientId/mobile/credit', file: '../routes/creditManagement.js', folder: 'Web Dashboard' },
  { prefix: '/api/clients/:clientId/mobile/scoreboard', file: '../routes/scoreboard.js', folder: 'Engagement & Analytics' },
  { prefix: '/api/subjectivetest/clients/:clientId', file: '../routes/subjectivetest.js', folder: 'Tests & Exams' },
  { prefix: '/api/objectivetest/clients/:clientId', file: '../routes/objectivetest.js', folder: 'Tests & Exams' },
  { prefix: '/api/objectivetest-questions/clients/:clientId', file: '../routes/objectivetestquestion.js', folder: 'Tests & Exams' },
  { prefix: '/api/subjectivetest-questions/clients/:clientId', file: '../routes/subjectivetestquestion.js', folder: 'Tests & Exams' },
  { prefix: '/api/clients/:clientId/homepage', file: '../routes/mainBookstore.js', folder: 'Books & Store' },
  { prefix: '/api/clients/:clientId/app-analytics', file: '../routes/appAnalytics.js', folder: 'Engagement & Analytics' },
  { prefix: '/api/clients/:clientId/workbooks', file: '../routes/workbooks.js', folder: 'Books & Store' },
  { prefix: '/api/clients/:clientId/paytm', file: '../routes/paytm.js', folder: 'Books & Store' },
  { prefix: '/api/clients/:clientId/telegram', file: '../routes/telegramroutes.js', folder: 'Engagement & Analytics' },
];

const groupedEndpoints = {};
let totalExtracted = 0;

clientRoutesMap.forEach(routeConfig => {
  try {
    const routerPath = path.join(__dirname, routeConfig.file);
    const router = require(routerPath);
    
    // express-list-endpoints can process an express router directly if we wrap it slightly, 
    // or we can pass the router object. Actually, passing a router directly works.
    const express = require('express');
    const dummyApp = express();
    dummyApp.use(routeConfig.prefix, router);
    
    const endpoints = listEndpoints(dummyApp);
    totalExtracted += endpoints.length;

    if (!groupedEndpoints[routeConfig.folder]) {
      groupedEndpoints[routeConfig.folder] = [];
    }

    endpoints.forEach(ep => {
      ep.methods.forEach(method => {
        groupedEndpoints[routeConfig.folder].push({
          method: method,
          path: ep.path
        });
      });
    });
  } catch (err) {
    console.error(`Failed to load ${routeConfig.file}:`, err.message);
  }
});

// Build Postman Collection JSON
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

  // Deduplicate endpoints inside folder (just in case)
  const uniqueEndpoints = [];
  const seen = new Set();
  
  groupedEndpoints[folderName].forEach(api => {
    const key = `${api.method}:${api.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueEndpoints.push(api);
    }
  });

  uniqueEndpoints.forEach(api => {
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

// Write JSON to file
const outputPath = path.join(__dirname, '../client_api_collection.json');
fs.writeFileSync(outputPath, JSON.stringify(collection, null, 2));

console.log(`Successfully generated Postman collection at: ${outputPath}`);
console.log(`Total Endpoint Combinations: ${collection.item.reduce((acc, folder) => acc + folder.item.length, 0)}`);
process.exit(0);
