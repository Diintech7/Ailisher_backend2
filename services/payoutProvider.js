// services/payoutProvider.js
// NOTE: This is a stub. Replace the internals with real Paytm Payouts (or other) API calls.

module.exports = {
  /**
   * Send payout to a UPI ID
   * @param {Object} params
   * @param {string} params.upiId
   * @param {number} params.amount
   * @param {string} params.referenceId
   * @returns {Promise<{success: boolean, transactionId?: string, providerRef?: string, rawResponse?: any, message?: string}>}
   */
  async payUPI({ upiId, amount, referenceId }) {
    try {
      // TODO: Integrate real payout API
      return { success: false, message: 'Payout provider not configured', rawResponse: null };
    } catch (error) {
      return { success: false, message: error.message, rawResponse: { stack: error.stack } };
    }
  },

  /**
   * Send payout to a bank account
   * @param {Object} params
   * @param {string} params.accountNumber
   * @param {string} params.ifscCode
   * @param {string} params.accountHolderName
   * @param {number} params.amount
   * @param {string} params.referenceId
   * @returns {Promise<{success: boolean, transactionId?: string, providerRef?: string, rawResponse?: any, message?: string}>}
   */
  async payBank({ accountNumber, ifscCode, accountHolderName, amount, referenceId }) {
    try {
      // TODO: Integrate real payout API
      return { success: false, message: 'Payout provider not configured', rawResponse: null };
    } catch (error) {
      return { success: false, message: error.message, rawResponse: { stack: error.stack } };
    }
  },
};


