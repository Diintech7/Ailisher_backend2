const fs = require('fs');
const path = require('path');

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

function extractRoutes(router, currentPrefix = '') {
  let routes = [];
  if (!router || !router.stack) return routes;

  router.stack.forEach(layer => {
    if (layer.route) {
      let pathStr = layer.route.path;
      if (typeof pathStr !== 'string') {
        pathStr = String(pathStr);
      }
      
      // Some routes define path as '/' which means they append to prefix
      let fullPath = currentPrefix;
      if (pathStr && pathStr !== '/') {
        if (fullPath.endsWith('/') && pathStr.startsWith('/')) {
          fullPath = fullPath + pathStr.substring(1);
        } else if (!fullPath.endsWith('/') && !pathStr.startsWith('/')) {
          fullPath = fullPath + '/' + pathStr;
        } else {
          fullPath = fullPath + pathStr;
        }
      }

      const methods = Object.keys(layer.route.methods).filter(m => m !== '_all');
      routes.push({ path: fullPath, methods: methods.map(m => m.toUpperCase()) });
    } else if (layer.name === 'router' && layer.handle.stack) {
      // It's a nested router
      let subPrefix = currentPrefix;
      
      // Try to extract subpath if possible from regex
      if (layer.regexp && layer.regexp.source !== '^\\/?(?=\\/|$)') {
         // A simple heuristic for basic paths
         let match = layer.regexp.source.match(/\^\\\/([^\\\/?]+)/);
         if (match && match[1]) {
             subPrefix += '/' + match[1];
         }
      }

      routes = routes.concat(extractRoutes(layer.handle, subPrefix));
    }
  });
  return routes;
}

const groupedEndpoints = {};
let totalExtracted = 0;

