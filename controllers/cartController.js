const Cart = require('../models/Cart');
const Workbook = require('../models/Workbook');
const Payment = require('../models/Payment');
const UserProfile = require('../models/UserProfile');

function getEffectivePrice(workbook){
  if(typeof workbook.offerPrice === 'number' && workbook.offerPrice > 0){
    return workbook.offerPrice;
  }
  if(typeof workbook.MRP === 'number' && workbook.MRP > 0){
    return workbook.MRP;
  }
  return 0;
}

async function ensureCart(userId, clientId){
  let cart = await Cart.findOne({ userId, clientId })
  if(!cart){
    cart = await Cart.create({ userId, clientId, items: [] });
  }
  return cart;
}

exports.getCart = async (req, res) => {
  try{
    const userId = req.user.id;
    const clientId = req.clientId || req.user.clientId;
    const cart = await ensureCart(userId, clientId);
    res.json({ success: true, data: cart });
  }catch(err){
    console.error('getCart error', err);
    res.status(500).json({ success: false, message: 'Failed to load cart' });
  }
}

exports.addItem = async (req, res) => {
  try{
    const { workbookId } = req.body;
    if(!workbookId){
      return res.status(400).json({ success:false, message:'workbookId is required' });
    }
    const userId = req.user.id;
    const clientId = req.clientId || req.user.clientId;

    const workbook = await Workbook.findById(workbookId);
    if(!workbook){
      return res.status(404).json({ success:false, message:'Workbook not found' });
    }

    const price = getEffectivePrice(workbook);
    const title = workbook.title;
    const cart = await ensureCart(userId, clientId);

    const exists = cart.items.some(i => String(i.workbookId) === String(workbookId));
    if(!exists){
      cart.items.push({ workbookId, title, price, currency: 'INR' });
    }
    await cart.save();
    res.json({ success:true, data: cart });
  }catch(err){
    console.error('addItem error', err);
    res.status(500).json({ success:false, message:'Failed to add item' });
  }
}

exports.updateItem = async (req, res) => {
  try{
    const { workbookId } = req.body;
    if(!workbookId){
      return res.status(400).json({ success:false, message:'workbookId is required' });
    }
    const userId = req.user.id;
    const clientId = req.clientId || req.user.clientId;
    const cart = await ensureCart(userId, clientId);
    const idx = cart.items.findIndex(i => String(i.workbookId) === String(workbookId));
    if(idx < 0){
      return res.status(404).json({ success:false, message:'Item not in cart' });
    }
    // For no-quantity carts, update is a no-op or can refresh snapshot price/title
    const workbook = await Workbook.findById(workbookId);
    if(workbook){
      cart.items[idx].title = workbook.title;
      cart.items[idx].price = getEffectivePrice(workbook);
    }
    await cart.save();
    res.json({ success:true, data: cart });
  }catch(err){
    console.error('updateItem error', err);
    res.status(500).json({ success:false, message:'Failed to update item' });
  }
}

exports.removeItem = async (req, res) => {
  try{
    const { workbookId } = req.params;
    const userId = req.user.id;
    const clientId = req.clientId || req.user.clientId;
    const cart = await ensureCart(userId, clientId);
    const before = cart.items.length;
    cart.items = cart.items.filter(i => String(i.workbookId) !== String(workbookId));
    if(before === cart.items.length){
      return res.status(404).json({ success:false, message:'Item not in cart' });
    }
    await cart.save();
    res.json({ success:true, data: cart });
  }catch(err){
    console.error('removeItem error', err);
    res.status(500).json({ success:false, message:'Failed to remove item' });
  }
}

exports.clearCart = async (req, res) => {
  try{
    const userId = req.user.id;
    const clientId = req.clientId || req.user.clientId;
    const cart = await ensureCart(userId, clientId);
    cart.items = [];
    await cart.save();
    res.json({ success:true, data: cart });
  }catch(err){
    console.error('clearCart error', err);
    res.status(500).json({ success:false, message:'Failed to clear cart' });
  }
}

exports.checkout = async (req, res) => {
  try{
    const userId = req.user.id;
    const clientId = req.clientId || req.user.clientId;
    const cart = await ensureCart(userId, clientId);
    if(!cart.items.length){
      return res.status(400).json({ success:false, message:'Cart is empty' });
    }

    const total = cart.items.reduce((sum, item) => sum + item.price, 0);

    const profile = await UserProfile.findOne({ userId });
    const customerName = profile?.name || 'User';
    const customerPhone = req.user.mobile;
    const customerEmail = `${customerPhone}@ailisher.user`;

    const orderId = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;

    const payment = new Payment({
      orderId,
      amount: parseFloat(total.toFixed(2)),
      userId: userId,
      customerEmail,
      customerPhone,
      customerName,
      projectId: clientId || 'AILISHER',
      status: 'PENDING',
      // Store cart snapshot in metadata if model allows; else rely on Payment only
    });
    await payment.save();

    res.json({ success:true, orderId, amount: payment.amount, currency: 'INR' });
  }catch(err){
    console.error('checkout error', err);
    res.status(500).json({ success:false, message:'Checkout failed' });
  }
}


