import express from "express";
import authRoutes from "../modules/auth/auth.routes.js";
import practiceRoutes from "../modules/practice/practice.routes.js";
import rewardsRoutes from "../modules/rewards/rewards.routes.js";

const router = express.Router();
router.use("/auth", authRoutes);
router.use("/practice", practiceRoutes);
router.use("/rewards", rewardsRoutes);

export default router;
