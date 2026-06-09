// middleware/mobileAuth.js - Improved version
const jwt = require('jsonwebtoken');
const MobileUser = require('../models/MobileUser');
const User = require('../models/User');
const OrgClient = require('../models/OrgClient');

// Generate JWT token
const generateToken = (userId, mobile, clientId) => {
  return jwt.sign(
    { 
      id: userId, 
      mobile: mobile,
      clientId: clientId,
      type: 'mobile' 
    },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
};

// (Removed) MobileEmailUser auth: we now use MobileUser for both email+mobile.

// Authenticate mobile user
const authenticateMobileUser = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
        error: {
          code: 'NO_TOKEN',
          details: 'Authorization header with Bearer token is required'
        }
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      // console.log("decoded", decoded)
    } catch (jwtError) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token.',
        error: {
          code: 'INVALID_TOKEN',
          details: jwtError.message
        }
      });
    }
    
    if (decoded.type !== 'mobile') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type.',
        error: {
          code: 'INVALID_TOKEN_TYPE',
          details: 'This endpoint requires a mobile user token'
        }
      });
    }

    // Check if user exists and token matches
    const user = await MobileUser.findOne({
      _id: decoded.id,
      authToken: token
    });
    // console.log(user)
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token or user not found.',
        error: {
          code: 'USER_NOT_FOUND',
          details: 'User associated with this token does not exist or token has been revoked'
        }
      });
    }

    // Verify client ID from URL matches user's client
    const clientIdFromUrl = req.params.clientId || req.clientId;
    if (clientIdFromUrl && user.clientId !== clientIdFromUrl) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Client mismatch.',
        error: {
          code: 'CLIENT_MISMATCH',
          details: `User belongs to client ${user.clientId} but trying to access ${clientIdFromUrl}`
        }
      });
    }
    // Set user information in request
    req.user = {
      id: user._id,
      mobile: user.mobile,
      clientId: user.clientId,
      userId: user.clientId,
      isAuthenticated: true
    };

    console.log('Mobile user authenticated:', {
      userId: req.user.id,
      mobile: req.user.mobile,
      clientId: req.user.clientId
    });

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.',
      error: {
        code: 'AUTH_SERVER_ERROR',
        details: error.message
      }
    });
  }
};

// Authenticate mobile user
const authenticateUser = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    console.log(token)
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
        error: {
          code: 'NO_TOKEN',
          details: 'Authorization header with Bearer token is required'
        }
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token.',
        error: {
          code: 'INVALID_TOKEN',
          details: jwtError.message
        }
      });
    }
    
    if (decoded.type !== 'mobile') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type.',
        error: {
          code: 'INVALID_TOKEN_TYPE',
          details: 'This endpoint requires a mobile user token'
        }
      });
    }

    // Check if user exists and token matches
    const user = await MobileUser.findOne({
      _id: decoded.id,
      authToken: token
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token or user not found.',
        error: {
          code: 'USER_NOT_FOUND',
          details: 'User associated with this token does not exist or token has been revoked'
        }
      });
    }
    // Set user information in request
    req.user = {
      id: user._id,
      mobile: user.mobile,
      clientId: user.clientId,
      userId: user.clientId,
      isAuthenticated: true
    };

    console.log('Mobile user authenticated:', {
      userId: req.user.id,
      mobile: req.user.mobile,
      clientId: req.user.clientId
    });

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.',
      error: {
        code: 'AUTH_SERVER_ERROR',
        details: error.message
      }
    });
  }
};

