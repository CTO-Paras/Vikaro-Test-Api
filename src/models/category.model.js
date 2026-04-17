import mongoose from "mongoose";

const subServiceSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, default: 1 },
    image: String,
    description: String,
    averageRating: { type: Number, default: 0 },
    totalBookingCount: { type: Number, default: 0 }
});

const serviceSchema = new mongoose.Schema({
    name: { type: String, required: true },
    logoImage: String,
    bannerImage: String,
    subServices: [subServiceSchema], 
});

const categorySchema = new mongoose.Schema({
    title: { type: String, required: true },
    services: [serviceSchema],
}, { timestamps: true });

categorySchema.index({ title: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

export const Category = mongoose.model("Category", categorySchema);