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
  generateOrgLoginToken,
  validateSuperadminToken,
  generateAdminLoginToken,
  updateAdmin,
  updateClient
} = require('../controllers/superadmincontroller');
const { verifySuperadminToken } = require('../middleware/auth');
const organizationController = require("../controllers/organizationController");

const router = express.Router();

router.post('/login', loginSuperadmin);

router.post('/register', registerSuperadmin);

router.get('/validate', verifySuperadminToken, validateSuperadminToken);

router.get('/getadmins', verifySuperadminToken, getadmins);

router.get('/getclients', verifySuperadminToken, getclients);

router.delete('/deleteadmin/:id', verifySuperadminToken, deleteadmin);

router.delete('/deleteclient/:id', verifySuperadminToken, deleteclient);

router.post('/registeradmin', verifySuperadminToken, registeradmin);

router.post('/registerclient', verifySuperadminToken, registerclient);

router.put('/admin/:id', verifySuperadminToken, updateAdmin);

router.put('/client/:id', verifySuperadminToken, updateClient);

// Organization management (superadmin)
router.post('/organizations',verifySuperadminToken, organizationController.createOrganization);
router.get('/organizations',verifySuperadminToken, organizationController.listOrganizations);
router.get('/organizations/:id',verifySuperadminToken, organizationController.getOrganization);
router.patch('/organizations/:id',verifySuperadminToken, organizationController.updateOrganization);
router.post('/organizations/:id/suspend',verifySuperadminToken, organizationController.suspendOrganization);
router.post('/organizations/:id/restore',verifySuperadminToken, organizationController.restoreOrganization);
router.post('/organization/:id/login-token',verifySuperadminToken, generateOrgLoginToken);
router.post('/admin/:id/login-token', verifySuperadminToken, generateAdminLoginToken);

module.exports = router;
