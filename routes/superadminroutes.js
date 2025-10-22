const express = require('express');
const { 
  loginSuperadmin, 
  registerSuperadmin, 
  getadmins, 
  getclients, 
  deleteadmin, 
  deleteclient,
  registeradmin,
  registerclient,
  generateOrgLoginToken
} = require('../controllers/superadmincontroller');
const { verifySuperadminToken } = require('../middleware/auth');
const organizationController = require("../controllers/organizationController");

const router = express.Router();

router.post('/login', loginSuperadmin);

router.post('/register', registerSuperadmin);

router.get('/getadmins', getadmins);

router.get('/getclients', getclients);

router.delete('/deleteadmin/:id', deleteadmin);

router.delete('/deleteclient/:id', deleteclient);

router.post('/registeradmin', registeradmin);

router.post('/registerclient', registerclient);

// Organization management (superadmin)
router.post('/organizations',verifySuperadminToken, organizationController.createOrganization);
router.get('/organizations',verifySuperadminToken, organizationController.listOrganizations);
router.get('/organizations/:id',verifySuperadminToken, organizationController.getOrganization);
router.patch('/organizations/:id',verifySuperadminToken, organizationController.updateOrganization);
router.post('/organizations/:id/suspend',verifySuperadminToken, organizationController.suspendOrganization);
router.post('/organizations/:id/restore',verifySuperadminToken, organizationController.restoreOrganization);
router.post('/organization/:id/login-token',verifySuperadminToken, generateOrgLoginToken);

module.exports = router;
