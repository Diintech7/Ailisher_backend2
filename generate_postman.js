const fs = require('fs');
const path = require('path');

const BASE_URL = '{{base_url}}';

// All routes from server.js mapping
const routeMappings = [
  { prefix: '/api/auth', file: 'auth' },
  { prefix: '/api/admin', file: 'admin' },
  { prefix: '/api/client', file: 'client' },
  { prefix: '/api/user', file: 'user' },
  { prefix: '/api/books', file: 'books' },
  { prefix: '/api/books', file: 'book-chapters' },
  { prefix: '/api/books', file: 'pdfSplits' },
  { prefix: '/api/categories', file: 'categories' },
  { prefix: '/api/subtopics', file: 'subtopics' },
  { prefix: '/api/assets', file: 'assets' },
  { prefix: '/api/video-assets', file: 'videoAssets' },
  { prefix: '/api/pyq-assets', file: 'pyqAssets' },
  { prefix: '/api/subjective-assets', file: 'subjectiveAssets' },
  { prefix: '/api/objective-assets', file: 'objectiveAssets' },
  { prefix: '/api/workbooks', file: 'workbooks' },
  { prefix: '/api/qrcode', file: 'qrcode' },
  { prefix: '/api/aiswb', file: 'aiswb' },
  { prefix: '/api/aiswb', file: 'evaluations' },
  { prefix: '/api/myquestion', file: 'myquestion' },
  { prefix: '/api/r2', file: 'r2Assets' },
  { prefix: '/api/userAnswers', file: 'userAnswers' },
  { prefix: '/api/answerapis', file: 'answerapis' },
  { prefix: '/api/admin/answers', file: 'adminAnswers' },
  { prefix: '/api/mybooks', file: 'myBooks' },
  { prefix: '/api/myworkbooks', file: 'myworkbook' },
  { prefix: '/api/evaluators', file: 'evaluators' },
  { prefix: '/api/evaluator', file: 'evaluatorCredit' },
  { prefix: '/api/evaluator-reviews', file: 'evaluatorReviews' },
  { prefix: '/api/review', file: 'expertReview' },
  { prefix: '/api/review', file: 'reviewRequests' },
  { prefix: '/api/homepage', file: 'mainBookstore' },
  { prefix: '/api/book', file: 'Course' },
  { prefix: '/api/pdf-embedding', file: 'pdfEmbedding' },
  { prefix: '/api/pdf-chat', file: 'pdfChat' },
  { prefix: '/api/youtube', file: 'youtube' },
  { prefix: '/api/subjectivetests', file: 'subjectivetest' },
  { prefix: '/api/objectivetests', file: 'objectivetest' },
  { prefix: '/api/objectivetest-questions', file: 'objectivetestquestion' },
  { prefix: '/api/subjectivetest-questions', file: 'subjectivetestquestion' },
  { prefix: '/api/test-results', file: 'testResults' },
  { prefix: '/api/paytm', file: 'paytm' },
  { prefix: '/api/reels', file: 'reel' },
  { prefix: '/api/marketing', file: 'marketing' },
  { prefix: '/api/image-generator', file: 'ImageGenerator' },
  { prefix: '/api/questionbank', file: 'questionbank' },
  { prefix: '/api/aicourses', file: 'aicourses' },
  { prefix: '/api/credit', file: 'creditManagement' },
  { prefix: '/api/whatsapp', file: 'whatsappOtp' },
  { prefix: '/api/notifications', file: 'notifications' },
  { prefix: '/api/organizations', file: 'organizations' },
  { prefix: '/api/superadmin', file: 'superadminroutes' },
  { prefix: '/api/live-classes', file: 'liveClasses' },
  { prefix: '/api/admin/banners', file: 'adminBanners' },
  { prefix: '/api/app-analytics', file: 'appAnalytics' },
  { prefix: '/api/app-analytics', file: 'userAnalytics' },
  { prefix: '/api/ai', file: 'aiServiceConfig' },
  { prefix: '/api/aiguidelines', file: 'aiguidelines' },
  { prefix: '/api/datastores', file: 'datastores' },
  { prefix: '/api/datastore', file: 'datastore' },
  { prefix: '/api/mobile/public-chat', file: 'mobilePublicChat' },
  { prefix: '/api/mobile/public-chat', file: 'mobilePDFChat' },
  { prefix: '/api/mobile-qr-auth', file: 'mobileQRAuth' },
  { prefix: '/api/clients/:clientId/mobile/auth', file: 'mobileAuth' },
  { prefix: '/api/clients/:clientId/mobile/books', file: 'mobileBooks' },
  { prefix: '/api/clients/:clientId/mobile/banners', file: 'mobileBanners' },
  { prefix: '/api/clients/:clientId/mobile/userAnswers', file: 'userAnswer1' },
  { prefix: '/api/clients/:clientId/mobile/submitted-answers', file: 'mobileSubmittedAnswers' },
  { prefix: '/api/clients/:clientId/mobile/reels', file: 'reel' },
  { prefix: '/api/clients/:clientId/mobile/review', file: 'mobileReviews' },
  { prefix: '/api/clients/:clientId/paytm', file: 'paytm' },
  { prefix: '/api/clients/:clientId/telegram', file: 'telegramroutes' },
  { prefix: '/api/clients/:clientId/homepage', file: 'mainBookstore' },
  { prefix: '/api/scoreboard', file: 'scoreboard' },
  { prefix: '/api/pdf', file: 'pdf' },
  { prefix: '/api/pdf-processing', file: 'pdf-processing' },
  { prefix: '/api/pdfAssets', file: 'pdfAssets' },
  { prefix: '/api/SubTopic', file: 'SubTopic' },
  { prefix: '/api/manual', file: 'manual' },
  { prefix: '/api/aiswb-qr', file: 'aiswbQR' },
  { prefix: '/api/config', file: 'config' },
  { prefix: '/api/aiswb/sets', file: 'aiswbQR' },
  { prefix: '/api/answer-sheets', file: 'answerSheets' },
];

