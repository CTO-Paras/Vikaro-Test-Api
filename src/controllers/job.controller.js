import { ApiResponse } from "../utils/APIResponce.js";
import { ApiError } from "../utils/APIError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Job } from "../models/job.model.js";
import { ProfileFreelancer } from "../models/profileFreelancer.model.js";
import { io } from "../../index.js"; // ✅ make sure this path is correct


const handlerCreateJob = asyncHandler(async (req, res) => {

  const { category,service, description } = req.body;

  const customer = req.user;

  // 3️⃣ Ensure customer location exists
  if (!customer.location || !customer.location.coordinates) {
    throw new ApiError(400, "Customer address location not set");
  }

  const customerCoordinates = customer.location.coordinates;

  // 4️⃣ Create Job
  const job = await Job.create({
    customer: customer._id,
    category,
    service,
    description,
    address: customer.address,
    location: {
      type: "Point",
      coordinates: customerCoordinates,
    },
    status: "pending",
  });

  // 5️⃣ Find Nearby Freelancers (1 KM radius)
  const nearbyFreelancers = await ProfileFreelancer.find({
    skill: service,
    status: "online",
    location: {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: customerCoordinates,
        },
        $maxDistance: 1000, // 1 KM
      },
    },
  }).select("_id"); // if using push later

  // 6️⃣ Emit job to each freelancer
  nearbyFreelancers.forEach((freelancer) => {
    io.to(`freelancer_${freelancer._id}`).emit("newJob", job);
  });

  // 7️⃣ Auto-expire after 30 seconds
  setTimeout(async () => {
    const existingJob = await Job.findById(job._id);

    if (existingJob && existingJob.status === "pending") {
      existingJob.status = "expired";
      await existingJob.save();

      // Optional: notify customer job expired
      io.to(`customer_${customer._id}`).emit("jobExpired", {
        jobId: job._id,
      });
    }
  }, 30000);

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        job,
        freelancersNotified: nearbyFreelancers.length,
      },
      "Job created successfully"
    )
  );
});


const handlerAcceptJob = asyncHandler(async (req, res) => {
  const { jobId } = req.body;
  const freelancer = req.user;

  if (freelancer.role !== "freelancer") {
    throw new ApiError(403, "Only freelancers can accept jobs");
  }

  // 🔒 Atomic update (Race condition safe)
  const job = await Job.findOneAndUpdate(
    { _id: jobId, status: "pending" },
    {
      status: "accepted",
      acceptedBy: freelancer._id,
    },
    { new: true }
  );

  if (!job) {
    throw new ApiError(400, "Job already accepted or expired");
  }

  // 🟡 Set freelancer busy
  await ProfileFreelancer.findByIdAndUpdate(freelancer._id, {
    status: "busy",
  });

  // 🔔 Notify both sides
  notifyCustomerJobAccepted(job.customer, job);
  notifyFreelancerJobAccepted(freelancer._id, job);

  return res.status(200).json(
    new ApiResponse(
      200,
      job,
      "Job accepted successfully"
    )
  );
});


export { handlerCreateJob, handlerAcceptJob };