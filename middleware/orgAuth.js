const jwt = require('jsonwebtoken');
const Organization = require('../models/Organization');

exports.verifyOrganizationToken = async (req, res, next) => {
	try {
		const authHeader = req.headers.authorization;
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return res.status(401).json({ success: false, message: 'No token provided' });
		}
		const token = authHeader.split(' ')[1];
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		const org = await Organization.findById(decoded.orgId);
		if (!org) return res.status(401).json({ success: false, message: 'Invalid token' });
		req.org = org;
		return next();
	} catch (error) {
		return res.status(401).json({ success: false, message: 'Invalid token' });
	}
};


