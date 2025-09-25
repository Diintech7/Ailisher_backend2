const Cart = require("../models/Cart");
const Workbook = require("../models/Workbook");
const Payment = require("../models/Payment");
const UserProfile = require("../models/UserProfile");
const PaytmConfig = require("../config/paytm");
const PaytmChecksum = require("paytmchecksum");
const axios = require("axios");
const CreditAccount = require("../models/CreditAccount");
const UserPlan = require("../models/UserPlan");

function getEffectivePrice(workbook) {
  if (typeof workbook.offerPrice === "number" && workbook.offerPrice > 0) {
    return workbook.offerPrice;
  }
  if (typeof workbook.MRP === "number" && workbook.MRP > 0) {
    return workbook.MRP;
  }
  return 0;
}

async function ensureCart(userId, clientId) {
  let cart = await Cart.findOne({ userId, clientId });

  if (!cart) {
    cart = await Cart.create({ userId, clientId, items: [] });
  }
  return cart;
}

async function populateCart(userId, clientId) {
  // Use lean() so Mongoose virtuals (e.g., fullCategory) are not included
  return Cart.findOne({ userId, clientId })
    .populate({
      path: "items.workbookId",
      select:
        "title coverImageUrl coverImageKey MRP offerPrice validityDays details currency",
    })
    .lean();
}

exports.getCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const clientId = req.clientId || req.user.clientId;
    await ensureCart(userId, clientId);
    const populated = await populateCart(userId, clientId);
    res.json({ success: true, data: populated });
  } catch (err) {
    console.error("getCart error", err);
    res.status(500).json({ success: false, message: "Failed to load cart" });
  }
};

exports.addItem = async (req, res) => {
  try {
    const { workbookId } = req.body;
    if (!workbookId) {
      return res
        .status(400)
        .json({ success: false, message: "workbookId is required" });
    }
    const userId = req.user.id;
    const clientId = req.clientId || req.user.clientId;

    const workbook = await Workbook.findById(workbookId);
    if (!workbook) {
      return res
        .status(404)
        .json({ success: false, message: "Workbook not found" });
    }

    const price = getEffectivePrice(workbook);
    const title = workbook.title;
    const cart = await ensureCart(userId, clientId);

    const exists = cart.items.some(
      (i) => String(i.workbookId) === String(workbookId)
    );
    if (!exists) {
      cart.items.push({ workbookId, title, price, currency: "INR" });
    }
    await cart.save();
    const populated = await populateCart(userId, clientId);
    res.json({ success: true, data: populated });
  } catch (err) {
    console.error("addItem error", err);
    res.status(500).json({ success: false, message: "Failed to add item" });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const { workbookId } = req.body;
    if (!workbookId) {
      return res
        .status(400)
        .json({ success: false, message: "workbookId is required" });
    }
    const userId = req.user.id;
    const clientId = req.clientId || req.user.clientId;
    const cart = await ensureCart(userId, clientId);
    const idx = cart.items.findIndex(
      (i) => String(i.workbookId) === String(workbookId)
    );
    if (idx < 0) {
      return res
        .status(404)
        .json({ success: false, message: "Item not in cart" });
    }
    // For no-quantity carts, update is a no-op or can refresh snapshot price/title
    const workbook = await Workbook.findById(workbookId);
    if (workbook) {
      cart.items[idx].title = workbook.title;
      cart.items[idx].price = getEffectivePrice(workbook);
    }
    await cart.save();
    const populated = await populateCart(userId, clientId);
    res.json({ success: true, data: populated });
  } catch (err) {
    console.error("updateItem error", err);
    res.status(500).json({ success: false, message: "Failed to update item" });
  }
};

exports.removeItem = async (req, res) => {
  try {
    const { workbookId } = req.params;
    const userId = req.user.id;
    const clientId = req.clientId || req.user.clientId;
    const cart = await ensureCart(userId, clientId);
    const before = cart.items.length;
    cart.items = cart.items.filter(
      (i) => String(i.workbookId) !== String(workbookId)
    );
    if (before === cart.items.length) {
      return res
        .status(404)
        .json({ success: false, message: "Item not in cart" });
    }
    await cart.save();
    const populated = await populateCart(userId, clientId);
    res.json({ success: true, data: populated });
  } catch (err) {
    console.error("removeItem error", err);
    res.status(500).json({ success: false, message: "Failed to remove item" });
  }
};

