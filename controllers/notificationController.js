const Notification = require('../models/Notification');
const MobileUser = require('../models/MobileUser');

// Build recipients from userIds or segments (MVP: userIds only; segments reserved)
async function resolveRecipients({ clientId, userIds = [], segments = [] }) {
	if (userIds && userIds.length > 0) {
		return await MobileUser.find({ _id: { $in: userIds }, clientId }).select('_id');
	}
	// Future: resolve segments
	if (segments && segments.length > 0) {
		return [];
	}
	return [];
}

exports.createDraft = async (req, res) => {
	try {
		const clientId = req.params.clientId || req.body.clientId;
		const createdBy = (req.user && (req.user._id || req.user.id)) || req.admin?._id;
		const createdByRole = req.admin ? 'admin' : 'client';

		const {
			type = 'text',
			title,
			description = '',
			imageUrl = '',
			linkUrl = '',
			linkTitle = '',
			whatsappMessage = '',
			isTemplate = false
		} = req.body;

		if (!clientId) return res.status(400).json({ success: false, message: 'clientId required' });
		if (!title) return res.status(400).json({ success: false, message: 'title required' });

		const notification = await Notification.create({
			clientId,
			createdBy,
			createdByRole,
			type,
			title,
			description,
			imageUrl,
			linkUrl,
			linkTitle,
			whatsappMessage,
			sendStatus: 'draft',
			isTemplate
		});

		return res.status(201).json({ success: true, data: notification });
	} catch (error) {
		console.error('createDraft error:', error);
		return res.status(500).json({ success: false, message: 'Failed to create draft', error: error.message });
	}
};

exports.updateDraft = async (req, res) => {
	try {
		const { id } = req.params;
		const updates = req.body;
		const allowed = ['type', 'title', 'description', 'imageUrl', 'linkUrl', 'linkTitle', 'whatsappMessage', 'isTemplate', 'scheduledAt'];
		const payload = {};
		for (const k of allowed) if (k in updates) payload[k] = updates[k];

		const notification = await Notification.findOneAndUpdate({ _id: id, sendStatus: { $in: ['draft', 'scheduled'] } }, payload, { new: true });
		if (!notification) return res.status(404).json({ success: false, message: 'Draft not found' });
		return res.json({ success: true, data: notification });
	} catch (error) {
		console.error('updateDraft error:', error);
		return res.status(500).json({ success: false, message: 'Failed to update draft', error: error.message });
	}
};

exports.list = async (req, res) => {
	try {
		const clientId = req.params.clientId || req.query.clientId;
		const { status, isTemplate, page = 1, limit = 20 } = req.query;
		if (!clientId) return res.status(400).json({ success: false, message: 'clientId required' });

		const filter = { clientId };
		if (status) filter.sendStatus = status;
		if (typeof isTemplate !== 'undefined') filter.isTemplate = isTemplate === 'true' || isTemplate === true;

		const docs = await Notification.find(filter)
			.sort({ createdAt: -1 })
			.skip((parseInt(page) - 1) * parseInt(limit))
			.limit(parseInt(limit));
		const total = await Notification.countDocuments(filter);
		return res.json({ success: true, data: docs, total });
	} catch (error) {
		console.error('list notifications error:', error);
		return res.status(500).json({ success: false, message: 'Failed to list notifications', error: error.message });
	}
};

exports.send = async (req, res) => {
	try {
		const { id } = req.params;
		const clientId = req.params.clientId || req.body.clientId;
		const { userIds = [], segments = [] } = req.body;
		if (!clientId) return res.status(400).json({ success: false, message: 'clientId required' });

		const draft = await Notification.findOne({ _id: id, clientId });
		if (!draft) return res.status(404).json({ success: false, message: 'Notification not found' });
		if (draft.sendStatus === 'sent') return res.status(400).json({ success: false, message: 'Already sent' });

		const recipients = await resolveRecipients({ clientId, userIds, segments });
		draft.recipientUserIds = recipients.map(r => r._id);
		draft.stats.totalRecipients = draft.recipientUserIds.length;
		draft.sendStatus = 'sent';
		draft.sentAt = new Date();
		await draft.save();

		return res.json({ success: true, data: draft });
	} catch (error) {
		console.error('send notification error:', error);
		return res.status(500).json({ success: false, message: 'Failed to send notification', error: error.message });
	}
};

// For a given mobile user, fetch notifications addressed to them
exports.listForUser = async (req, res) => {
	try {
		const userId = req.user.id;
		const clientId = req.user.clientId;
		const { page = 1, limit = 20 } = req.query;

		const filter = {
			clientId,
			sendStatus: 'sent',
			recipientUserIds: userId
		};

		const docs = await Notification.find(filter)
			.sort({ createdAt: -1 })
			.skip((parseInt(page) - 1) * parseInt(limit))
			.limit(parseInt(limit))
			.lean();

		return res.json({ success: true, data: docs });
	} catch (error) {
		console.error('listForUser error:', error);
		return res.status(500).json({ success: false, message: 'Failed to get notifications', error: error.message });
	}
};

// Mark read increments readCount; in production track per-user read state in separate collection
exports.markRead = async (req, res) => {
	try {
		const { id } = req.params;
		const notif = await Notification.findById(id);
		if (!notif) return res.status(404).json({ success: false, message: 'Notification not found' });
		// Naive increment to keep it simple
		notif.stats.readCount = (notif.stats.readCount || 0) + 1;
		await notif.save();
		return res.json({ success: true });
	} catch (error) {
		console.error('markRead error:', error);
		return res.status(500).json({ success: false, message: 'Failed to mark read', error: error.message });
	}
};



