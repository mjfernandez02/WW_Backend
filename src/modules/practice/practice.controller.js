import { z } from "zod";
import * as practiceService from "./practice.service.js";

export const feedPet = async (req, res) => {
  try {
    const result = await practiceService.feedPet(req.user.userId);
    if (result.status === "user_not_found") {
      return res.status(404).json({ error: "User not found" });
    }
    if (result.status === "insufficient_points") {
      return res
        .status(409)
        .json({ error: "You need 10 coins to feed Maple." });
    }
    return res.json(result);
  } catch (err) {
    console.error("PET FEED ERROR:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
};

export const getProgress = async (req, res) => {
  try {
    const progress = await practiceService.getProgress(req.user.userId);
    if (!progress) return res.status(404).json({ error: "User not found" });
    return res.json(progress);
  } catch (err) {
    console.error("PRACTICE PROGRESS ERROR:", err && err.message);
    return res.status(500).json({ error: "Server error" });
  }
};

export const getLeaderboard = async (_req, res) => {
  try {
    const leaderboard = await practiceService.getLeaderboard();
    return res.json({ leaderboard });
  } catch (err) {
    console.error("PRACTICE LEADERBOARD ERROR:", err && err.message);
    return res.status(500).json({ error: "Server error" });
  }
};

export const getPracticeQuiz = async (req, res) => {
  try {
    const quiz = await practiceService.createPracticeQuiz(req.user.userId);
    if (!quiz) return res.status(404).json({ error: "User not found" });
    return res.status(201).json(quiz);
  } catch (err) {
    console.error("PRACTICE QUIZ ERROR:", err && err.message);
    return res.status(500).json({ error: "Server error" });
  }
};

export const completePractice = async (req, res) => {
  const schema = z.object({
    quizId: z.string().uuid(),
    answers: z
      .array(
        z.object({
          questionId: z.string().uuid(),
          optionId: z.string().uuid(),
        }),
      )
      .min(1)
      .max(practiceService.PRACTICE_QUESTION_COUNT),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid practice completion",
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  try {
    const result = await practiceService.completePractice({
      userId: req.user.userId,
      quizId: parsed.data.quizId,
      answers: parsed.data.answers,
    });
    if (result.status === "user_not_found") {
      return res.status(404).json({ error: "User not found" });
    }
    if (result.status === "quiz_not_found") {
      return res.status(404).json({ error: "Quiz not found" });
    }
    if (result.status === "quiz_expired") {
      return res.status(410).json({ error: "Quiz has expired" });
    }
    if (result.status === "invalid_answers") {
      return res.status(400).json({ error: "Answers do not match this quiz" });
    }
    return res.status(result.alreadyCompleted ? 200 : 201).json(result);
  } catch (err) {
    console.error("PRACTICE COMPLETION ERROR:", err && err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
