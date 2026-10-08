import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import bcrypt from "bcrypt";

const { db } = vi.hoisted(() => ({
  db: {
    User: { findOne: vi.fn(), findByPk: vi.fn(), create: vi.fn() },
    Role: { findOne: vi.fn() },
    Session: { findOne: vi.fn(), create: vi.fn() },
    AuthorizationCode: { findOne: vi.fn(), create: vi.fn() },
    Application: { findOne: vi.fn() },
    AuditLog: { create: vi.fn() },
    sequelize: { transaction: vi.fn() },
  },
}));
vi.mock("../../../database/index.js", () => ({ default: db }));
vi.mock("../../../utils/dbSchema.js", () => ({
  hasColumn: vi.fn().mockResolvedValue(true),
}));
import app from "../../../app.js";
import {
  consumeAuthorizationCode,
  createSession,
  refreshAccessToken,
} from "../auth.service.js";
import { authorizationRedirect } from "../controllers/helpers.js";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = "unit-test-secret";
  process.env.BCRYPT_SALT_ROUNDS = "4";
  db.AuditLog.create.mockResolvedValue({});
  db.User.findOne.mockResolvedValue(null);
  db.Role.findOne.mockResolvedValue({ id: 2 });
  db.User.findByPk.mockResolvedValue({ id: 42, roleId: 2 });
  db.sequelize.transaction.mockImplementation((callback) =>
    callback({ LOCK: { UPDATE: "UPDATE" } }),
  );
});

describe("auth security regressions", () => {
  it("returns a validated JSON redirect for browser OAuth login", async () => {
    const password = "SecurePassword123!";
    const user = {
      id: 42,
      roleId: 2,
      password: await bcrypt.hash(password, 4),
    };
    const redirectUri = "https://example.com/#/callback";
    db.Application.findOne.mockResolvedValue({
      clientId: "public",
      redirectUri,
      clientSecret: null,
    });
    db.User.findOne.mockResolvedValue(user);
    db.AuthorizationCode.create.mockResolvedValue({ code: "single-use-code" });
    const response = await request(app)
      .post("/api/auth/login")
      .set("Accept", "application/json")
      .send({
        email: "user@example.com",
        password,
        client_id: "public",
        redirect_uri: redirectUri,
        state: "state",
        code_challenge: "challenge",
        code_challenge_method: "S256",
      });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      redirectUrl:
        "https://example.com/#/callback?code=single-use-code&state=state",
    });
    expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
  });

  it("rejects unregistered redirect URIs before creating a session", async () => {
    db.Application.findOne.mockResolvedValue({
      redirectUri: "https://example.com/cb",
    });
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: "user@example.com",
        password: "password",
        client_id: "client",
        redirect_uri: "https://attacker.example/cb",
      });
    expect(response.status).toBe(400);
    expect(db.Session.create).not.toHaveBeenCalled();
  });
  it("does not return the stored password hash at registration", async () => {
    db.User.create.mockResolvedValue({
      id: 42,
      email: "user@example.com",
      roleId: 2,
      password: "sensitive-hash",
      failedLoginAttempts: 0,
      xp: 0,
      points: 0,
    });
    const response = await request(app)
      .post("/api/auth/register")
      .send({ email: "user@example.com", password: "SecurePassword123!" });
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({
      id: 42,
      email: "user@example.com",
      roleId: 2,
      xp: 0,
      points: 0,
    });
  });

  it("accepts a wrong short password as a credential failure without logging it", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "user@example.com", password: "wrong" });
      expect(response.status).toBe(401);
      expect(response.body.errorCode).toBe("INVALID_CREDENTIALS");
      expect(
        JSON.stringify([...log.mock.calls, ...errorLog.mock.calls]),
      ).not.toContain("wrong");
    } finally {
      log.mockRestore();
      errorLog.mockRestore();
    }
  });

  it("uses distinct access tokens for sessions created in the same second", async () => {
    const user = { id: 42, roleId: 2 };
    const [first, second] = await Promise.all([
      createSession({ user }),
      createSession({ user }),
    ]);
    expect(first.accessToken).not.toBe(second.accessToken);
    expect(jwt.verify(first.accessToken, process.env.JWT_SECRET).userId).toBe(
      42,
    );
  });

  it("rejects public-client code exchange without PKCE", async () => {
    db.AuthorizationCode.findOne.mockResolvedValue({ codeChallenge: null });
    expect(
      await consumeAuthorizationCode({ code: "code", requirePkce: true }),
    ).toBeNull();
  });

  it("checks the verifier before consuming a locked authorization code", async () => {
    const verifier = "a".repeat(43);
    const code = {
      codeChallenge: crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64url"),
      codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + 60_000),
      save: vi.fn(),
      destroy: vi.fn(),
      used: false,
    };
    db.AuthorizationCode.findOne.mockResolvedValue(code);
    expect(
      await consumeAuthorizationCode({ code: "code", codeVerifier: "wrong" }),
    ).toBeNull();
    expect(code.save).not.toHaveBeenCalled();
    expect(
      await consumeAuthorizationCode({ code: "code", codeVerifier: verifier }),
    ).toBe(code);
    expect(code.used).toBe(true);
    expect(db.AuthorizationCode.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: "UPDATE" }),
    );
    expect(code.save).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: expect.any(Object) }),
    );
  });

  it("rotates a locked refresh token inside the transaction", async () => {
    const session = {
      userId: 42,
      refreshToken: "old",
      expiresAt: new Date(Date.now() + 60_000),
      save: vi.fn(),
    };
    db.Session.findOne.mockResolvedValue(session);
    const tokens = await refreshAccessToken("old");
    expect(tokens.refreshToken).not.toBe("old");
    expect(session.token).toBe(tokens.accessToken);
    expect(db.Session.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: "UPDATE" }),
    );
    expect(session.save).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: expect.any(Object) }),
    );
  });

  it("preserves hash routes and existing query parameters in redirects", () => {
    expect(
      authorizationRedirect(
        "https://example.com/#/callback?mode=login",
        new URLSearchParams({ code: "abc", state: "xyz" }),
      ),
    ).toBe("https://example.com/#/callback?mode=login&code=abc&state=xyz");
    expect(
      authorizationRedirect(
        "https://example.com/callback?mode=login",
        new URLSearchParams({ code: "abc" }),
      ),
    ).toBe("https://example.com/callback?mode=login&code=abc");
  });

  it("returns 400 for malformed refresh requests", async () => {
    const response = await request(app).post("/api/auth/refresh").send({});
    expect(response.status).toBe(400);
  });
});
