import request from "supertest";
import app from "../../../app.js";
import db from "../../../database/index.js";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe("Auth access/refresh flow", () => {
  const email = `test-${Date.now()}@example.com`;
  const password = "Pass123!wordLong";
  let refreshToken;
  let accessToken;
  let userId;

  beforeAll(async () => {
    await db.sequelize.authenticate();
  });

  afterAll(async () => {
    try {
      if (userId) {
        await db.Session.destroy({ where: { userId } });
        await db.AuditLog.destroy({ where: { userId } });
        await db.User.destroy({ where: { id: userId } });
      } else {
        await db.User.destroy({ where: { email } });
      }
    } catch (err) {
      // best-effort cleanup
      // eslint-disable-next-line no-console
      console.error("cleanup error", err && err.message);
    }
    await db.sequelize.close();
  });

  it("registers a user", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email, password });
    expect(res.status).toBe(201);
  });

  it("logs in and receives tokens", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;

    const jwt = (await import("jsonwebtoken")).default;
    const decoded = jwt.decode(accessToken);
    userId = decoded && decoded.userId;
  });

  it("accesses protected route with access token", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
  });

  it("refreshes tokens and rotates refresh token", async () => {
    const r1 = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeDefined();
    expect(r1.body.refreshToken).toBeDefined();
    const newRefresh = r1.body.refreshToken;
    accessToken = r1.body.accessToken;

    // old refreshToken should no longer work
    await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken })
      .expect(401);

    refreshToken = newRefresh;
  });

  it("logout invalidates the refresh token", async () => {
    // logout using the current refreshToken
    const out = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken });
    expect(out.status).toBe(200);

    // now refresh should fail
    await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken })
      .expect(401);

    await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(401);
  });
});
