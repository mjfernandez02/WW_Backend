import crypto from "crypto";
import { z } from "zod";
import db from "../../database/index.js";
import vocabulary from "./practiceVocabulary.json" with { type: "json" };

export const PRACTICE_QUESTION_COUNT = 5;
export const PRACTICE_XP_PER_CORRECT_ANSWER = 20;
export const PRACTICE_POINTS_PER_CORRECT_ANSWER = 5;
const PRACTICE_QUIZ_LIFETIME_MS = 30 * 60 * 1000;
const AI_QUIZ_CACHE_LIFETIME_MS = 10 * 60 * 1000;
const GROQ_CHAT_COMPLETIONS_URL =
  "https://api.groq.com/openai/v1/chat/completions";

let cachedAiQuestions = null;

const aiQuizSchema = z.object({
  questions: z
    .array(
      z.object({
        word: z.string().trim().min(2).max(40),
        type: z.string().trim().min(2).max(30),
        meaning: z.string().trim().min(8).max(180),
        example: z.string().trim().min(12).max(240),
        distractors: z
          .array(z.string().trim().min(8).max(180))
          .length(2),
      }),
    )
    .length(PRACTICE_QUESTION_COUNT),
});

const shuffle = (items) => {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [
      shuffled[randomIndex],
      shuffled[index],
    ];
  }

  return shuffled;
};

const createQuestion = (entry) => {
  const distractors = [
    ...new Set(
      vocabulary
        .filter(
          (candidate) =>
            candidate.type === entry.type &&
            candidate.meaning !== entry.meaning,
        )
        .map((candidate) => candidate.meaning),
    ),
  ];
  const options = shuffle([
    entry.meaning,
    ...shuffle(distractors).slice(0, 2),
  ]).map((text) => ({ id: crypto.randomUUID(), text }));
  const questionId = crypto.randomUUID();

  return {
    question: {
      id: questionId,
      word: entry.word,
      type: entry.type,
      example: entry.example,
      options,
    },
    answerKey: {
      questionId,
      correctOptionId: options.find((option) => option.text === entry.meaning)
        .id,
      optionIds: options.map((option) => option.id),
    },
  };
};

const createQuestionFromAiEntry = (entry) => {
  const choices = [entry.meaning, ...entry.distractors];
  if (new Set(choices.map((choice) => choice.toLowerCase())).size !== 3) {
    throw new Error("AI quiz contains duplicate answer choices");
  }

  const options = shuffle(choices).map((text) => ({
    id: crypto.randomUUID(),
    text,
  }));
  const questionId = crypto.randomUUID();

  return {
    question: {
      id: questionId,
      word: entry.word,
      type: entry.type,
      example: entry.example,
      options,
    },
    answerKey: {
      questionId,
      correctOptionId: options.find((option) => option.text === entry.meaning)
        .id,
      optionIds: options.map((option) => option.id),
    },
  };
};

const practiceQuizPrompt = () => `You create vocabulary practice questions for WordWell.

Return exactly one JSON object and no markdown. It must match this shape:
{
  "questions": [
    {
      "word": "resilient",
      "type": "adjective",
      "meaning": "Able to recover quickly after difficulties.",
      "example": "The resilient community rebuilt after the storm.",
      "distractors": [
        "Likely to break under pressure.",
        "Able to remain completely still."
      ]
    }
  ]
}

Create exactly ${PRACTICE_QUESTION_COUNT} distinct, challenging English vocabulary questions for an upper-high-school or college learner (roughly CEFR C1-C2). Prefer precise, academic, literary, and professional words such as "circumspect", "equivocal", "ubiquitous", and "tenacious". Avoid beginner vocabulary, proper nouns, slang, archaic words, and words so obscure that they are unlikely to be useful. Each question must have one useful word, its accurate part of speech, a concise plain-English meaning, and a natural example sentence. Provide exactly two plausible but clearly incorrect meaning distractors. All three answer choices must be distinct and must not reveal the answer through wording, length, or phrases such as "all of the above". Use safe, neutral content without personal data, instructions, or factual-source claims.

The learner sees the word, its part of speech, the example, and then chooses its meaning. Do not include answer labels, IDs, explanations, or any fields beyond the specified JSON shape.`;

