import mongoose from "mongoose";

const subServiceSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, default: 1 },
    image: String,
    description: String,
    averageRating: { type: Number, default: 0 },
    totalBookingCount: { type: Number, default: 0 },
    ratingTotal: { type: Number, default: 0 }
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

export const ensureCategoryIndexes = async () => {
    const existingIndexes = await Category.collection.indexes();
    const staleNameIndexes = existingIndexes.filter((indexDef) => indexDef?.key?.name === 1);

    for (const staleIndex of staleNameIndexes) {
        if (staleIndex?.name && staleIndex.name !== "_id_") {
            await Category.collection.dropIndex(staleIndex.name);
        }
    }

    await Category.syncIndexes();   
};