exports.clearCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const clientId = req.clientId || req.user.clientId;
    const cart = await ensureCart(userId, clientId);
    cart.items = [];
    await cart.save();
    const populated = await populateCart(userId, clientId);
    res.json({ success: true, data: populated });
  } catch (err) {
    console.error("clearCart error", err);
    res.status(500).json({ success: false, message: "Failed to clear cart" });
  }
};

// Checkout full cart (works for single & multiple workbooks)
exports.checkoutCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const clientId = req.clientId || req.user.clientId;
    let { workbookIds, customerEmail } = req.body;

    // Ensure cart exists
    const cart = await ensureCart(userId, clientId);
    if (!cart.items.length) {
      return res.status(400).json({ success: false, message: "Cart is empty" });
    }

    let itemsToPurchase = [];
    let totalAmount = 0;

    if (workbookIds) {
      for (const workbookId of workbookIds) {
        const item = cart.items.find(
          (i) => String(i.workbookId) === String(workbookId)
        );
        if (!item) {
          return res.status(404).json({
            success: false,
            message: `Item ${workbookId} not found in cart`,
          });
        }
        itemsToPurchase.push(item);
        totalAmount += item.price;
      }
    } else {
      itemsToPurchase = cart.items;
      totalAmount = itemsToPurchase.reduce((sum, i) => sum + i.price, 0);
    }

    const selectedWorkbookIds = itemsToPurchase.map((i) => i.workbookId);
    console.log(selectedWorkbookIds);
    // Customer details
    const profile = await UserProfile.findOne({ userId });
    const customerName = profile?.name || "User";
    const customerPhone = req.user.mobile;
    customerEmail = customerEmail || `${customerPhone}@ailisher.user`;

    // Unique order ID
    const orderId = `ORDER_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Save Payment record
    await new Payment({
      orderId,
      amount: totalAmount,
      userId,
      workbookIds: selectedWorkbookIds,
      customerEmail,
      customerPhone,
      customerName,
      projectId: "AILISHER",
      status: "PENDING",
    }).save();

    // Paytm Params
    const paytmParams = {
      MID: PaytmConfig.MID,
      WEBSITE: PaytmConfig.WEBSITE,
      CHANNEL_ID: PaytmConfig.CHANNEL_ID,
      INDUSTRY_TYPE_ID: PaytmConfig.INDUSTRY_TYPE_ID,
      ORDER_ID: orderId,
      CUST_ID: customerEmail,
      TXN_AMOUNT: parseFloat(totalAmount).toFixed(2),
      CALLBACK_URL: `https://test.ailisher.com/api/clients/${clientId}/mobile/cart/callback`,
      EMAIL: customerEmail,
      MOBILE_NO: customerPhone,
    };

    const checksum = await PaytmChecksum.generateSignature(
      paytmParams,
      PaytmConfig.MERCHANT_KEY
    );
    paytmParams.CHECKSUMHASH = checksum;

    await Payment.findOneAndUpdate(
      { orderId },
      { checksumHash: checksum, paytmOrderId: orderId }
    );

    // ✅ Optional Telegram (uncomment when ready)
    /*
    try {
      const itemTitles = itemsToPurchase.map(i => i.title).join(", ");
      await axios.post(
        `https://test.ailisher.com/api/clients/${clientId}/telegram/send-text`,
        {
          text: `🆕 <b>INITIATED PAYMENT</b>\n\n👤 ${customerPhone} (${customerName}) has initiated purchase:\n📦 <b>${itemTitles}</b>\n💰 Worth: ₹${totalAmount}\n⏰ Time: ${new Date().toLocaleString()}`,
        }
      );
    } catch (err) {
      console.error("Telegram error:", err.message);
    }
    */

    res.json({
      success: true,
      orderId,
      paytmParams,
      paytmUrl: PaytmConfig.PAYTM_URL,
    });
  } catch (error) {
    console.error("Checkout error:", error);
    res.status(500).json({
      success: false,
      message: "Checkout failed",
      error: error.message,
    });
  }
};

