import { describe, it, expect, beforeEach, afterAll } from "vitest";
import db from "../../../database/index.js";
import request from "supertest";
import app from "../../../app.js";

describe("Auth API", () => {
  let user;
  const emails = [];
  afterAll(async () => {
    for (const email of emails) {
      const found = await db.User.findOne({ where: { email } });
      if (found) {
        await db.Session.destroy({ where: { userId: found.id } });
        await db.AuditLog.destroy({ where: { userId: found.id } });
        await found.destroy();
      }
    }
    await db.sequelize.close();
  });

  beforeEach(() => {
    user = {
      email: `test${Date.now()}@mail.com`,
      password: "TestPassword123!",
    };
    emails.push(user.email);
  });

  it("registers a user", async () => {
    const res = await request(app).post("/api/auth/register").send(user);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.password).toBeUndefined();
  });

  it("logs in a user", async () => {
    await request(app).post("/api/auth/register").send(user);

    const res = await request(app).post("/api/auth/login").send(user);

    expect(res.statusCode).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });
});
