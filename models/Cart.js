const mongoose = require('mongoose');

const CartItemSchema = new mongoose.Schema({
    workbookId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Workbook',
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    currency: {
        type: String,
        default: 'INR'
    }
}, { _id: false });

const CartSchema = new mongoose.Schema({
    userId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MobileUser',
        required: true,
        index: true
    },
    clientId:{
        type: String,
        required: true,
        index: true
    },
    items:{
        type: [CartItemSchema],
        default: []
    },
    createdAt:{
        type: Date,
        default: Date.now
    },
    updatedAt:{
        type: Date,
        default: Date.now
    }
})

CartSchema.index({ userId: 1, clientId: 1 }, { unique: true });

CartSchema.pre('save', function(next){
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Cart', CartSchema);