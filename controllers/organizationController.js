const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Organization = require('../models/Organization');
const Client = require('../models/Client'); // legacy Client model (not used for membership)
const User = require('../models/User');
const { path } = require('@ffmpeg-installer/ffmpeg');
const { generatePresignedUrl } = require('../utils/r2');
const OrgClient = require('../models/OrgClient');

// Helpers
function slugify(name) {
	return String(name)
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-');
}

// Create organization
exports.createOrganization = async (req, res) => {
	try {
		const { name, authEmail, authPassword} = req.body;
		if (!name) return res.status(400).json({ success: false, message: 'name is required' });

		const finalSlug = slugify(name);
		const exists = await Organization.findOne({authEmail});
		if (exists) return res.status(400).json({ success: false, message: 'org already exists' });

		const org = new Organization({
			name,
			authEmail,
            authPassword,
			slug: finalSlug,
			status: 'active',
			isDeleted: false,
			createdBy: req.superadmin?._id,
		});
		await org.save();
		return res.status(201).json({ success: true, data: org });
	} catch (error) {
		return res.status(error.statusCode || 400).json({ success: false, message: error.message });
	}
};

// List organizations
exports.listOrganizations = async (req, res) => {
	try {
		const { status, q, page = 1, limit = 20 } = req.query;
		const filter = {};
		if (status) filter.status = status;
		if (q) filter.$or = [{ name: new RegExp(q, 'i') }, { slug: new RegExp(q, 'i') }];
		const docs = await Organization.find(filter)
			.sort({ createdAt: -1 })
			.limit(Number(limit))
			.skip((Number(page) - 1) * Number(limit));
		const count = await Organization.countDocuments(filter);
		return res.json({ success: true, data: docs, count, page: Number(page), totalPages: Math.ceil(count / Number(limit)) });
	} catch (error) {
		return res.status(400).json({ success: false, message: error.message });
	}
};

// Get organization details
exports.getOrganization = async (req, res) => {
	try {
		const { id } = req.params;
		const org = await Organization.findById(id);
		if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });
		return res.json({ success: true, data: org });
	} catch (error) {
		return res.status(400).json({ success: false, message: error.message });
	}
};

// Update organization
exports.updateOrganization = async (req, res) => {
	try {
		const { id } = req.params;
		const { name, slug, status, metadata, authEmail} = req.body;
		const set = {};
		if (name) set.name = name;
		if (email) set.authEmail = authEmail;
		if (typeof status !== 'undefined') set.status = status;
		if (typeof metadata !== 'undefined') set.metadata = metadata;
		if (slug) set.slug = slugify(slug);
		if (set.slug) {
			const dup = await Organization.findOne({ slug: set.slug, _id: { $ne: id } });
			if (dup) return res.status(400).json({ success: false, message: 'slug already exists' });
		}
		const org = await Organization.findByIdAndUpdate(id, { $set: set }, { new: true });
		if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });
		return res.json({ success: true, data: org });
	} catch (error) {
		return res.status(400).json({ success: false, message: error.message });
	}
};

// Suspend/restore
exports.suspendOrganization = async (req, res) => {
	try {
		const { id } = req.params;
		const org = await Organization.findByIdAndUpdate(id, { $set: { status: 'suspended' } }, { new: true });
		if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });
		return res.json({ success: true, data: org });
	} catch (error) {
		return res.status(400).json({ success: false, message: error.message });
	}
};

exports.restoreOrganization = async (req, res) => {
	try {
		const { id } = req.params;
		const org = await Organization.findByIdAndUpdate(id, { $set: { status: 'active' } }, { new: true });
		if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });
		return res.json({ success: true, data: org });
	} catch (error) {
		return res.status(400).json({ success: false, message: error.message });
	}
};

