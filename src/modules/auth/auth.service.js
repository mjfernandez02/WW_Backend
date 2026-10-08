// src/modules/auth/auth.service.js

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import db from "../../database/index.js";
import auditLog from "../audit/log.js";
import { hasColumn } from "../../utils/dbSchema.js";

const { User, Role, Session, AuthorizationCode } = db;

export const registerUser = async ({ email, password }) => {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const existing = await User.findOne({ where: { email: normalizedEmail } });
  if (existing) throw new Error("Email already exists");

  const role = await Role.findOne({ where: { name: "USER" } });
  if (!role) throw new Error("Role not found");

  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || "12", 10);
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  // Account defaults are supplied by the migrated schema.
  const payload = {
    email: normalizedEmail,
    password: hashedPassword,
    roleId: role.id,
  };

  const user = await User.create(payload);

  return user;
};

export const loginUser = async (
  { email, password },
  { ipAddress = null, userAgent = null } = {},
) => {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const user = await User.findOne({ where: { email: normalizedEmail } });

  if (!user) throw new Error("Invalid credentials");

  // Check for account lockout
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    throw new Error("Account locked due to repeated failed login attempts");
  }

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    try {
      if (await hasColumn("Users", "failedLoginAttempts")) {
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
        // Lock account after 5 failed attempts for 15 minutes
        if (
          user.failedLoginAttempts >= 5 &&
          (await hasColumn("Users", "lockedUntil"))
        ) {
          user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        }
        await user.save();
      }
    } catch (e) {}
    throw new Error("Invalid credentials");
  }

  // Reset failed attempts on successful login
  if (
    (await hasColumn("Users", "failedLoginAttempts")) &&
    user.failedLoginAttempts &&
    user.failedLoginAttempts > 0
  ) {
    user.failedLoginAttempts = 0;
    if (await hasColumn("Users", "lockedUntil")) user.lockedUntil = null;
    try {
      await user.save();
    } catch (e) {}
  }

  // access token short-lived (15 minutes)
  const sessionResult = await createSession({ user, ipAddress, userAgent });

  // Audit log: login success
  try {
    await auditLog("LOGIN_SUCCESS", { userId: user.id, ipAddress });
  } catch (err) {}

  return { ...sessionResult, userId: user.id };
};

export const createSession = async ({
  user,
  ipAddress = null,
  userAgent = null,
} = {}) => {
  const accessToken = jwt.sign(
    { userId: user.id, roleId: user.roleId },
    process.env.JWT_SECRET,
    {
      expiresIn: "15m",
      jwtid: crypto.randomUUID(),
    },
  );

  const refreshToken = crypto.randomBytes(64).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await Session.create({
    token: accessToken,
    expiresAt,
    userId: user.id,
    refreshToken,
    userAgent,
    ipAddress,
  });

  return { accessToken, refreshToken };
};

export const createAuthorizationCode = async ({
  userId,
  clientId,
  redirectUri,
  codeChallenge = null,
  codeChallengeMethod = null,
  expiresInMs = 10 * 60 * 1000,
} = {}) => {
  const code = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + expiresInMs);

  return AuthorizationCode.create({
    code,
    clientId,
    redirectUri,
    userId,
    codeChallenge,
    codeChallengeMethod,
    expiresAt,
    used: false,
  });
};

export const consumeAuthorizationCode = async ({
  code,
  clientId,
  redirectUri,
  codeVerifier = null,
  requirePkce = false,
} = {}) =>
  db.sequelize.transaction(async (transaction) => {
    const authCode = await AuthorizationCode.findOne({
      where: {
        code,
        clientId,
        redirectUri,
        used: false,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!authCode) return null;
    if (
      requirePkce &&
      (!authCode.codeChallenge || authCode.codeChallengeMethod !== "S256")
    )
      return null;
    if (authCode.expiresAt && new Date(authCode.expiresAt) < new Date()) {
      await authCode.destroy({ transaction });
      return null;
    }

    // If PKCE was used when issuing the code, require and validate the verifier
    if (authCode.codeChallenge) {
      if (!codeVerifier) return null;

      const method = (authCode.codeChallengeMethod || "S256").toUpperCase();
      if (method === "S256") {
        const hash = crypto.createHash("sha256").update(codeVerifier).digest();
        const expected = hash
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
        if (expected !== authCode.codeChallenge) return null;
      } else if (method === "PLAIN") {
        if (codeVerifier !== authCode.codeChallenge) return null;
      } else {
        return null; // unsupported method
      }
    }

    authCode.used = true;
    await authCode.save({ transaction });
    return authCode;
  });

export const generateToken = (payload, expiresIn = "1h") => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

export const refreshAccessToken = async (
  refreshToken,
  { ipAddress = null, userAgent = null } = {},
) => {
  if (!refreshToken) return null;

  return db.sequelize.transaction(async (transaction) => {
    const session = await Session.findOne({
      where: { refreshToken },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!session) return null;

    // Optionally check ipAddress/userAgent matches for extra security
    // if (session.ipAddress && session.ipAddress !== ipAddress) return null;

    // Check expiry
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      // session expired
      await session.destroy({ transaction });
      return null;
    }

    // Load user to build payload
    const user = await User.findByPk(session.userId, { transaction });
    if (!user) return null;

    // Issue new access token
    const accessToken = jwt.sign(
      { userId: user.id, roleId: user.roleId },
      process.env.JWT_SECRET,
      {
        expiresIn: "15m",
        jwtid: crypto.randomUUID(),
      },
    );

    // Rotate refresh token
    const newRefreshToken = crypto.randomBytes(64).toString("hex");
    session.refreshToken = newRefreshToken;
    session.token = accessToken;
    session.userAgent = userAgent || session.userAgent;
    session.ipAddress = ipAddress || session.ipAddress;
    await session.save({ transaction });

    // Audit log: token refresh
    try {
      await auditLog("TOKEN_REFRESH", { userId: user.id, ipAddress });
    } catch (err) {}

    return { accessToken, refreshToken: newRefreshToken };
  });
};
export const revokeSession = async ({
  refreshToken = null,
  accessToken = null,
  ipAddress = null,
} = {}) => {
  if (refreshToken) {
    const session = await Session.findOne({ where: { refreshToken } });
    if (!session) return false;
    const userId = session.userId;
    await session.destroy();
    try {
      await auditLog("LOGOUT", { userId, ipAddress });
    } catch (err) {}
    return true;
  }

  if (accessToken) {
    const session = await Session.findOne({ where: { token: accessToken } });
    if (!session) return false;
    const userId = session.userId;
    await session.destroy();
    try {
      await auditLog("LOGOUT", { userId, ipAddress });
    } catch (err) {}
    return true;
  }

  return false;
};
