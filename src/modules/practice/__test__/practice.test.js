import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    AuditLog: { create: vi.fn() },
    Session: { findOne: vi.fn() },
    User: { findByPk: vi.fn(), findAll: vi.fn() },
    PracticeQuiz: { create: vi.fn(), findOne: vi.fn() },
    PracticeCompletion: { findOne: vi.fn(), create: vi.fn() },
    sequelize: { transaction: vi.fn() },
  },
}));

vi.mock("../../../database/index.js", () => ({ default: mockDb }));

import app from "../../../app.js";

describe("practice progress and server-side grading", () => {
  const userId = 42;
  const secret = "practice-test-secret";
  const transaction = { LOCK: { UPDATE: "UPDATE" } };
  let user;
  let quizzes;
  let completions;
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    token = jwt.sign({ userId, roleId: 1 }, secret);
    quizzes = [];
    completions = [];
    user = {
      id: userId,
      xp: 0,
      points: 0,
      update: vi.fn(async function (values) {
        Object.assign(this, values);
        return this;
      }),
    };

    mockDb.User.findByPk.mockReset().mockResolvedValue(user);
    mockDb.User.findAll.mockReset().mockResolvedValue([]);
    mockDb.Session.findOne.mockReset().mockResolvedValue({
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockDb.AuditLog.create.mockReset().mockResolvedValue({});
    mockDb.PracticeQuiz.create.mockReset().mockImplementation(async (quiz) => {
      const storedQuiz = {
        ...quiz,
        update: vi.fn(async function (values) {
          Object.assign(this, values);
          return this;
        }),
      };
      quizzes.push(storedQuiz);
      return storedQuiz;
    });
    mockDb.PracticeQuiz.findOne
      .mockReset()
      .mockImplementation(
        async ({ where }) =>
          quizzes.find(
            (quiz) => quiz.id === where.id && quiz.userId === where.userId,
          ) || null,
      );
    mockDb.PracticeCompletion.findOne
      .mockReset()
      .mockImplementation(
        async ({ where }) =>
          completions.find(
            (completion) =>
              completion.userId === where.userId &&
              completion.practiceId === where.practiceId,
          ) || null,
      );
    mockDb.PracticeCompletion.create
      .mockReset()
      .mockImplementation(async (completion) => {
        completions.push(completion);
        return completion;
      });
    mockDb.sequelize.transaction
      .mockReset()
      .mockImplementation(async (callback) => callback(transaction));
  });

  const createQuiz = async () =>
    request(app)
      .get("/api/practice/quiz")
      .set("Authorization", `Bearer ${token}`);

  const submitQuiz = (quizId, answers) =>
    request(app)
      .post("/api/practice/complete")
      .set("Authorization", `Bearer ${token}`)
      .send({ quizId, answers });

  it("rejects unauthenticated practice and feeding requests", async () => {
    await request(app).get("/api/practice/quiz").expect(401);
    await request(app).post("/api/practice/pet/feed").send({}).expect(401);
    expect(user.update).not.toHaveBeenCalled();
  });

  it("uses the current database role rather than a stale admin JWT claim", async () => {
    user.roleId = 2;
    await request(app)
      .get("/api/auth/admin")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("deducts the server-owned feed cost without changing XP", async () => {
    user.xp = 100;
    user.points = 15;
    const response = await request(app)
      .post("/api/practice/pet/feed")
      .set("Authorization", `Bearer ${token}`)
      .send({ cost: 0, userId: 999 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      pointsSpent: 10,
      points: 5,
      xp: 100,
    });
  });

  it("does not deduct points when the balance is insufficient", async () => {
    user.points = 9;
    await request(app)
      .post("/api/practice/pet/feed")
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(409);
    expect(user.update).not.toHaveBeenCalled();
    expect(user.points).toBe(9);
  });

  it("rejects another user's quiz", async () => {
    await createQuiz();
    const quiz = quizzes[0];
    const answers = quiz.answerKey.map(({ questionId, correctOptionId }) => ({
      questionId,
      optionId: correctOptionId,
    }));
    quiz.userId = 999;
    await submitQuiz(quiz.id, answers).expect(404);
    expect(user.update).not.toHaveBeenCalled();
  });

  it("rejects expired quizzes without awarding rewards", async () => {
    await createQuiz();
    const quiz = quizzes[0];
    quiz.expiresAt = new Date(Date.now() - 1);
    const answers = quiz.answerKey.map(({ questionId, correctOptionId }) => ({
      questionId,
      optionId: correctOptionId,
    }));
    await submitQuiz(quiz.id, answers).expect(410);
    expect(user.update).not.toHaveBeenCalled();
  });

  it("returns persisted user XP and points", async () => {
    user.xp = 30;
    user.points = 15;

    const response = await request(app)
      .get("/api/practice/progress")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId, xp: 30, points: 15 });
  });

  it("returns users ordered by XP with email and stable ranks", async () => {
    mockDb.User.findAll.mockResolvedValue([
      { id: 7, email: "top@example.com", xp: 240 },
      { id: userId, email: "learner@example.com", xp: 120 },
    ]);

    const response = await request(app)
      .get("/api/practice/leaderboard")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      leaderboard: [
        { rank: 1, userId: 7, email: "top@example.com", xp: 240 },
        { rank: 2, userId, email: "learner@example.com", xp: 120 },
      ],
    });
    expect(mockDb.User.findAll).toHaveBeenCalledWith({
      attributes: ["id", "email", "xp"],
      order: [
        ["xp", "DESC"],
        ["id", "ASC"],
      ],
      limit: 100,
    });
  });

  it("requires authentication to view the leaderboard", async () => {
    await request(app).get("/api/practice/leaderboard").expect(401);
    expect(mockDb.User.findAll).not.toHaveBeenCalled();
  });

  it("rejects a valid JWT when its database session has been revoked", async () => {
    mockDb.Session.findOne.mockResolvedValueOnce(null);

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
  });

  it("generates a quiz without exposing its answer key", async () => {
    const response = await createQuiz();

    expect(response.status).toBe(201);
    expect(response.body.questions).toHaveLength(5);
    expect(response.body.questions[0].options).toHaveLength(3);
    expect(response.body.questions[0].correctAnswer).toBeUndefined();
    expect(response.body.questions[0].answerKey).toBeUndefined();
    expect(quizzes[0].answerKey).toHaveLength(5);
  });

  it("awards XP and points according to server-graded correct answers", async () => {
    const quizResponse = await createQuiz();
    const quiz = quizzes[0];
    const answers = quiz.answerKey.map((answer, index) => ({
      questionId: answer.questionId,
      optionId:
        index < 2
          ? answer.correctOptionId
          : answer.optionIds.find(
              (optionId) => optionId !== answer.correctOptionId,
            ),
    }));

    const response = await submitQuiz(quiz.id, answers);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      awarded: true,
      alreadyCompleted: false,
      correctAnswers: 2,
      totalQuestions: 5,
      xpAwarded: 40,
      pointsAwarded: 10,
      xp: 40,
      points: 10,
    });
    expect(response.body.quizId).toBeUndefined();
    expect(user.update).toHaveBeenCalledTimes(1);
    expect(quiz.update).toHaveBeenCalledWith(
      { answerKey: null, completedAt: expect.any(Date) },
      { transaction },
    );

    const retry = await submitQuiz(quiz.id, answers);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({
      awarded: false,
      alreadyCompleted: true,
      correctAnswers: 2,
      xpAwarded: 40,
      pointsAwarded: 10,
      xp: 40,
      points: 10,
    });
    expect(mockDb.PracticeCompletion.create).toHaveBeenCalledTimes(1);
    expect(user.update).toHaveBeenCalledTimes(1);
    expect(quizResponse.body.quizId).toBe(quiz.id);
  });

  it("rejects answers that do not match the issued quiz", async () => {
    const quizResponse = await createQuiz();
    const invalidAnswers = quizzes[0].answerKey.map((answer) => ({
      questionId: answer.questionId,
      optionId: crypto.randomUUID(),
    }));

    const response = await submitQuiz(quizResponse.body.quizId, invalidAnswers);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Answers do not match this quiz");
    expect(mockDb.PracticeCompletion.create).not.toHaveBeenCalled();
    expect(user.update).not.toHaveBeenCalled();
  });

  it("awards no XP or points when no answers are correct", async () => {
    const quizResponse = await createQuiz();
    const quiz = quizzes[0];
    const allIncorrect = quiz.answerKey.map((answer) => ({
      questionId: answer.questionId,
      optionId: answer.optionIds.find(
        (optionId) => optionId !== answer.correctOptionId,
      ),
    }));

    const response = await submitQuiz(quiz.id, allIncorrect);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      awarded: false,
      correctAnswers: 0,
      xpAwarded: 0,
      pointsAwarded: 0,
      xp: 0,
      points: 0,
    });
    expect(quizResponse.body.quizId).toBe(quiz.id);
  });

  it("rejects a completion without answer selections", async () => {
    const response = await request(app)
      .post("/api/practice/complete")
      .set("Authorization", `Bearer ${token}`)
      .send({ quizId: crypto.randomUUID(), answers: [] });

    expect(response.status).toBe(400);
    expect(mockDb.PracticeCompletion.create).not.toHaveBeenCalled();
  });
});