exports.uploadLogo = async (req,res) => {
	try
	{
	const {id} = req.org._id;
    const {fileName, contentType} = req.body;
	if(!fileName || !contentType)
	{
		return res.status(400).json({
			success:false,
			message:'file name and content type are required'
		})
	}
	const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
	const ext = path.extname(fileName);
    const Key = `/organization/${id}/logo/${uniqueSuffix}${ext}`;

	const uploadUrl = await generatePresignedUrl(key);

	return res.status(200).json({
		success: true,
		uploadUrl,
		key,
	  });
	} catch (error) {
	  console.error("Get cover image upload URL error:", error);
	  return res.status(500).json({ success: false, message: "Server Error" });
	}
  };

// Create new client
exports.createClient = async (req, res) => {
    try {
        const id = req.org && (req.org._id || req.org.id); // org id
        if (!id) return res.status(400).json({ success: false, message: 'Organization context missing' });
      const {
        businessName,
        businessOwnerName,
        email,
        businessNumber,
        businessGSTNumber,
        businessPANNumber,
        businessMobileNumber,
        businessCategory,
        businessAddress,
        city,
        pinCode,
        businessLogo,
        businessWebsite,
        businessYoutubeChannel,
        turnOverRange
      } = req.body;
  
	  const organization = await Organization.findById(id);
	  if (!organization) return res.status(404).json({ success: false, message: 'Organization not found' });

      // Validate required fields
      const requiredFields = {
        businessName,
        businessOwnerName,
        email,
        businessNumber,
        businessGSTNumber,
        businessPANNumber,
        businessMobileNumber,
        businessCategory,
        businessAddress,
        city,
        pinCode
      };
  
      for (const [field, value] of Object.entries(requiredFields)) {
        if (!value || !value.toString().trim()) {
          return res.status(400).json({ 
            success: false, 
            message: `${field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} is required` 
          });
        }
      }
  
      // Check if client already exists
      const existingClient = await OrgClient.findOne({organization: id, email: email.toLowerCase().trim() });
      if (existingClient) {
		console.log(existingClient)
        return res.status(400).json({ 
          success: false, 
          message: 'Client with this email already exists' 
        });
      }
  
      // Generate a secure temporary password
      const tempPassword = generateTempPassword();
  
      // Create new client
      const client = await OrgClient.create({
        name: businessOwnerName.trim(),
        email: email.toLowerCase().trim(),
        password: tempPassword,
        role: 'client',
        status: 'active',
        businessName: businessName.trim(),
        businessOwnerName: businessOwnerName.trim(),
        businessNumber: businessNumber.trim(),
        businessGSTNumber: businessGSTNumber.trim(),
        businessPANNumber: businessPANNumber.trim(),
        businessMobileNumber: businessMobileNumber.trim(),
        businessCategory: businessCategory.trim(),
        businessAddress: businessAddress.trim(),
        city: city.trim(),
        pinCode: pinCode.trim(),
        businessLogo: businessLogo || null,
        businessWebsite: businessWebsite ? businessWebsite.trim() : null,
        businessYoutubeChannel: businessYoutubeChannel ? businessYoutubeChannel.trim() : null,
        turnOverRange: turnOverRange || null,
      });
      client.organization = id;
      await client.save();
      
	  organization.clients.push({ client: client._id, role: 'member', status: 'active', joinedAt: new Date() });
	  await organization.save();
      // Ensure user ID is generated (fallback if pre-save hook fails)
      if (!client.userId) {
        await client.generateUserId();
      }
  
      console.log('Client created successfully:', {
        id: client._id,
        userId: client.userId,
        email: client.email,
        businessName: client.businessName
      });
  
      // Return client data with generated user ID
      res.status(201).json({
        success: true,
        message: 'Client created successfully',
        client: {
          id: client._id,
          userId: client.userId,
          name: client.name,
          email: client.email,
          businessName: client.businessName,
          businessOwnerName: client.businessOwnerName,
          businessCategory: client.businessCategory,
          city: client.city,
          status: client.status,
          createdAt: client.createdAt,
          tempPassword: tempPassword // Only show once for setup
        }
      });
    } catch (error) {
      console.error('Create client error:', error);
      
      // Handle specific MongoDB errors
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        return res.status(400).json({ 
          success: false, 
          message: `${field === 'email' ? 'Email' : 'User ID'} already exists` 
        });
      }
      
      res.status(500).json({ 
        success: false, 
        message: error.message || 'Failed to create client. Please try again.' 
      });
    }
};
  
  // Helper function to generate secure temporary password
