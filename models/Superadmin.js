const mongoose = require('mongoose');

const superadmin = mongoose.Schema({
    name:{
        type:String,
        required:true,
    },
    email:{
        type:String,
        required:true,  
    },
    password:{
        type:String,
        required:true,
    },
    createdAt:{
        type:Date,
        default:Date.now,
    }
})

module.exports=mongoose.model('Superadmin',superadmin);