// Paytm Callback (works for cart & single item)
exports.paytmCallback = async (req, res) => {
  try {
    const paytmResponse = req.body;
    const orderId = paytmResponse.ORDERID;

    console.log("Paytm Callback:", paytmResponse);

    // Verify checksum
    let isValidChecksum = true;
    if (paytmResponse.CHECKSUMHASH) {
      isValidChecksum = PaytmChecksum.verifySignature(
        paytmResponse,
        PaytmConfig.MERCHANT_KEY,
        paytmResponse.CHECKSUMHASH
      );
    }

    // Payment status
    let paymentStatus = "FAILED";
    if (paytmResponse.STATUS === "TXN_SUCCESS") paymentStatus = "SUCCESS";
    else if (paytmResponse.STATUS === "PENDING") paymentStatus = "PENDING";

    // Update Payment record
    const updateData = {
      status: paymentStatus,
      transactionId: paytmResponse.TXNID || paytmResponse.ORDERID,
      paytmTxnId: paytmResponse.TXNID,
      paytmResponse,
      paymentMode: paytmResponse.PAYMENTMODE,
      bankName: paytmResponse.BANKNAME,
      bankTxnId: paytmResponse.BANKTXNID,
      responseCode: paytmResponse.RESPCODE,
      responseMsg: paytmResponse.RESPMSG,
      updatedAt: new Date(),
    };

    const payment = await Payment.findOneAndUpdate({ orderId }, updateData, {
      new: true,
    });
    if (!payment) {
      return res
        .status(404)
        .json({ success: false, message: "Payment record not found", orderId });
    }

    // Credit user account if success
    if (payment.status === "SUCCESS") {
      const creditAccount = await CreditAccount.findOne({
        userId: payment.userId,
      });
      if (creditAccount) {
        // Transaction record
        const tx = await new CreditTransaction({
          userId: creditAccount.userId,
          type: "credit",
          amount: payment.amount,
          category: "purchase",
          description: "Workbooks purchased via Paytm",
          referenceId: orderId,
          workbookIds: payment.workbookIds,
          paymentAmount: payment.amount,
          paymentCurrency: "INR",
          metadata: { gateway: "PAYTM", transactionId: payment.transactionId },
          status: "completed",
        });
        await tx.save();

        // Attach workbooks to account
        if (payment.workbookIds?.length) {
          for (const wid of payment.workbookIds) {
            const alreadyHas = creditAccount.workbookId?.some(
              (p) => String(p) === String(wid)
            );
            if (!alreadyHas) {
              creditAccount.workbookId.push(wid);
            }

            // Create UserPlan for each workbook
            const workbook = await Workbook.findById(wid).select(
              "title validityDays clientId"
            );
            if (workbook) {
              const startDate = new Date();
              let endDate = null;
              if (workbook.validityDays && workbook.validityDays > 0) {
                endDate = new Date(
                  startDate.getTime() +
                    workbook.validityDays * 24 * 60 * 60 * 1000
                );
              }
              await UserPlan.create({
                userId: creditAccount.userId,
                workbookId: workbook._id,
                clientId: workbook.clientId || null,
                orderId,
                startDate,
                endDate,
                status: "active",
              });
            }
          }
        }
        await creditAccount.save();

        // Clear only purchased items from cart
        await Cart.findOneAndUpdate(
          { userId: payment.userId, clientId: payment.clientId },
          {
            $pull: {
              items: { workbookId: { $in: payment.workbookIds } },
            },
          }
        );

        // Telegram notification
        try {
          await axios.post(
            `https://test.ailisher.com/api/clients/${req.clientId}/telegram/send-text`,
            {
              text: `✅ <b>Payment Successful</b>\n\n💰 ₹${payment.amount}\n👤 ${payment.customerPhone} (${payment.customerName})\n🆔 Order: ${orderId}\n📦 Workbooks: ${payment.workbookIds.length}`,
            }
          );
        } catch (err) {
          console.error("Telegram error:", err.message);
        }
      }
    }

    res.json({
      success: true,
      message: "Payment processed",
      orderId,
      status: payment.status,
      transactionId: payment.transactionId,
    });
  } catch (error) {
    console.error("Callback error:", error);
    res.status(500).json({
      success: false,
      message: "Payment callback error",
      error: error.message,
    });
  }
};
