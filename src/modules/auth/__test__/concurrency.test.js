import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db from "../../../database/index.js";
import {
  createSession,
  createAuthorizationCode,
  consumeAuthorizationCode,
  refreshAccessToken,
} from "../auth.service.js";
import {
  createPracticeQuiz,
  completePractice,
  feedPet,
} from "../../practice/practice.service.js";

describe("PostgreSQL concurrency and reward protection", () => {
  let user;
  beforeAll(async () => {
    await db.sequelize.authenticate();
    const role = await db.Role.findOne({ where: { name: "USER" } });
    if (!role)
      throw new Error(
        "Seed USER roles in the test database before integration tests.",
      );
    user = await db.User.create({
      email: `concurrency-${crypto.randomUUID()}@example.com`,
      password: "unused",
      roleId: role.id,
    });
  });
  afterAll(async () => {
    if (user) {
      for (const model of [
        db.Session,
        db.AuthorizationCode,
        db.AuditLog,
        db.PracticeCompletion,
        db.PracticeQuiz,
      ]) {
        await model.destroy({ where: { userId: user.id } });
      }
      await user.destroy();
    }
    await db.sequelize.close();
  });

  it("accepts a concurrent authorization code exactly once", async () => {
    const code = await createAuthorizationCode({
      userId: user.id,
      clientId: "concurrency",
      redirectUri: "https://example.com/cb",
    });
    const input = {
      code: code.code,
      clientId: code.clientId,
      redirectUri: code.redirectUri,
    };
    const results = await Promise.all([
      consumeAuthorizationCode(input),
      consumeAuthorizationCode(input),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("rotates a concurrent refresh token exactly once", async () => {
    const session = await createSession({ user });
    const results = await Promise.all([
      refreshAccessToken(session.refreshToken),
      refreshAccessToken(session.refreshToken),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("awards concurrent quiz completions exactly once", async () => {
    const quiz = await createPracticeQuiz(user.id);
    const stored = await db.PracticeQuiz.findByPk(quiz.quizId);
    const input = {
      userId: user.id,
      quizId: quiz.quizId,
      answers: stored.answerKey.map(({ questionId, correctOptionId }) => ({
        questionId,
        optionId: correctOptionId,
      })),
    };
    const results = await Promise.all([
      completePractice(input),
      completePractice(input),
    ]);
    expect(results.filter((result) => result.awarded)).toHaveLength(1);
    await user.reload();
    expect(user.xp).toBe(100);
    expect(user.points).toBe(25);
  });

  it("concurrent feeding cannot overdraw the balance", async () => {
    await user.update({ points: 10 });
    const results = await Promise.all([feedPet(user.id), feedPet(user.id)]);
    expect(results.filter((result) => result.status === "fed")).toHaveLength(1);
    await user.reload();
    expect(user.points).toBe(0);
  });
});