clientRoutesMap.forEach(routeConfig => {
  try {
    const routerPath = path.join(__dirname, routeConfig.file);
    const router = require(routerPath);
    
    const endpoints = extractRoutes(router, routeConfig.prefix);
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

// Helpers for nested tree structure and sorting
function getAuthSubfolderAndOrder(method, path) {
  const normalizedPath = path.toLowerCase().replace(/\/+$/, '');
  
  const rules = [
    // Registration: Email & Password Flow
    { contains: '/onboarding/register-email-password', sub: 'Registration > Email & Password Flow', order: 1 },
    { contains: '/onboarding/verify-email-otp', sub: 'Registration > Email & Password Flow', order: 2 },
    { contains: '/onboarding/resend-email-otp', sub: 'Registration > Email & Password Flow', order: 3 },

    // Registration: Mobile OTP Flow
    { contains: '/onboarding/send-mobile-otp', sub: 'Registration > Mobile OTP Flow', order: 1 },
    { contains: '/onboarding/verify-mobile-otp', sub: 'Registration > Mobile OTP Flow', order: 2 },

    // Login: QR Code Login Flow
    { contains: 'mobile-qr-auth/check-user', sub: 'Login > QR Code Login Flow', order: 1 },
    { contains: 'mobile-qr-auth/send-otp', sub: 'Login > QR Code Login Flow', order: 2 },
    { contains: 'mobile-qr-auth/verify-otp', sub: 'Login > QR Code Login Flow', order: 3 },
    { contains: 'mobile-qr-auth', sub: 'Login > QR Code Login Flow', order: 4 },

    // Login: Mobile OTP Flow
    { contains: '/check-user', notContains: 'qr', sub: 'Login > Mobile OTP Flow', order: 1 },
    { contains: '/login', notContains: '/onboarding', sub: 'Login > Mobile OTP Flow', order: 2 },
    { contains: '/verify-login-otp', sub: 'Login > Mobile OTP Flow', order: 3 },
    { contains: '/resend-login-otp', sub: 'Login > Mobile OTP Flow', order: 4 },

    // Login: Email & Password Flow
    { contains: '/onboarding/login-email-password', sub: 'Login > Email & Password Flow', order: 1 },

    // Login: Mobile Onboarding OTP Flow
    { contains: '/onboarding/login-mobile', sub: 'Login > Mobile Onboarding OTP Flow', order: 1 },
    { contains: '/onboarding/verify-mobile-login-otp', sub: 'Login > Mobile Onboarding OTP Flow', order: 2 },

    // Login: Google Flow
    { contains: '/google-login', sub: 'Login > Google Flow', order: 1 },

    // User Profile
    { contains: '/profile', sub: 'User Profile', order: 1 },
    { contains: '/user-profile', sub: 'User Profile', order: 2 },

    // Forgot & Reset Password
    { contains: 'forgot-password-email-otp', sub: 'Forgot & Reset Password', order: 3 },
    { contains: 'reset-password-email-otp', sub: 'Forgot & Reset Password', order: 4 },
    { contains: 'forgot-password-email', sub: 'Forgot & Reset Password', order: 1 },
    { contains: 'reset-password-email', sub: 'Forgot & Reset Password', order: 2 },
    { contains: 'resend-password-reset-email-otp', sub: 'Forgot & Reset Password', order: 5 },
    { contains: 'resend-password-reset-email', sub: 'Forgot & Reset Password', order: 6 },

    // Sessions & Management
    { contains: '/logout', sub: 'Sessions & Management', order: 1 },
    { contains: '/delete-user', sub: 'Sessions & Management', order: 2 },
    { contains: '/bulk-check', sub: 'Sessions & Management', order: 3 },
    { contains: '/mobile-analytics', sub: 'Sessions & Management', order: 4 }
  ];

  for (const r of rules) {
    if (normalizedPath.includes(r.contains)) {
      if (r.notContains && normalizedPath.includes(r.notContains)) {
        continue;
      }
      return { subfolder: r.sub, order: r.order };
    }
  }

  return { subfolder: 'Other Auth', order: 99 };
}

function insertIntoTree(parentItemArray, subfolders, requestItem) {
  if (subfolders.length === 0) {
    parentItemArray.push(requestItem);
    return;
  }
  
  const currentSubfolder = subfolders[0];
  let existingFolder = parentItemArray.find(item => item.name === currentSubfolder && item.item);
  
  if (!existingFolder) {
    existingFolder = {
      name: currentSubfolder,
      item: []
    };
    parentItemArray.push(existingFolder);
  }
  
  insertIntoTree(existingFolder.item, subfolders.slice(1), requestItem);
}

const authSubfolderOrder = {
  'Registration': 1,
  'Login': 2,
  'User Profile': 3,
  'Forgot & Reset Password': 4,
  'Sessions & Management': 5,
  'Other Auth': 6
};

function sortTree(parentItemArray, isTopLevel = false) {
  if (!isTopLevel) {
    parentItemArray.sort((a, b) => {
      // If one is folder and one is request, folder first
      if (a.item && !b.item) return -1;
      if (!a.item && b.item) return 1;
      
      // If both are folders, use custom authSubfolderOrder or default to alphabetical
      if (a.item && b.item) {
        const orderA = authSubfolderOrder[a.name] || 99;
        const orderB = authSubfolderOrder[b.name] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      }
      
      // Both are requests: sort by their custom _order
      const orderA = a._order || 99;
      const orderB = b._order || 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
  }
  
  // Recursively sort children
  parentItemArray.forEach(item => {
    if (item.item) {
      sortTree(item.item, false);
    }
  });
}

function cleanTreeMetadata(parentItemArray) {
  parentItemArray.forEach(item => {
    delete item._order;
    if (item.item) {
      cleanTreeMetadata(item.item);
    }
  });
}

function getRequestBody(method, path) {
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
    return null;
  }
  
  const normalizedPath = path.toLowerCase().replace(/\/+$/, '');
  
  const rules = [
    { contains: '/auth/onboarding/register-email-password', body: { email: 'user@example.com', password: 'securePassword123' } },
    { contains: '/auth/onboarding/login-email-password', body: { email: 'user@example.com', password: 'securePassword123' } },
    { contains: '/auth/onboarding/verify-email-otp', body: { email: 'user@example.com', otp: '123456' } },
    { contains: '/auth/onboarding/resend-email-otp', body: { email: 'user@example.com' } },
    { contains: '/auth/onboarding/send-mobile-otp', body: { mobile: '9876543210' } },
    { contains: '/auth/onboarding/verify-mobile-otp', body: { mobile: '9876543210', otp: '123456' } },
    { contains: '/auth/onboarding/login-mobile', body: { mobile: '9876543210' } },
    { contains: '/auth/onboarding/verify-mobile-login-otp', body: { mobile: '9876543210', otp: '123456' } },
    { contains: '/auth/onboarding/forgot-password-email-otp', body: { email: 'user@example.com' } },
    { contains: '/auth/onboarding/reset-password-email-otp', body: { email: 'user@example.com', otp: '123456', newPassword: 'newSecurePassword123' } },
    { contains: '/auth/onboarding/forgot-password-email', body: { email: 'user@example.com' } },
    { contains: '/auth/onboarding/reset-password-email', body: { token: 'reset_token_here', newPassword: 'newSecurePassword123' } },
    { contains: '/auth/onboarding/resend-password-reset-email-otp', body: { email: 'user@example.com' } },
    { contains: '/auth/onboarding/resend-password-reset-email', body: { email: 'user@example.com' } },
    { contains: '/auth/resend-welcome-email', body: { email: 'user@example.com' } },

    { contains: '/auth/check-user', body: { mobile: '9876543210' } },
    { contains: '/auth/login', body: { mobile: '9876543210' } },
    { contains: '/auth/verify-login-otp', body: { mobile: '9876543210', otp: '123456' } },
    { contains: '/auth/resend-login-otp', body: { mobile: '9876543210' } },
    { contains: '/auth/google-login', body: { token: 'google_oauth_id_token_here' } },
    { contains: '/auth/bulk-check', body: { mobiles: ['9876543210', '9999988888'] } },
    
    { contains: '/auth/profile', body: { name: 'John Doe', classDegree: '12th', exams: ['UPSC'], languages: ['English'], state: 'Delhi', pincode: '110001' } },
    
    { contains: 'forgot-password-email-otp', body: { email: 'user@example.com' } },
    { contains: 'reset-password-email-otp', body: { email: 'user@example.com', otp: '123456', newPassword: 'newSecurePassword123' } },
    { contains: 'forgot-password-email', body: { email: 'user@example.com' } },
    { contains: 'reset-password-email', body: { token: 'reset_token_here', newPassword: 'newSecurePassword123' } },
    { contains: 'resend-password-reset-email-otp', body: { email: 'user@example.com' } },
    { contains: 'resend-password-reset-email', body: { email: 'user@example.com' } },
    
    { contains: 'mobile-qr-auth/clients', body: { mobile: '9876543210', otp: '123456', socketId: 'example_socket_id' } },
    
    { contains: '/organizations/register', body: { name: 'My Org', email: 'org@example.com', password: 'orgPassword123' } },
    { contains: '/organizations/login', body: { email: 'org@example.com', password: 'orgPassword123' } },
    { contains: '/organizations/clients/create', body: { clientKey: 'new_client_key', businessName: 'Client Business Name', supportEmail: 'support@example.com' } },
    { contains: '/organizations/clients', body: { clientKey: 'new_client_key', businessName: 'Client Business Name', supportEmail: 'support@example.com' } },
    
    { contains: '/mobile/cart', body: { bookId: '{{book_id}}', quantity: 1 } },
    { contains: '/mobile/reels', body: { title: 'My Reel', description: 'Reel Description', videoUrl: 'https://example.com/video.mp4' } }
  ];
  
  for (const r of rules) {
    if (normalizedPath.includes(r.contains)) {
      return {
        mode: 'raw',
        raw: JSON.stringify(r.body, null, 2),
        options: {
          raw: {
            language: 'json'
          }
        }
      };
    }
  }
  
  return {
    mode: 'raw',
    raw: '{\n  "key": "value"\n}',
    options: {
      raw: {
        language: 'json'
      }
    }
  };
}

// Create folders and items
Object.keys(groupedEndpoints).forEach(folderName => {
  const folderItem = {
    name: folderName,
    item: []
  };

  const uniqueEndpoints = [];
  const seen = new Set();
  
  groupedEndpoints[folderName].forEach(api => {
    // Normalize path slashes
    let normalizedPath = api.path.replace(/\/{2,}/g, '/');
    const key = `${api.method}:${normalizedPath}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueEndpoints.push({ ...api, path: normalizedPath });
    }
  });

function getFriendlyName(method, path) {
  const normalizedPath = path.toLowerCase().replace(/\/+$/, '');
  
  const exactMaps = {
    'post /api/clients/:clientid/mobile/auth/login': 'Mobile OTP',
    'post /api/clients/:clientid/mobile/auth/verify-login-otp': 'Mobile Otp Verify',
    'post /api/clients/:clientid/mobile/auth/resend-login-otp': 'Resend Mobile OTP',
    'post /api/clients/:clientid/mobile/auth/onboarding/register-email-password': 'Signup',
    'post /api/clients/:clientid/mobile/auth/onboarding/login-email-password': 'Login',
    'post /api/clients/:clientid/mobile/auth/onboarding/verify-email-otp': 'Verify Email Otp',
    'post /api/clients/:clientid/mobile/auth/onboarding/resend-email-otp': 'Resend Email Otp',
    'post /api/clients/:clientid/mobile/auth/delete-user': 'Delete Account',
    'post /api/clients/:clientid/mobile/auth/check-user': 'Check User',
    'post /api/clients/:clientid/mobile/auth/bulk-check': 'Bulk Check',
    'post /api/clients/:clientid/mobile/auth/profile': 'SetUp Profile',
    'get /api/clients/:clientid/mobile/auth/profile': 'Get Profile',
    'put /api/clients/:clientid/mobile/auth/profile': 'Update Profile',
    'post /api/clients/:clientid/mobile/auth/logout': 'Logout',
    'post /api/clients/:clientid/mobile/auth/google-login': 'Google Login',
    'post /api/clients/:clientid/mobile/auth/forgot-password-email': 'Forgot Password (Email Link)',
    'post /api/clients/:clientid/mobile/auth/reset-password-email': 'Reset Password (Email Link)',
    'post /api/clients/:clientid/mobile/auth/forgot-password-email-otp': 'Forgot Password (Email OTP)',
    'post /api/clients/:clientid/mobile/auth/reset-password-email-otp': 'Reset Password (Email OTP)',
    'post /api/clients/:clientid/mobile/auth/resend-password-reset-email': 'Resend Password Reset Email',
    'post /api/clients/:clientid/mobile/auth/resend-password-reset-email-otp': 'Resend Password Reset Email OTP',
    
    // Onboarding additional endpoints
    'post /api/clients/:clientid/mobile/auth/onboarding/send-mobile-otp': 'Send Mobile OTP',
    'post /api/clients/:clientid/mobile/auth/onboarding/verify-mobile-otp': 'Verify Mobile OTP',
    'post /api/clients/:clientid/mobile/auth/onboarding/login-mobile': 'Mobile Login',
    'post /api/clients/:clientid/mobile/auth/onboarding/verify-mobile-login-otp': 'Verify Mobile Login OTP',
    'post /api/clients/:clientid/mobile/auth/onboarding/forgot-password-email': 'Forgot Password Onboarding (Email Link)',
    'post /api/clients/:clientid/mobile/auth/onboarding/resend-password-reset-email': 'Resend Password Reset Email Onboarding',
    'post /api/clients/:clientid/mobile/auth/onboarding/reset-password-email': 'Reset Password Onboarding (Email Link)',
    'post /api/clients/:clientid/mobile/auth/onboarding/forgot-password-email-otp': 'Forgot Password Onboarding (Email OTP)',
    'post /api/clients/:clientid/mobile/auth/onboarding/resend-password-reset-email-otp': 'Resend Password Reset Email OTP Onboarding',
    'post /api/clients/:clientid/mobile/auth/onboarding/reset-password-email-otp': 'Reset Password Onboarding (Email OTP)',
    'post /api/clients/:clientid/mobile/auth/resend-welcome-email': 'Resend Welcome Email',
    
    // QR Code Login endpoints
    'post /api/mobile-qr-auth/clients/:clientid/qr/check-user': 'QR Check User',
    'post /api/mobile-qr-auth/clients/:clientid/qr/send-otp': 'QR Send OTP',
    'post /api/mobile-qr-auth/clients/:clientid/qr/verify-otp': 'QR Verify OTP',

    // Legacy profile endpoints
    'get /api/clients/:clientid/mobile/user-profile': 'Get User Profile (Legacy)',
    'get /api/clients/:clientid/mobile/user-profile/:userid': 'Get User Profile Detail (Legacy)',

    'post /api/organizations/register': 'Register Org',
    'post /api/organizations/login': 'Login Org',
    'get /api/organizations/me': 'Get Org Profile',
    'get /api/organizations/public/clients': 'Public List Clients',
    'post /api/organizations/clients': 'Add Client to Org',
    'get /api/organizations/clients': 'List Org Clients',
    'post /api/organizations/clients/create': 'Create Org Client',
    'patch /api/organizations/clients/:clientid': 'Update Org Client',
    'patch /api/organizations/clients/:clientid/toggle-status': 'Toggle Client Status',
    'delete /api/organizations/clients/:clientid': 'Delete Org Client',
    'post /api/organizations/clients/:id/login-token': 'Generate Client Login Token',
  };

  const key = `${method.toLowerCase()} ${normalizedPath}`;
  if (exactMaps[key]) {
    return exactMaps[key];
  }

  let segments = normalizedPath.split('/').filter(Boolean);
  segments = segments.filter(seg => 
    seg !== 'api' && 
    seg !== 'clients' && 
    seg !== 'client' && 
    seg !== 'mobile' && 
    seg !== ':clientid'
  );

  if (segments.length > 0) {
    const processedSegments = segments.map(seg => {
      if (seg.startsWith(':')) {
        return `by ${seg.substring(1).toUpperCase()}`;
      }
      return seg.split(/[-_]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    });
    
    let nameStr = processedSegments.join(' ');
    nameStr = nameStr.replace(/by ID/gi, 'Detail');
    return nameStr;
  }

  return path;
}

  uniqueEndpoints.forEach(api => {
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
    
    const cleanPath = rawPath.startsWith('/') ? rawPath.substring(1) : rawPath;
    const pathSegments = cleanPath.split('/');

    const requestItem = {
      name: getFriendlyName(api.method, api.path),
      _order: 99,
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

    const requestBody = getRequestBody(api.method, api.path);
    if (requestBody) {
      requestItem.request.body = requestBody;
    }
    
    if (folderName === 'Authentication') {
      const rule = getAuthSubfolderAndOrder(api.method, api.path);
      requestItem._order = rule.order;
      
      const subfolders = rule.subfolder.split(' > ');
      insertIntoTree(folderItem.item, subfolders, requestItem);
    } else {
      folderItem.item.push(requestItem);
    }
  });

  collection.item.push(folderItem);
});

// Post-process the collection: Sort and clean up temporary sorting order property
sortTree(collection.item, true);
cleanTreeMetadata(collection.item);

// Write JSON to file
const outputPath = path.join(__dirname, '../client_api_collection.json');
fs.writeFileSync(outputPath, JSON.stringify(collection, null, 2));

console.log(`Successfully generated Postman collection at: ${outputPath}`);
console.log(`Total Endpoint Combinations: ${collection.item.reduce((acc, folder) => {
  const countItems = (items) => {
    let count = 0;
    items.forEach(i => {
      if (i.item) count += countItems(i.item);
      else count++;
    });
    return count;
  };
  return acc + countItems(folder.item);
}, 0)}`);
process.exit(0);
