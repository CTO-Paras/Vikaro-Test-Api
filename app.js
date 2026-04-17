import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { helmetConfig } from './src/config/helmet.config.js';
import { corsConfig } from './src/config/cors.config.js';
import { morganConfig } from './src/config/morgan.config.js';


const app = express();

app.set('trust proxy', 1);
app.use(helmetConfig);
app.use(morganConfig);
app.use(cors(corsConfig));
app.use(cookieParser());
app.use(express.static('public'));
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: true, limit: '20kb' }));
app.use('/api/v1/job/workflow/payment-webhook', express.raw({ type: 'application/json' }));


//General route
app.get('/', (req, res) => {
    res.send('Hello World!');
});

//Rate limiter middleware for all API routes
// import { apiRateLimiterMiddleware } from './src/middlewares/rateLimit.middleware.js';
// app.use('/api', apiRateLimiterMiddleware);


//freelancer routes
import { authFreelancerRouter } from './src/routes/authFreelancer.route.js';
app.use('/api/v1/freelancer/auth', authFreelancerRouter);

import { freelancerStatusRouter } from './src/routes/freelancerStatus.route.js';
app.use('/api/v1/freelancer/status', freelancerStatusRouter);

import { freelancerJobHistoryRouter } from './src/routes/freelancerJobHistory.route.js';
app.use('/api/v1/freelancer', freelancerJobHistoryRouter);

import { freelancerUpiRouter } from './src/routes/freelancerUpi.route.js';
app.use('/api/v1/freelancer/upi', freelancerUpiRouter);


//customer auth routes
import { authCustomerRouter } from './src/routes/authCustomer.route.js';
app.use('/api/v1/customer/auth', authCustomerRouter);

//admin routes
import { adminRouter } from './src/routes/admin.route.js';
app.use('/api/v1/admin', adminRouter);

//service routes
import { categoryRouter } from "./src/routes/category.route.js";
app.use("/api/v1/categories", categoryRouter);

//cart routes
import { cartRouter } from "./src/routes/cart.route.js"
app.use("/api/v1/cart", cartRouter);

//job routes
import { jobRouter } from './src/routes/job.route.js';
app.use('/api/v1/job', jobRouter);

import { jobStatusRouter } from './src/routes/jobStatus.route.js';
app.use('/api/v1/job/status', jobStatusRouter);

import { jobPaymentRouter } from './src/routes/payment.route.js';
app.use('/api/v1/job/workflow', jobPaymentRouter);


//Freelancer wallet routes
import { WalletFreelancerRouter } from './src/routes/wallet.route.js';
app.use('/api/v1/freelancer/wallet', WalletFreelancerRouter);

//Freelancer Subscription routes
import { subscriptionFreelancerRouter } from './src/routes/subscription.route.js';
app.use('/api/v1/freelancer/subscription', subscriptionFreelancerRouter);

//Freelancer Rating routes
import { ratingFreelancerRouter } from './src/routes/rating.route.js';
app.use('/api/v1/freelancer/rating', ratingFreelancerRouter);


export { app };