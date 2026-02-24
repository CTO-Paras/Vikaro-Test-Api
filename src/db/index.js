import mongoose from "mongoose";

const connectDB = async () => {
    try {
        const connectionInstance = await mongoose.connect(`${process.env.MONGO_DB_LOCAL_URI}/${process.env.MONGO_DB_LOCAL_NAME}`)
        // const connectionInstance = await mongoose.connect(`${process.env.MONGO_DB_ATLAS_URI}/${process.env.MONGO_DB_ATLAS_NAME}`)
        // console.log(connectionInstance);
        console.log(`MongoDB connected successfully || ${connectionInstance.connection.host}`)
    } catch (error) {
        console.error("Mongoose connection failed ", error.message);
        process.exit(1);
    }
}

export { connectDB }