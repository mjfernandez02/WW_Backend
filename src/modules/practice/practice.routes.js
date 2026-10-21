import express from "express";
import { authenticate } from "../auth/auth.middleware.js";
import {
  completePractice,
  getPracticeQuiz,
  getProgress,
  feedPet,
} from "./practice.controller.js";

const router = express.Router();

router.use(authenticate);
router.get("/quiz", getPracticeQuiz);
router.get("/progress", getProgress);
router.post("/complete", completePractice);
router.post("/pet/feed", feedPet);

export default router;
