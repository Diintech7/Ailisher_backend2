const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const OrganizationSchema = new mongoose.Schema({
	// Identity
	name: {
		type: String,
		required: true,
		trim: true
	},
	slug: {
		type: String,
		required: true,
		unique: true,
		lowercase: true,
		trim: true
	},

	// Lifecycle
	status: {
		type: String,
		enum: ['active', 'suspended', 'deleted'],
		default: 'active',
		index: true
	},
	isDeleted: {
		type: Boolean,
		default: false,
		index: true
	},

	// Auth (separate organization login)
	authEmail: {
		type: String,
		lowercase: true,
		trim: true,
		unique: true,
		index: true
	},
	authPassword: {
		type: String
	},

	// Ownership & metadata
	createdBy: {
		type: mongoose.Schema.Types.ObjectId,
		ref: 'Superadmin',//superadmin if exists
		index: true
	},
	metadata: {
		type: mongoose.Schema.Types.Mixed,
		default: {}
	},

	// Memberships embedded as subdocuments
	clients: [
		{
			_id: false,
			client: {
				type: mongoose.Schema.Types.ObjectId,
				ref: 'User',
				required: true,
				index: true
			},
			role: {
				type: String,
				enum: ['member', 'manager', 'admin'],
				default: 'member',
				index: true
			},
			status: {
				type: String,
				enum: ['invited', 'active', 'suspended'],
				default: 'active',
				index: true
			},
			joinedAt: { type: Date },
			addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Superadmin' },
			settings: { type: mongoose.Schema.Types.Mixed, default: {} }
		}
	]
},
{
	timestamps: true
});

// Indexes
OrganizationSchema.index({ slug: 1 }, { unique: true });
OrganizationSchema.index({ status: 1 });
OrganizationSchema.index({ isDeleted: 1 });
OrganizationSchema.index({ createdBy: 1 });
// Multikey index to optimize lookups by client membership
OrganizationSchema.index({ 'clients.client': 1 });

OrganizationSchema.pre('validate', function(next) {
	if (!this.slug && this.name) {
		this.slug = slugifyName(this.name);
	}
	return next();
});


// Hash org auth password before save when modified
OrganizationSchema.pre('save', async function(next) {
	try {
		if (this.isModified('authPassword') && this.authPassword) {
			const salt = await bcrypt.genSalt(10);
			this.authPassword = await bcrypt.hash(this.authPassword, salt);
		}
		return next();
	} catch (err) {
		return next(err);
	}
});

OrganizationSchema.methods.comparePassword = async function(plain) {
	if (!this.authPassword) return false;
	return bcrypt.compare(plain, this.authPassword);
};

module.exports = mongoose.model('Organization', OrganizationSchema);