function generateTempPassword() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const symbols = '!@#$%&*';
    let password = '';
    
    // Ensure at least one uppercase, one lowercase, one number, and one symbol
    password += chars.charAt(Math.floor(Math.random() * 25)); // Uppercase
    password += chars.charAt(Math.floor(Math.random() * 25) + 25); // Lowercase
    password += chars.charAt(Math.floor(Math.random() * 8) + 50); // Number
    password += symbols.charAt(Math.floor(Math.random() * symbols.length)); // Symbol
    
    // Fill the rest randomly
    for (let i = 4; i < 12; i++) {
      const allChars = chars + symbols;
      password += allChars.charAt(Math.floor(Math.random() * allChars.length));
    }
    
    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
}

// Add client membership
// exports.addClient = async (req, res) => {
// 	try {
// 		const { id } = req.org._id; // org id
// 		const { clientId, role = 'member', status = 'active', settings } = req.body;
// 		if (!clientId) return res.status(400).json({ success: false, message: 'clientId is required' });
// 		const org = await Organization.findById(id);
// 		if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });
// 		if (org.status === 'suspended') return res.status(400).json({ success: false, message: 'Organization is suspended' });
//         // Membership must point to User, not Client
//         const existsClient = await User.findById(clientId).select('_id');
// 		if (!existsClient) return res.status(404).json({ success: false, message: 'Client not found' });
// 		const already = (org.clients || []).some(m => String(m.client) === String(clientId));
// 		if (already) return res.status(400).json({ success: false, message: 'Client already in organization' });
// 		org.clients.push({
// 			client: clientId,
// 			role,
// 			status,
// 			joinedAt: status === 'active' ? new Date() : undefined,
// 			settings: settings || {}
// 		});
// 		await org.save();
// 		return res.status(201).json({ success: true, data: org });
// 	} catch (error) {
// 		return res.status(400).json({ success: false, message: error.message });
// 	}
// };

// Update existing client
exports.updateClient = async (req, res) => {
	try {
	  const orgId = req.org && (req.org._id || req.org.id);
	  if (!orgId) {
		return res.status(400).json({ success: false, message: 'Organization context missing' });
	  }
  
	  const { clientId } = req.params;
	  if (!clientId) {
		return res.status(400).json({ success: false, message: 'Client ID is required' });
	  }
  
	  const organization = await Organization.findById(orgId);
	  if (!organization) {
		return res.status(404).json({ success: false, message: 'Organization not found' });
	  }
  
	  const client = await OrgClient.findOne({ _id: clientId, organization: orgId });
	  if (!client) {
		return res.status(404).json({ success: false, message: 'Client not found or not associated with this organization' });
	  }
  
	  const {
		businessName,
		businessOwnerName,
		email,
		businessNumber,
		businessGSTNumber,
		businessPANNumber,
		businessMobileNumber,
		businessCategory,
		businessAddress,
		city,
		pinCode,
		businessLogo,
		businessWebsite,
		businessYoutubeChannel,
		turnOverRange,
		status // optional: update status
	  } = req.body;
  
	  // Prevent duplicate email (if email changed)
	  if (email && email.toLowerCase().trim() !== client.email) {
		const existing = await OrgClient.findOne({
		  organization: orgId,
		  email: email.toLowerCase().trim(),
		  _id: { $ne: clientId }
		});
		if (existing) {
		  return res.status(400).json({
			success: false,
			message: 'Client with this email already exists'
		  });
		}
		client.email = email.toLowerCase().trim();
	  }
  
	  // Update only provided fields (partial update)
	  const updatableFields = {
		businessName,
		businessOwnerName,
		businessNumber,
		businessGSTNumber,
		businessPANNumber,
		businessMobileNumber,
		businessCategory,
		businessAddress,
		city,
		pinCode,
		businessLogo,
		businessWebsite,
		businessYoutubeChannel,
		turnOverRange,
		status
	  };
  
	  Object.entries(updatableFields).forEach(([key, value]) => {
		if (value !== undefined && value !== null && value.toString().trim() !== '') {
		  client[key] = typeof value === 'string' ? value.trim() : value;
		}
	  });
  
	  await client.save();
  
	  console.log('Client updated successfully:', {
		id: client._id,
		email: client.email,
		businessName: client.businessName
	  });
  
	  res.status(200).json({
		success: true,
		message: 'Client updated successfully',
		client: {
		  id: client._id,
		  userId: client.userId,
		  name: client.name,
		  email: client.email,
		  businessName: client.businessName,
		  businessOwnerName: client.businessOwnerName,
		  businessCategory: client.businessCategory,
		  city: client.city,
		  status: client.status,
		  updatedAt: client.updatedAt
		}
	  });
	} catch (error) {
	  console.error('Update client error:', error);
  
	  if (error.code === 11000) {
		const field = Object.keys(error.keyPattern)[0];
		return res.status(400).json({
		  success: false,
		  message: `${field === 'email' ? 'Email' : 'User ID'} already exists`
		});
	  }
  
	  res.status(500).json({
		success: false,
		message: error.message || 'Failed to update client. Please try again.'
	  });
	}
  };

