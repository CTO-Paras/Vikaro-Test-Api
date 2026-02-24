import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors'
import { corsConfig } from './src/config/cors.config.js';
const app = express();

app.use(cors(corsConfig))
app.use(cookieParser());
app.use(express.static('public'));
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: true, limit: '20kb' }))


app.get('/', (req, res) => {
    res.send('Hello World!')
});

export { app }; 