const routesDir = path.join(__dirname, 'routes');

// Extract endpoints from a route file content
function extractEndpoints(content, prefix, fileName) {
  const endpoints = [];
  const methodPattern = /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  let match;

  while ((match = methodPattern.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];
    const fullPath = prefix + (routePath === '/' ? '' : routePath);

    endpoints.push({
      method,
      path: fullPath,
      name: buildName(method, routePath, prefix),
    });
  }
  return endpoints;
}

function buildName(method, routePath, prefix) {
  const parts = (prefix + routePath)
    .replace('/api/', '')
    .split('/')
    .filter(Boolean)
    .map(p => p.startsWith(':') ? `{${p.slice(1)}}` : p);
  return `${method} ${parts.join(' > ')}`;
}

function buildRequest(method, fullPath) {
  const url = BASE_URL + fullPath;
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);

  // Sample body based on path keywords
  let bodyExample = {};
  if (fullPath.includes('login')) bodyExample = { email: 'user@example.com', password: 'password123' };
  else if (fullPath.includes('register')) bodyExample = { name: 'Test User', email: 'user@example.com', password: 'password123' };
  else if (fullPath.includes('book')) bodyExample = { title: 'Sample Book', description: 'Book description', clientId: '{{client_id}}' };
  else if (fullPath.includes('evaluator')) bodyExample = { name: 'Evaluator Name', email: 'eval@example.com', phoneNumber: '9876543210' };
  else if (fullPath.includes('credit')) bodyExample = { amount: 100, userId: '{{user_id}}' };
  else if (fullPath.includes('question')) bodyExample = { questionText: 'Sample question?', marks: 5 };
  else if (fullPath.includes('withdraw')) bodyExample = { amount: 500, withdrawalMethod: 'bank_transfer', adminComments: 'Approved' };
  else if (fullPath.includes('paytm')) bodyExample = { amount: 999, customerEmail: 'user@example.com', customerPhone: '9876543210', customerName: 'Test User' };
  else bodyExample = { key: 'value' };

  const item = {
    name: `${method} ${fullPath}`,
    request: {
      method,
      header: [
        { key: 'Content-Type', value: 'application/json' },
        { key: 'Authorization', value: 'Bearer {{token}}' },
      ],
      url: {
        raw: url,
        host: ['{{base_url}}'],
        path: fullPath.replace(/^\//, '').split('/'),
      },
    },
    response: [],
  };

  if (hasBody) {
    item.request.body = {
      mode: 'raw',
      raw: JSON.stringify(bodyExample, null, 2),
      options: { raw: { language: 'json' } },
    };
  }

  return item;
}

