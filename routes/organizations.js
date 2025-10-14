const express = require('express');
const router = express.Router();
const orgAuthController = require('../controllers/orgAuthController');
const organizationController = require('../controllers/organizationController');
const { verifyOrganizationToken } = require('../middleware/orgAuth');

// Auth
router.post('/register', orgAuthController.register);
router.post('/login', orgAuthController.login);
router.get('/me', verifyOrganizationToken, orgAuthController.me);

// Public: list clients by organization identifier (slug or name)
router.get('/public/clients', async (req, res) => {
  return organizationController.listClientsByIdentifier(req, res);
});

// Self-serve membership management for the authenticated organization
router.get('/clients', verifyOrganizationToken, async (req, res) => {
	return organizationController.listClients(req, res);
});

router.post('/clients', verifyOrganizationToken, async (req, res) => {
	return organizationController.addClient(req, res);
});

// Create a brand new Client and attach to this organization
router.post('/clients/create', verifyOrganizationToken, async (req, res) => {
	return organizationController.createClient(req, res);
});

router.patch('/clients/:clientId', verifyOrganizationToken, async (req, res) => {
	return organizationController.updateClient(req, res);
});

router.delete('/clients/:clientId', verifyOrganizationToken, async (req, res) => {
	return organizationController.removeClient(req, res);
});

module.exports = router;


