import express from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { getRewards, unlockReward } from "./rewards.controller.js";

const router = express.Router();
router.use(authenticate);
router.get("/", getRewards);
router.post("/unlock", unlockReward);

export default router;