const getAiQuestions = async () => {
  if (!process.env.GROQ_API_KEY) return null;

  if (cachedAiQuestions?.expiresAt > Date.now()) {
    return cachedAiQuestions.questions;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You generate safe, accurate vocabulary assessment data. Return only valid JSON.",
          },
          { role: "user", content: practiceQuizPrompt() },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Groq quiz request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const parsed = aiQuizSchema.safeParse(JSON.parse(content));
    if (!parsed.success) throw new Error("Groq returned an invalid quiz shape");

    parsed.data.questions.forEach(createQuestionFromAiEntry);
    cachedAiQuestions = {
      questions: parsed.data.questions,
      expiresAt: Date.now() + AI_QUIZ_CACHE_LIFETIME_MS,
    };
    return cachedAiQuestions.questions;
  } catch (error) {
    console.warn("AI quiz unavailable; using vocabulary fallback.", error.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const progressFor = (user) => ({ xp: user.xp, points: user.points });

export const getProgress = async (userId) => {
  const user = await db.User.findByPk(userId, {
    attributes: ["id", "xp", "points"],
  });

  if (!user) return null;

  return { userId: user.id, xp: user.xp, points: user.points };
};

export const getLeaderboard = async () => {
  const users = await db.User.findAll({
    attributes: ["id", "username", "xp", "createdAt"],
    order: [
      ["xp", "DESC"],
      ["createdAt", "ASC"],
      ["id", "ASC"],
    ],
    limit: 100,
  });

  return users.map((user, index) => ({
    rank: index + 1,
    userId: user.id,
    username: user.username,
    xp: user.xp,
  }));
};

export const feedPet = async (userId) =>
  db.sequelize.transaction(async (transaction) => {
    const user = await db.User.findByPk(userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!user) return { status: "user_not_found" };
    const cost = 10;
    if (user.points < cost) return { status: "insufficient_points" };
    await user.update({ points: user.points - cost }, { transaction });
    return { status: "fed", pointsSpent: cost, ...progressFor(user) };
  });

export const createPracticeQuiz = async (userId) => {
  const user = await db.User.findByPk(userId, { attributes: ["id"] });
  if (!user) return null;

  const aiQuestions = await getAiQuestions();
  const generated = aiQuestions
    ? aiQuestions.map(createQuestionFromAiEntry)
    : shuffle(vocabulary).slice(0, PRACTICE_QUESTION_COUNT).map(createQuestion);
  const quizId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + PRACTICE_QUIZ_LIFETIME_MS);

  await db.PracticeQuiz.create({
    id: quizId,
    userId,
    answerKey: generated.map(({ answerKey }) => answerKey),
    expiresAt,
  });

  return {
    quizId,
    expiresAt,
    questions: generated.map(({ question }) => question),
  };
};

export const checkPracticeAnswer = async ({
  userId,
  quizId,
  questionId,
  optionId,
}) => {
  const quiz = await db.PracticeQuiz.findOne({
    where: { id: quizId, userId },
  });
  if (!quiz) return { status: "quiz_not_found" };
  if (new Date(quiz.expiresAt) <= new Date()) return { status: "quiz_expired" };

  const answer = quiz.answerKey?.find(
    (entry) => entry.questionId === questionId,
  );
  if (!answer || !answer.optionIds.includes(optionId)) {
    return { status: "invalid_answer" };
  }

  return {
    status: "checked",
    correct: answer.correctOptionId === optionId,
    correctOptionId: answer.correctOptionId,
  };
};

export const completePractice = async ({ userId, quizId, answers }) =>
  db.sequelize.transaction(async (transaction) => {
    const user = await db.User.findByPk(userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!user) return { status: "user_not_found" };

    const previousCompletion = await db.PracticeCompletion.findOne({
      where: { userId, practiceId: quizId },
      transaction,
    });

    if (previousCompletion) {
      return {
        status: "completed",
        awarded: false,
        alreadyCompleted: true,
        correctAnswers: previousCompletion.correctAnswers,
        totalQuestions: previousCompletion.totalQuestions,
        xpAwarded: previousCompletion.xpAwarded,
        pointsAwarded: previousCompletion.pointsAwarded,
        ...progressFor(user),
      };
    }

    const quiz = await db.PracticeQuiz.findOne({
      where: { id: quizId, userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!quiz) return { status: "quiz_not_found" };
    if (new Date(quiz.expiresAt) <= new Date()) {
      return { status: "quiz_expired" };
    }

    const answerKey = quiz.answerKey;
    const answerByQuestion = new Map(
      answers.map(({ questionId, optionId }) => [questionId, optionId]),
    );

    if (
      !Array.isArray(answerKey) ||
      answerByQuestion.size !== answers.length ||
      answers.length !== answerKey.length ||
      answerKey.some(
        ({ questionId, optionIds }) =>
          !answerByQuestion.has(questionId) ||
          !optionIds.includes(answerByQuestion.get(questionId)),
      )
    ) {
      return { status: "invalid_answers" };
    }

    const correctAnswers = answerKey.reduce(
      (total, { questionId, correctOptionId }) =>
        total + Number(answerByQuestion.get(questionId) === correctOptionId),
      0,
    );
    const xpAwarded = correctAnswers * PRACTICE_XP_PER_CORRECT_ANSWER;
    const pointsAwarded = correctAnswers * PRACTICE_POINTS_PER_CORRECT_ANSWER;

    await db.PracticeCompletion.create(
      {
        userId,
        practiceId: quizId,
        correctAnswers,
        totalQuestions: answerKey.length,
        xpAwarded,
        pointsAwarded,
      },
      { transaction },
    );

    await quiz.update(
      { answerKey: null, completedAt: new Date() },
      { transaction },
    );
    await user.update(
      {
        xp: user.xp + xpAwarded,
        points: user.points + pointsAwarded,
      },
      { transaction },
    );

    return {
      status: "completed",
      awarded: xpAwarded > 0 || pointsAwarded > 0,
      alreadyCompleted: false,
      correctAnswers,
      totalQuestions: answerKey.length,
      xpAwarded,
      pointsAwarded,
      ...progressFor(user),
    };
  });
