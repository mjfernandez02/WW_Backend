import express from "express";
import authRoutes from "../modules/auth/auth.routes.js";
import practiceRoutes from "../modules/practice/practice.routes.js";

const router = express.Router();
router.use("/auth", authRoutes);
router.use("/practice", practiceRoutes);

export default router;
