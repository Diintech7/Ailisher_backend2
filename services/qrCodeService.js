const QRCode = require("qrcode");

class QRCodeService {
  /**
   * Generate QR code for UPI payment
   * @param {string} upiId - UPI ID (e.g., user@paytm, user@phonepe)
   * @param {number} amount - Amount to be paid
   * @param {string} merchantName - Merchant name (optional)
   * @param {string} transactionNote - Transaction note (optional)
   * @returns {Promise<string>} Base64 encoded QR code
   */
  static async generateUPIQR(
    upiId,
    amount,
    merchantName = "Ailisher",
    transactionNote = "Withdrawal Payment"
  ) {
    try {
      // Create UPI payment URL
      const upiUrl = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(
        merchantName
      )}&am=${amount}&cu=INR&tn=${encodeURIComponent(transactionNote)}`;

      // Generate QR code as base64
      const qrCodeBase64 = await QRCode.toDataURL(upiUrl, {
        type: "image/png",
        quality: 0.92,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
        width: 300,
      });

      return qrCodeBase64;
    } catch (error) {
      console.error("Error generating UPI QR code:", error);
      throw new Error("Failed to generate QR code");
    }
  }

  /**
   * Generate QR code for bank transfer details
   * @param {Object} bankDetails - Bank account details
   * @param {number} amount - Amount to be transferred
   * @returns {Promise<string>} Base64 encoded QR code
   */
  static async generateBankTransferQR(bankDetails, amount) {
    try {
      const { accountNumber, ifscCode, accountHolderName, bankName } =
        bankDetails;

      // Create bank transfer details as text
      const transferDetails = `Bank Transfer Details:
Account Holder: ${accountHolderName}
Account Number: ${accountNumber}
IFSC Code: ${ifscCode}
Bank: ${bankName}
Amount: ₹${amount}`;

      // Generate QR code as base64
      const qrCodeBase64 = await QRCode.toDataURL(transferDetails, {
        type: "image/png",
        quality: 0.92,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
        width: 300,
      });

      return qrCodeBase64;
    } catch (error) {
      console.error("Error generating bank transfer QR code:", error);
      throw new Error("Failed to generate QR code");
    }
  }

  /**
   * Generate QR code for withdrawal request
   * @param {Object} withdrawalRequest - Withdrawal request object
   * @returns {Promise<string>} Base64 encoded QR code
   */
  static async generateWithdrawalQR(withdrawalRequest) {
    const { withdrawalMethod, accountDetails, amount } = withdrawalRequest;

    // Prefer UPI whenever a UPI ID is available (either on the request or evaluator)
    const upiIdFromRequest = accountDetails?.upiId;
    const upiIdFromEvaluator =
      withdrawalRequest?.evaluatorId?.bankDetails?.upiId;
    const upiId = upiIdFromRequest || upiIdFromEvaluator;

    if (upiId) {
      return await this.generateUPIQR(upiId, amount);
    }

    // Fallback to bank transfer QR text if bank details exist
    if (accountDetails?.accountNumber && accountDetails?.ifscCode) {
      return await this.generateBankTransferQR(accountDetails, amount);
    }

    // If neither UPI nor bank details are available, error out
    throw new Error("No valid payment details found to generate QR");
  }
}

module.exports = QRCodeService;
