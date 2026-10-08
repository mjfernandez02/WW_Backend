import request from "supertest";
import app from "../../../app.js";
import db from "../../../database/index.js";
import bcrypt from "bcrypt";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe("Audit logging integration", () => {
  const email = `audit-${Date.now()}@example.com`;
  const password = "AuditTestPassword123!";
  const clientId = `client-${Date.now()}`;
  const clientSecret = "client-secret";
  let userId;
  let refreshToken;
  let applicationId;

  beforeAll(async () => {
    await db.sequelize.authenticate();
  });

  afterAll(async () => {
    try {
      if (userId) {
        await db.Session.destroy({ where: { userId } });
        await db.AuditLog.destroy({ where: { userId } });
        await db.User.destroy({ where: { id: userId } });
      }
      if (applicationId) {
        await db.Application.destroy({ where: { id: applicationId } });
      }
    } catch (err) {
      // ignore cleanup errors
    }
    await db.sequelize.close();
  });

  it("registers and writes REGISTER_SUCCESS", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email, password });
    expect(res.status).toBe(201);

    const user = await db.User.findOne({ where: { email } });
    expect(user).toBeTruthy();
    userId = user.id;

    const log = await db.AuditLog.findOne({
      where: { action: "REGISTER_SUCCESS", userId },
    });
    expect(log).toBeTruthy();
  });

  it("records LOGIN_FAILURE on bad password", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({ email, password: "wrong" })
      .expect(401);

    const log = await db.AuditLog.findOne({
      where: { action: "LOGIN_FAILURE", userId },
    });
    expect(log).toBeTruthy();
  });

  it("records LOGIN_SUCCESS and issues tokens", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    refreshToken = res.body.refreshToken;

    const log = await db.AuditLog.findOne({
      where: { action: "LOGIN_SUCCESS", userId },
    });
    expect(log).toBeTruthy();
  });

  it("records TOKEN_REFRESH when refreshing", async () => {
    const r = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeDefined();
    expect(r.body.refreshToken).toBeDefined();

    const log = await db.AuditLog.findOne({
      where: { action: "TOKEN_REFRESH", userId },
    });
    expect(log).toBeTruthy();

    // use rotated refreshToken for logout
    refreshToken = r.body.refreshToken;
  });

  it("records LOGOUT when logging out", async () => {
    const out = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken });
    expect(out.status).toBe(200);

    const log = await db.AuditLog.findOne({
      where: { action: "LOGOUT", userId },
    });
    expect(log).toBeTruthy();
  });

  it("issues client token and records CLIENT_TOKEN_ISSUED", async () => {
    const hashed = await bcrypt.hash(clientSecret, 10);
    const appRec = await db.Application.create({
      name: "audit-app",
      clientId,
      clientSecret: hashed,
      redirectUri: "http://localhost/cb",
    });
    applicationId = appRec.id;

    const res = await request(app)
      .post("/api/auth/client-token")
      .set("x-client-id", clientId)
      .set("x-client-secret", clientSecret);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();

    const log = await db.AuditLog.findOne({
      where: { action: "CLIENT_TOKEN_ISSUED", userId: null },
    });
    expect(log).toBeTruthy();
  });
});
