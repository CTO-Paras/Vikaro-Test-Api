import express from 'express';
import http from "http";
import { Server } from "socket.io";
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



//freelancer auth routes
import { authFreelancerRouter } from './src/routes/authFreelancer.route.js';
app.use('/api/v1/freelancer/auth', authFreelancerRouter);

//customer auth routes
import { authCustomerRouter } from './src/routes/authCustomer.route.js';
app.use('/api/v1/customer/auth', authCustomerRouter);


//job routes
import { jobRouter } from './src/routes/job.route.js';
app.use('/api/v1/job', jobRouter);



export { app }; 
