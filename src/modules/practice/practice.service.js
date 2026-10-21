import crypto from "crypto";
import db from "../../database/index.js";
import vocabulary from "./practiceVocabulary.json" with { type: "json" };

export const PRACTICE_QUESTION_COUNT = 5;
export const PRACTICE_XP_PER_CORRECT_ANSWER = 20;
export const PRACTICE_POINTS_PER_CORRECT_ANSWER = 5;
const PRACTICE_QUIZ_LIFETIME_MS = 30 * 60 * 1000;

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

const progressFor = (user) => ({ xp: user.xp, points: user.points });

export const getProgress = async (userId) => {
  const user = await db.User.findByPk(userId, {
    attributes: ["id", "xp", "points"],
  });

  if (!user) return null;

  return { userId: user.id, xp: user.xp, points: user.points };
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

  const entries = shuffle(vocabulary).slice(0, PRACTICE_QUESTION_COUNT);
  const generated = entries.map(createQuestion);
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
