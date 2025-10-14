const jwt = require('jsonwebtoken');
const Organization = require('../models/Organization');

function generateOrgToken(orgId) {
	return jwt.sign({ orgId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// Helpers
function slugify(name) {
	return String(name)
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-');
}

exports.register = async (req, res) => {
	try {
		const { name, authEmail, authPassword } = req.body;
		if (!name || !authEmail || !authPassword) {
			return res.status(400).json({ success: false, message: 'name, authEmail, authPassword are required' });
		}
		const existsEmail = await Organization.findOne({ authEmail });
		if (existsEmail) return res.status(400).json({ success: false, message: 'authEmail already in use' });
		const org = new Organization({ name,slug:slugify(name), authEmail, authPassword, status: 'active' });
		await org.save();
		const token = generateOrgToken(org._id);
		return res.status(201).json({ success: true, token, organization: { id: org._id, name: org.name, slug: org.slug, authEmail: org.authEmail } });
	} catch (error) {
		return res.status(400).json({ success: false, message: error.message });
	}
};

exports.login = async (req, res) => {
	try {
		const { authEmail, authPassword } = req.body;
		if (!authEmail || !authPassword) return res.status(400).json({ success: false, message: 'authEmail and authPassword are required' });
		const org = await Organization.findOne({ authEmail });
		if (!org) return res.status(401).json({ success: false, message: 'Invalid credentials' });
		const ok = await org.comparePassword(authPassword);
		if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });
		const token = generateOrgToken(org._id);
		return res.json({ success: true, token, organization: { id: org._id, name: org.name, slug: org.slug, authEmail: org.authEmail } });
	} catch (error) {
		return res.status(400).json({ success: false, message: error.message });
	}
};

exports.me = async (req, res) => {
	try {
		const org = req.organization;
		return res.json({ success: true, organization: { id: org._id, name: org.name, slug: org.slug, authEmail: org.authEmail, status: org.status } });
	} catch (error) {
		return res.status(400).json({ success: false, message: error.message });
	}
};


