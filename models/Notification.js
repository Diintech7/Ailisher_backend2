const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
	clientId: { type: String, index: true, required: true },
	createdBy: {
		type: mongoose.Schema.Types.ObjectId,
		ref: 'User',
		required: true,
		index: true
	},
	createdByRole: { type: String, enum: ['admin', 'client'], required: true },
	type: {
		type: String,
		enum: ['text', 'image', 'link', 'youtube', 'whatsapp'],
		default: 'text',
		index: true
	},
	title: { type: String, required: true },
	description: { type: String, default: '' },
	imageUrl: { type: String, default: '' },
	linkUrl: { type: String, default: '' },
	linkTitle: { type: String, default: '' },
	whatsappMessage: { type: String, default: '' },

	sendStatus: { type: String, enum: ['draft', 'scheduled', 'sent', 'failed'], default: 'draft', index: true },
	isTemplate: { type: Boolean, default: false },
	scheduledAt: { type: Date },
	sentAt: { type: Date },
	failedAt: { type: Date },
	failureReason: { type: String, default: '' },

	recipientUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MobileUser', index: true }],
	recipientSegments: [{ type: String }],

	stats: {
		totalRecipients: { type: Number, default: 0 },
		sentCount: { type: Number, default: 0 },
		readCount: { type: Number, default: 0 }
	}
}, { timestamps: true });

notificationSchema.index({ clientId: 1, sendStatus: 1, createdAt: -1 });
notificationSchema.index({ clientId: 1, isTemplate: 1 });

module.exports = mongoose.model('Notification', notificationSchema);