// Generate login token for client (admin impersonation)
exports.generateClientLoginToken = async (req, res) => {
	try {
	  const clientId = req.params.id;
	  
	  // Find client by ID
	  const client = await OrgClient.findById(clientId);
	  console.log(client);
	  if (!client || client.role !== 'client') {
		return res.status(404).json({ success: false, message: 'Client not found' });
	  }

	  // Generate a short-lived token for this client (e.g., 1 hour)
	  const token = jwt.sign({ 
		id: client._id,
		type: 'client',
		clientId: client._id
	  }, process.env.JWT_SECRET, {
		expiresIn: '5h'
	  });
	  
	  res.json({
		success: true,
		token,
		user: {
		  id: client._id,
		  name: client.name,
		  email: client.email,
		  role: client.role
		}

	  });
	  console.log(token);

	} catch (error) {
	  console.error('Generate client login token error:', error);
	  res.status(500).json({ success: false, message: 'Server error' });
	}
  };

// Toggle client status (enable/disable)
exports.toggleClientStatus = async (req, res) => {
	try {
		const { isEnabled } = req.body;
		const orgId = req.org && (req.org._id || req.org.id);
		if (!orgId) {
			return res.status(400).json({ success: false, message: 'Organization context missing' });
		}

		const { clientId } = req.params;
		if (!clientId) {
			return res.status(400).json({ success: false, message: 'Client ID is required' });
		}

		const organization = await Organization.findById(orgId);
		if (!organization) {
			return res.status(404).json({ success: false, message: 'Organization not found' });
		}

		const client = await OrgClient.findOne({ _id: clientId, organization: orgId });
		if (!client) {
			return res.status(404).json({ success: false, message: 'Client not found or not associated with this organization' });
		}

		client.isEnabled = isEnabled;
		client.updatedAt = new Date();
		await client.save();

		console.log('Client status toggled successfully:', {
			id: client._id,
			email: client.email,
			businessName: client.businessName,
			isEnabled: client.isEnabled
		});

		res.status(200).json({
			success: true,
			client: {
				id: client._id,
				userId: client.userId,
				name: client.name,
				email: client.email,
				businessName: client.businessName,
				isEnabled: client.isEnabled,
				updatedAt: client.updatedAt
			}
		});
	} catch (error) {
		console.error('Toggle client status error:', error);
		res.status(500).json({
			success: false,
			message: error.message || 'Failed to toggle client status. Please try again.'
		});
	}
};

// Remove client membership
exports.removeClient = async (req, res) => {
	try {
        const { id } = req.org._id; // org id
		const { clientId } = req.params; // client id	
		console.log(clientId)	
        const org = await Organization.findById(id);
		if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });
		org.clients = (org.clients || []).filter(m => String(m.client) !== String(clientId));
		console.log(org.clients)
		await org.save();
		return res.json({ success: true, data: org });
	} catch (error) {
		return res.status(error.statusCode || 400).json({ success: false, message: error.message });
	}
};

