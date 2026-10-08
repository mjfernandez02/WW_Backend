import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import app from "../../../app.js";
import db from "../../../database/index.js";

describe("Authorization code flow", () => {
  const clientId = `client-${Date.now()}`;
  const clientSecret = "secret123";
  const redirectUri = "http://localhost/cb";
  let applicationId;
  let user;
  const emails = [];

  beforeAll(async () => {
    await db.sequelize.authenticate();
    const hashedSecret = await bcrypt.hash(clientSecret, 10);
    const application = await db.Application.create({
      name: "auth-code-test-app",
      clientId,
      clientSecret: hashedSecret,
      redirectUri,
    });
    applicationId = application.id;
  });

  afterAll(async () => {
    for (const email of emails) {
      const found = await db.User.findOne({ where: { email } });
      if (found) {
        await db.AuthorizationCode.destroy({ where: { userId: found.id } });
        await db.Session.destroy({ where: { userId: found.id } });
        await db.AuditLog.destroy({ where: { userId: found.id } });
        await found.destroy();
      }
    }
    if (applicationId) {
      await db.Application.destroy({ where: { id: applicationId } });
    }
    await db.sequelize.close();
  });

  beforeEach(() => {
    user = {
      email: `authflow-${Date.now()}@example.com`,
      password: "TestPassword123!",
    };
    emails.push(user.email);
  });

  it("redirects unauthenticated authorize requests to the frontend login page", async () => {
    const res = await request(app)
      .get("/api/auth/authorize")
      .query({ client_id: clientId, redirect_uri: redirectUri, state: "xyz" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(
      process.env.FRONTEND_LOGIN_URL || "http://localhost:5173/#/login",
    );
    expect(res.headers.location).toContain(
      `client_id=${encodeURIComponent(clientId)}`,
    );
    expect(res.headers.location).toContain(
      `redirect_uri=${encodeURIComponent(redirectUri)}`,
    );
    expect(res.headers.location).toContain("state=xyz");
  });

  it("exchanges an authorization code for access and refresh tokens", async () => {
    await request(app).post("/api/auth/register").send(user);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({
        ...user,
        client_id: clientId,
        redirect_uri: redirectUri,
        state: "xyz",
      });

    expect(loginRes.status).toBe(302);
    expect(loginRes.headers.location).toContain(`${redirectUri}?`);

    const codeMatch = loginRes.headers.location.match(/[?&]code=([^&]+)/);
    expect(codeMatch).toBeTruthy();
    const code = decodeURIComponent(codeMatch[1]);

    const tokenRes = await request(app).post("/api/auth/token").send({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      client_secret: clientSecret,
    });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.access_token).toBeDefined();
    expect(tokenRes.body.refresh_token).toBeDefined();
  });

  it("rejects an invalid or already used authorization code", async () => {
    await request(app).post("/api/auth/register").send(user);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({
        ...user,
        client_id: clientId,
        redirect_uri: redirectUri,
        state: "xyz",
      });

    const codeMatch = loginRes.headers.location.match(/[?&]code=([^&]+)/);
    expect(codeMatch).toBeTruthy();
    const code = decodeURIComponent(codeMatch[1]);

    const tokenRes1 = await request(app).post("/api/auth/token").send({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      client_secret: clientSecret,
    });

    expect(tokenRes1.status).toBe(200);
    expect(tokenRes1.body.access_token).toBeDefined();

    const tokenRes2 = await request(app).post("/api/auth/token").send({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      client_secret: clientSecret,
    });

    expect(tokenRes2.status).toBe(400);
    expect(tokenRes2.body.error).toBeDefined();
  });
});