// Group endpoints by module name
function getModuleName(prefix) {
  const p = prefix.replace('/api/', '').split('/')[0];
  const map = {
    'auth': '01 - Auth',
    'admin': '02 - Admin',
    'client': '03 - Client',
    'user': '04 - User',
    'books': '05 - Books',
    'book': '05 - Books',
    'workbooks': '06 - Workbooks',
    'categories': '07 - Categories',
    'subtopics': '08 - Subtopics',
    'SubTopic': '08 - Subtopics',
    'assets': '09 - Assets',
    'video-assets': '09 - Assets',
    'pyq-assets': '09 - Assets',
    'subjective-assets': '09 - Assets',
    'objective-assets': '09 - Assets',
    'pdfAssets': '09 - Assets',
    'r2': '10 - R2 Storage',
    'aiswb': '11 - AISWB',
    'aiswb-qr': '11 - AISWB',
    'aiswbQR': '11 - AISWB',
    'qrcode': '12 - QR Codes',
    'evaluators': '13 - Evaluators',
    'evaluator': '13 - Evaluators',
    'evaluator-reviews': '13 - Evaluators',
    'review': '14 - Reviews',
    'userAnswers': '15 - User Answers',
    'answerapis': '15 - User Answers',
    'admin': '16 - Admin Answers',
    'myquestion': '17 - My Questions',
    'questionbank': '18 - Question Bank',
    'mybooks': '19 - My Books',
    'myworkbooks': '19 - My Books',
    'pdf-embedding': '20 - PDF & Chat',
    'pdf-chat': '20 - PDF & Chat',
    'pdf': '20 - PDF & Chat',
    'pdf-processing': '20 - PDF & Chat',
    'mobile': '21 - Mobile',
    'clients': '21 - Mobile',
    'mobile-qr-auth': '21 - Mobile',
    'aicourses': '22 - AI Courses',
    'credit': '23 - Credits',
    'paytm': '24 - Payments',
    'reels': '25 - Reels',
    'marketing': '26 - Marketing',
    'image-generator': '27 - Image Generator',
    'live-classes': '28 - Live Classes',
    'notifications': '29 - Notifications',
    'organizations': '30 - Organizations',
    'superadmin': '31 - Superadmin',
    'app-analytics': '32 - Analytics',
    'ai': '33 - AI Services',
    'aiguidelines': '33 - AI Services',
    'datastores': '34 - Datastores',
    'datastore': '34 - Datastores',
    'whatsapp': '35 - WhatsApp OTP',
    'youtube': '36 - YouTube',
    'subjectivetests': '37 - Tests',
    'objectivetests': '37 - Tests',
    'objectivetest-questions': '37 - Tests',
    'subjectivetest-questions': '37 - Tests',
    'test-results': '37 - Tests',
    'homepage': '38 - Bookstore',
    'scoreboard': '39 - Scoreboard',
    'config': '40 - Config',
    'manual': '41 - Manual',
    'answer-sheets': '42 - Answer Sheets',
    'telegram': '43 - Telegram',
  };
  return map[p] || `99 - ${p}`;
}

// Main build
const folders = {};

for (const mapping of routeMappings) {
  const filePath = path.join(routesDir, mapping.file + '.js');
  if (!fs.existsSync(filePath)) continue;

  const content = fs.readFileSync(filePath, 'utf8');
  const endpoints = extractEndpoints(content, mapping.prefix, mapping.file);

  const folderName = getModuleName(mapping.prefix);
  if (!folders[folderName]) folders[folderName] = [];

  for (const ep of endpoints) {
    // Avoid duplicates
    const exists = folders[folderName].find(
      i => i.request.method === ep.method && i.request.url.raw === BASE_URL + ep.path
    );
    if (!exists) {
      folders[folderName].push(buildRequest(ep.method, ep.path));
    }
  }
}

// Build collection
const collection = {
  info: {
    name: 'Ailishar Platform - Complete API Collection',
    description: 'Full API collection for Ailishar backend. Base URL: http://localhost:4000\n\nVariables:\n- base_url: http://localhost:4000\n- token: <your JWT token>\n- client_id: <your client ID>\n- user_id: <user ObjectId>',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'base_url', value: 'http://localhost:4000', type: 'string' },
    { key: 'token', value: '', type: 'string' },
    { key: 'client_id', value: '', type: 'string' },
    { key: 'user_id', value: '', type: 'string' },
    { key: 'book_id', value: '', type: 'string' },
    { key: 'chapter_id', value: '', type: 'string' },
    { key: 'topic_id', value: '', type: 'string' },
    { key: 'evaluator_id', value: '', type: 'string' },
    { key: 'question_id', value: '', type: 'string' },
    { key: 'set_id', value: '', type: 'string' },
    { key: 'workbook_id', value: '', type: 'string' },
  ],
  item: Object.entries(folders)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folderName, items]) => ({
      name: folderName,
      item: items,
    })),
};

const outputPath = path.join(__dirname, 'ailisher_collection.json');
fs.writeFileSync(outputPath, JSON.stringify(collection, null, 2));

const totalEndpoints = Object.values(folders).reduce((sum, items) => sum + items.length, 0);
const totalFolders = Object.keys(folders).length;

console.log('✅ Postman Collection generated successfully!');
console.log(`📁 Total Folders (Modules): ${totalFolders}`);
console.log(`🔗 Total API Endpoints: ${totalEndpoints}`);
console.log(`📄 File saved: ailisher_collection.json`);
console.log('');
console.log('📌 How to import:');
console.log('   1. Open Postman');
console.log('   2. Click Import button');
console.log('   3. Select ailisher_collection.json file');
console.log('   4. Set base_url variable to: http://localhost:4000');