// Check client access middleware
const checkClientAccess = (allowedClients = []) => {
  return async (req, res, next) => {
    try {
      const clientId = req.params.clientId || req.clientId;
      
      console.log('Checking client access for:', clientId);
      console.log('Request URL:', req.originalUrl);
      
      if (!clientId) {
        return res.status(400).json({
          success: false,
          message: 'Client ID is required.',
          error: {
            code: 'MISSING_CLIENT_ID',
            details: 'Client ID must be provided in the URL path'
          }
        });
      }

      // Validate client exists and is active
      let client = await User.findOne({
        userId: clientId,
        role: 'client',
        status: 'active'
      });

      if(!client)
      {
        client = await OrgClient.findOne({
          userId: clientId,
          role: 'client',
          status: 'active'
        });
      }

      if (!client) {
        return res.status(400).json({
          success: false,
          message: 'Invalid client ID or client is not active.',
          error: {
            code: 'INVALID_CLIENT',
            details: `Client with ID ${clientId} not found or is not active`
          }
        });
      }

      // Add client info to request
      req.user = client;
      req.clientId = clientId;
      req.clientInfo = {
        id: client._id,
        userId: client.userId,
        businessName: client.businessName,
        businessOwnerName: client.businessOwnerName,
        status: client.status
      };

      // Check feature access based on requested URL path (to support mobile app feature gating)
      if (client.allowedFeatures) {
        const url = req.originalUrl.toLowerCase();
        
        // Map URLs to their respective feature keys
        const featureMapping = [
          { path: '/classroom-exams', key: 'aiClassroom', defaultResponse: { success: true, exams: [] } },
          { path: '/books', key: 'aiBooks', defaultResponse: { success: true, books: [] } },
          { path: '/workbooks', key: 'aiWorkbook', defaultResponse: { success: true, workbooks: [] } },
          { path: '/objectivetests', key: 'aiTests', defaultResponse: { success: true, tests: [] } },
          { path: '/subjectivetests', key: 'aiTests', defaultResponse: { success: true, tests: [] } },
          { path: '/aicourses', key: 'aiCourses', defaultResponse: { success: true, data: [] } },
          { path: '/questionbank', key: 'questionBank', defaultResponse: { success: true, data: [] } },
          { path: '/myquestion', key: 'myQuestion', defaultResponse: { success: true, data: [] } },
          { path: '/datastore', key: 'datastore', defaultResponse: { success: true, data: [] } },
          { path: '/reels', key: 'toolReels', defaultResponse: { success: true, count: 0, data: [] } },
          { path: '/image-generator', key: 'toolImageGenerator', defaultResponse: { success: true, data: [] } }
        ];

        for (const mapping of featureMapping) {
          const isAllowed = typeof client.allowedFeatures.get === 'function'
            ? client.allowedFeatures.get(mapping.key)
            : client.allowedFeatures[mapping.key];

          if (url.includes(mapping.path) && isAllowed === false) {
            console.log(`Access denied to disabled feature: ${mapping.key} for client: ${clientId}`);
            return res.json(mapping.defaultResponse);
          }
        }
      }

      console.log('Client access granted for:', client.businessName);
      next();
    } catch (error) {
      console.error('Client access check error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error during client validation.',
        error: {
          code: 'CLIENT_CHECK_ERROR',
          details: error.message
        }
      });
    }
  };
};

// Middleware to ensure user belongs to the client (additional security)
const ensureUserBelongsToClient = async (req, res, next) => {
  try {
    if (!req.user || !req.user.isAuthenticated) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated.',
        error: {
          code: 'NOT_AUTHENTICATED',
          details: 'This middleware requires user to be authenticated first'
        }
      });
    }

    const clientId = req.params.clientId || req.clientId;
    
    if (req.user.clientId !== clientId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. User does not belong to this client.',
        error: {
          code: 'CLIENT_USER_MISMATCH',
          details: `User belongs to client ${req.user.clientId} but trying to access ${clientId}`
        }
      });
    }

    next();
  } catch (error) {
    console.error('User-client verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during user-client verification.',
      error: {
        code: 'USER_CLIENT_CHECK_ERROR',
        details: error.message
      }
    });
  }
};
// Add new middleware for QR code authentication
const authenticateQRCode = async (req, res, next) => {
  try {
    const token = req.query.token || req.headers['x-qr-token'];
    
    if (!token) {
      return next(); // Not a QR code auth request
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      return res.status(401).json({ error: 'Invalid QR token' });
    }

    if (decoded.type !== 'qr') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    // QR tokens are short-lived (5 minutes)
    if (decoded.exp < Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ error: 'QR token expired' });
    }

    // Set QR authentication in request
    req.qrAuth = {
      isAuthenticated: true,
      questionId: decoded.questionId,
      clientId: decoded.clientId
    };

    next();
  } catch (error) {
    console.error('QR authentication error:', error);
    next(); // Continue without failing
  }
};

module.exports = {
  generateToken,
  authenticateMobileUser,
  checkClientAccess,
  ensureUserBelongsToClient,
  authenticateQRCode,
  authenticateUser
};