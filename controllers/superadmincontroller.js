const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Superadmin = require("../models/Superadmin");
const Admin = require("../models/Admin");
const User = require("../models/User");
const Organization = require('../models/Organization');

// Generate JWT Token for admin
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

const loginSuperadmin = async (req,res) => {
   try {
    console.log('Received login request:', req.body);
    const {email,password}=req.body;

    if (!email || !password) {
        return res.status(400).json({
            message: "Email and password are required",
            received: { email: !!email, password: !!password }
        });
    }

    const superadmin = await Superadmin.findOne({email})
    console.log('Found superadmin:', superadmin ? 'Yes' : 'No');

    if(!superadmin) {
        return res.status(400).json({message:"Superadmin not found"});
    }

    const isPasswordValid = await bcrypt.compare(password, superadmin.password);
    console.log('Password valid:', isPasswordValid);

    if(!isPasswordValid) {
        return res.status(400).json({message:"Invalid credentials"});
    }

    const token = generateToken(superadmin._id);

    res.status(200).json({
        success: true,
        token,
        superadmin: {
            _id: superadmin._id,
            name: superadmin.name,
            email: superadmin.email,
            role: 'superadmin'
        }
    });
   } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({message: "Internal server error"});
   }
};

// Validate superadmin token
const validateSuperadminToken = async (req, res) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find superadmin by id
    const superadmin = await Superadmin.findById(decoded.id).select('-password');
    if (!superadmin) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    res.json({
      success: true,
      role: 'superadmin',
      name: superadmin.name,
      email: superadmin.email,
      _id: superadmin._id
    });
  } catch (error) {
    console.error('Superadmin token validation error:', error);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

const registerSuperadmin = async (req, res) => {
  try {
    const { name, email, password, superadmincode } = req.body;

    if (superadmincode !== process.env.SUPERADMIN_REGISTRATION_CODE) {
      res.status(401).json({ message: "Invalid superadmin code" });
    }
    const existingSuperadmin = await Superadmin.findOne({ email });
    if (existingSuperadmin) {
      res.status(400).json({ message: "Superadmin already exists" });
    }
    else{
        const hashedPassword = await bcrypt.hash(password, 10);

        const superadmin = await Superadmin.create({
          name,
          email,
          password: hashedPassword,
        });
    
        const token = generateToken(superadmin._id);
    
        res.status(200).json({
          success: true,
          token,
          data: superadmin,
        });
      } 
    }
    catch (error) {
        res.status(400).json({ message: error });
        console.log(error);
      }
    
};

const getadmins = async(req,res)=>{
    try {
        const admins = await Admin.find().select('-password');
        
        res.status(200).json({
          success: true,
          count: admins.length,
          data: admins
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error.message
        });
      }
}

const getclients = async(req,res)=>{
    try {
        const clients = await User.find({role:"client"}).select('-password');
        
        res.status(200).json({
          success: true,
          count: clients.length,
          data: clients
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error.message
        });
      }
}

const deleteclient = async(req, res) => {
    try {
        const id = req.params.id;
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Client ID is required"
            });
        }

        const client = await Client.findByIdAndDelete(id);
        if (!client) {
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "Client deleted successfully"
        });
    } catch (error) {
        console.error('Error deleting client:', error);
        res.status(500).json({
            success: false,
            message: "Failed to delete client"
        });
    }
}

const deleteadmin = async(req, res) => {
    try {
        const id = req.params.id;
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Admin ID is required"
            });
        }

        const admin = await Admin.findByIdAndDelete(id);
        if (!admin) {
            return res.status(404).json({
                success: false,
                message: "Admin not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "Admin deleted successfully"
        });
    } catch (error) {
        console.error('Error deleting admin:', error);
        res.status(500).json({
            success: false,
            message: "Failed to delete admin"
        });
    }
}

const registeradmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: "Admin with this email already exists"
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new admin
    const admin = await Admin.create({
      name,
      email,
      password: hashedPassword
    });

    // Remove password from response
    const adminResponse = admin.toObject();
    delete adminResponse.password;

    res.status(201).json({
      success: true,
      message: "Admin created successfully",
      data: adminResponse
    });
  } catch (error) {
    console.error('Error creating admin:', error);
    res.status(500).json({
      success: false,
      message: "Failed to create admin"
    });
  }
};

const registerclient = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      businessName,
      websiteUrl,
      city,
      pincode,
      gstNo,
      panNo,
      aadharNo
    } = req.body;

    // Check if client already exists
    const existingClient = await Client.findOne({ email });
    if (existingClient) {
      return res.status(400).json({
        success: false,
        message: "Client with this email already exists"
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new client
    const client = await Client.create({
      name,
      email,
      password: hashedPassword,
      businessName,
      websiteUrl,
      city,
      pincode,
      gstNo,
      panNo,
      aadharNo
    });

    // Remove password from response
    const clientResponse = client.toObject();
    delete clientResponse.password;

    res.status(201).json({
      success: true,
      message: "Client created successfully",
      data: clientResponse
    });
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({
      success: false,
      message: "Failed to create client"
    });
  }
};

// Generate login token for client (admin impersonation)
const generateOrgLoginToken = async (req, res) => {
	try {
	  const orgId = req.params.id;
	  console.log(orgId)
	  // Find client by ID
	  const org = await Organization.findById(orgId);
	  console.log(org);
	  if (!org) {
		return res.status(404).json({ success: false, message: 'org not found' });
	  }

	  // Generate a short-lived token for this client (e.g., 1 hour)
	  const token = jwt.sign({ 
		orgId: org._id,
	  }, process.env.JWT_SECRET, {
		expiresIn: '5h'
	  });
	  
    console.log(token)
	  res.json({
		success: true,
		token,
		organization: {
		  id: org._id,
		  name: org.name,
		  email: org.authEmail,
		}

	  });
	  console.log(token);

	} catch (error) {
	  console.error('Generate organization login token error:', error);
	  res.status(500).json({ success: false, message: 'Server error' });
	}
  };

module.exports={loginSuperadmin,registerSuperadmin,getclients,getadmins,deleteclient,deleteadmin,registeradmin,registerclient,generateOrgLoginToken,validateSuperadminToken}