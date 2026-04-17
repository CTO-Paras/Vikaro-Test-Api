import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema({
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    subServiceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: String, 
    price: Number,
    image: String,
    quantity: { type: Number, default: 1 }
});

const cartSchema = new mongoose.Schema({
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "ProfileCustomer", required: true, unique: true },
    items: [cartItemSchema],
    totalAmount: { type: Number, default: 0 }
}, { timestamps: true });

export const Cart = mongoose.model("Cart", cartSchema);