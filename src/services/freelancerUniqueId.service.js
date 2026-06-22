import { ApiError } from "../utils/APIError.js";
import { Counter, ProfileFreelancer } from "../models/profileFreelancer.model.js";

const FREELANCER_COUNTER_KEY = "freelancer_unique_id";
const FREELANCER_UNIQUE_ID_PREFIX = "VK";
const MAX_ASSIGN_ATTEMPTS = 5;

const formatFreelancerUniqueId = (sequence) =>
  `${FREELANCER_UNIQUE_ID_PREFIX}${String(sequence).padStart(3, "0")}`;

const getNextFreelancerUniqueId = async () => {
  const counter = await Counter.findOneAndUpdate(
    { key: FREELANCER_COUNTER_KEY },
    {
      $setOnInsert: { key: FREELANCER_COUNTER_KEY },
      $inc: { value: 1 },
    },
    {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: true,
    }
  );

  return formatFreelancerUniqueId(counter.value);
};

const ensureFreelancerUniqueId = async (freelancerId) => {
  const freelancer = await ProfileFreelancer.findById(freelancerId).select(
    "freelancerUniqueId"
  );

  if (!freelancer) {
    throw new ApiError(404, "Freelancer not found");
  }

  if (freelancer.freelancerUniqueId) {
    return freelancer.freelancerUniqueId;
  }

  for (let attempt = 0; attempt < MAX_ASSIGN_ATTEMPTS; attempt += 1) {
    const freelancerUniqueId = await getNextFreelancerUniqueId();

    try {
      const updatedFreelancer = await ProfileFreelancer.findOneAndUpdate(
        {
          _id: freelancer._id,
          $or: [
            { freelancerUniqueId: null },
            { freelancerUniqueId: { $exists: false } },
          ],
        },
        { $set: { freelancerUniqueId } },
        { returnDocument: "after", strict: false }
      ).select("freelancerUniqueId");

      if (updatedFreelancer?.freelancerUniqueId) {
        return updatedFreelancer.freelancerUniqueId;
      }

      const existingFreelancer = await ProfileFreelancer.findById(freelancer._id).select(
        "freelancerUniqueId"
      );
      if (existingFreelancer?.freelancerUniqueId) {
        return existingFreelancer.freelancerUniqueId;
      }
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
    }
  }

  throw new ApiError(500, "Unable to generate freelancer unique ID");
};

export { ensureFreelancerUniqueId, getNextFreelancerUniqueId };