import mongoose from "mongoose";
import { ensureTransactionIndexes } from "../models/transaction.model.js";
import { isProductionEnv } from "../utils/env.js";

const getMongoUri = () => {
    const localUri = process.env.MONGO_DB_LOCAL_URI;
    const productionUri = process.env.MONGO_DB_PRODUCTION_URI;

    const mongoUri = isProductionEnv() ? productionUri || localUri : localUri || productionUri;
    if (!mongoUri) {
        throw new Error("MongoDB URI is not configured");
    }

    return mongoUri;
};

const connectDB = async () => {
    try {
        const connectionInstance = await mongoose.connect(getMongoUri())
        console.log("DB NAME:", connectionInstance.connection.name);
        console.log(`MongoDB connected successfully || ${connectionInstance.connection.host}`)
        await ensureTransactionIndexes();
    } catch (error) {
        console.error("Mongoose connection failed ", error.message);
        process.exit(1);
    }
}

const disconnectDB = async () => { 
    if (mongoose.connection.readyState === 0) return;
    await mongoose.connection.close();
    console.log("MongoDB connection closed");
}

export { connectDB, disconnectDB }
