import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import {helmetConfig} from './src/config/helmet.config.js';
import { corsConfig } from './src/config/cors.config.js';
const app = express();

app.use(helmetConfig);
app.use(cors(corsConfig));
app.use(cookieParser());
app.use(express.static('public'));
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: true, limit: '20kb' }))


app.get('/', (req, res) => {
    res.send('Hello World!')
});



//freelancer routes
import { authFreelancerRouter } from './src/routes/authFreelancer.route.js';
app.use('/api/v1/freelancer/auth', authFreelancerRouter);

import { freelancerStatusRouter } from './src/routes/freelancerStatus.route.js';
app.use('/api/v1/freelancer/status', freelancerStatusRouter);



//customer auth routes
import { authCustomerRouter } from './src/routes/authCustomer.route.js';
app.use('/api/v1/customer/auth', authCustomerRouter);


//job routes
import { jobRouter } from './src/routes/job.route.js';
app.use('/api/v1/job', jobRouter);



export { app }; 