// List clients in an organization (for authenticated organization)
exports.listClients = async (req, res) => {
	try {
        // Prefer org context; fallback to optional slug param if you decide to expose one
        const slug = (req.org && req.org.slug) || (req.params && req.params.slug);
        if (!slug) return res.status(400).json({ success: false, message: 'Organization context missing' });

		const org = await Organization.findOne({ slug })
			.populate({
				path: 'clients.client',
				// select: 'name email businessName businessMobileNumber businessAddress city pinCode status createdAt'
			}).sort({ createdAt: -1 });
		if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

		const members = (org.clients || []).map(m => ({
			id: m.client?._id,
			clientId: m.client?.userId,
			businessAddress:m.client?.businessAddress,
            businessCategory:m.client?.businessCategory,
            businessGSTNumber:m.client?.businessGSTNumber,
            businessLogo:m.client?.businessLogo,
            businessMobileNumber:m.client?.businessMobileNumber,
            businessName:m.client?.businessName,
            businessNumber:m.client?.businessNumber,
            businessOwnerName:m.client?.businessOwnerName,
            businessPANNumber:m.client?.businessPANNumber,
            businessWebsite:m.client?.businessWebsite,
            businessYoutubeChannel:m.client?.businessYoutubeChannel,
            city:m.client?.city,
            email:m.client?.email,
            name:m.client?.name,
            pinCode:m.client?.pinCode,
            role:m.client?.role,
            status:m.client?.status,
			isEnabled:m.client?.isEnabled,
            turnOverRange:m.client?.turnOverRange,
			joinedAt: m.joinedAt,
			createdAt: m.client?.createdAt,
			updatedAt: m.client?.updatedAt
		}));

		return res.json({ success: true, data: members });
	} catch (error) {
		return res.status(400).json({ success: false, message: error.message });
	}
};

// Public: List clients by organization identifier (slug or name)
exports.listClientsByIdentifier = async (req, res) => {
	try {
		const { name, q, page = 1, limit = 20 } = req.body;
		if (!name) {
			return res.status(400).json({ success: false, message: 'Provide name' });
		}

		const filter = {};
        const slug = slugify(name)
		filter.slug = slug;

		const org = await Organization.findOne(filter)
			.populate({
				path: 'clients.client',
				select: 'userId name email businessName businessMobileNumber businessAddress businessLogo city pinCode status createdAt'
			});
		if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

		let members = (org.clients || []).map(m => ({
			id: m.client?._id,
			clientId: m.client?.userId,
			name: m.client?.name,
			email: m.client?.email,
			businessName: m.client?.businessName,
			businessMobileNumber: m.client?.businessMobileNumber,
			businessAddress: m.client?.businessAddress,
			businessLogo: m.client?.businessLogo,
			city: m.client?.city,
			pinCode: m.client?.pinCode,
			status: m.status,
			role: m.role,
			isEnabled: m.client?.isEnabled,
			joinedAt: m.joinedAt,
			createdAt: m.client?.createdAt
		}));

		// Optional filter by client query
		if (q) {
			const regex = new RegExp(String(q).trim(), 'i');
			members = members.filter(m =>
				regex.test(m.name || '') ||
				regex.test(m.email || '') ||
				regex.test(m.businessName || '') ||
				regex.test(m.businessMobileNumber || '') ||
				regex.test(m.city || '')
			);
		}

		const total = members.length;
		const p = Math.max(1, Number(page));
		const l = Math.max(1, Math.min(100, Number(limit)));
		const start = (p - 1) * l;
		const end = start + l;
		const pageData = members.slice(start, end);

		return res.json({ success: true, data: pageData, count: total, page: p, totalPages: Math.ceil(total / l) });
	} catch (error) {
		return res.status(400).json({ success: false, message: error.message });
	}
};

