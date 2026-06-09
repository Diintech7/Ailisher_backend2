const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env
dotenv.config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const User = require('../models/User');
const Admin = require('../models/Admin');
const Superadmin = require('../models/Superadmin');

const run = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not set in .env');
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB successfully.');

    // 1. Get all admin IDs
    const admins = await Admin.find({});
    const adminIds = admins.map(a => a._id);
    console.log(`Found ${admins.length} admins in the system.`);

    // 2. Get the Super Admin (default creator for existing clients)
    let superadmin = await Superadmin.findOne({});
    if (!superadmin) {
      console.log('No Superadmin document found in collection. Looking at environment variables...');
      if (process.env.SUPERADMIN_EMAIL) {
        superadmin = await Superadmin.findOne({ email: process.env.SUPERADMIN_EMAIL });
      }
    }

    const superadminId = superadmin ? superadmin._id : null;
    if (superadminId) {
      console.log(`Found Superadmin: ${superadmin.name} (${superadminId})`);
    } else {
      console.warn('⚠️ No Superadmin found in the database. Existing clients will not have createdBy set to Superadmin, but will still be assigned all admins.');
    }

    // 3. Find and update all existing clients (Users with role: 'client')
    const query = {
      role: 'client',
      $or: [
        { organization: null },
        { organization: { $exists: false } }
      ]
    };

    const clients = await User.find(query);
    console.log(`Found ${clients.length} existing global clients to migrate.`);

    let updatedCount = 0;
    for (const client of clients) {
      const updatePayload = {
        $set: {
          assignedAdmins: adminIds
        }
      };

      if (superadminId) {
        updatePayload.$set.createdBy = superadminId;
      }

      await User.updateOne({ _id: client._id }, updatePayload);
      updatedCount++;
    }

    console.log(`Successfully migrated ${updatedCount} clients.`);
    console.log('--- Migration Completed Successfully ---');

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
};

run();
