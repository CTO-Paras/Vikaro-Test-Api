
import { connectDB } from "./src/db/index.js";
import dotenv from "dotenv";
import { app } from "./app.js";
import { connectRedisConfig } from "./src/config/redis.config.js";
dotenv.config({
    path: './.env'
})

const PORT = process.env.LOCAL_PORT
 || 8000;

connectDB()
    .then(() => {
        app.listen(PORT, async() => {
            await connectRedisConfig();
            console.log(`Server is Runnning at PORT ${PORT}`)
        })
    }).catch((error) => {
        console.log('MONGO DB connection failed !! ', error)
    })