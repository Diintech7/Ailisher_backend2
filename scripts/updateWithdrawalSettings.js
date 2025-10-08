// scripts/updateWithdrawalSettings.js
const mongoose = require('mongoose');
const Evaluator = require('../models/Evaluator');

async function updateWithdrawalSettings() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ailisher');
    console.log('Connected to MongoDB');

    // Update all evaluators that don't have minimumWithdrawalAmount set
    const result = await Evaluator.updateMany(
      { 
        $or: [
          { 'withdrawalSettings.minimumWithdrawalAmount': { $exists: false } },
          { 'withdrawalSettings.minimumWithdrawalAmount': null }
        ]
      },
      { 
        $set: { 
          'withdrawalSettings.minimumWithdrawalAmount': 1,
          'withdrawalSettings.maximumWithdrawalAmount': 1000,
          'withdrawalSettings.withdrawalEnabled': false
        }
      }
    );

    console.log(`Updated ${result.modifiedCount} evaluators with default withdrawal settings`);

    // Also update the withdrawalEnabled for evaluators with verified KYC
    const kycResult = await Evaluator.updateMany(
      { 
        'kycDetails.status': 'verified',
        'withdrawalSettings.withdrawalEnabled': { $ne: true }
      },
      { 
        $set: { 
          'withdrawalSettings.withdrawalEnabled': true
        }
      }
    );

    console.log(`Enabled withdrawals for ${kycResult.modifiedCount} verified evaluators`);

    // Show some examples
    const evaluators = await Evaluator.find({}).limit(3).select('name email withdrawalSettings creditBalance');
    console.log('\nSample evaluators:');
    evaluators.forEach(eval => {
      console.log(`- ${eval.name} (${eval.email}): Balance=${eval.creditBalance}, MinWithdrawal=${eval.withdrawalSettings.minimumWithdrawalAmount}, Enabled=${eval.withdrawalSettings.withdrawalEnabled}`);
    });

  } catch (error) {
    console.error('Error updating withdrawal settings:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the script
updateWithdrawalSettings();
