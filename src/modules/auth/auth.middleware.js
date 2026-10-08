// src/modules/auth/auth.middleware.js

import jwt from "jsonwebtoken";
import db from "../../database/index.js";
import auditLog from "../audit/log.js";

export const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    await auditLog("AUTH_FAILURE", { userId: null, ipAddress: req.ip });
    return res.status(401).json({ error: "No token provided" });
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({ error: "Invalid authorization format" });
  }

  const token = parts[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const session = await db.Session.findOne({
      where: { token, userId: decoded.userId },
    });

    if (!session || (session.expiresAt && new Date(session.expiresAt) <= new Date())) {
      await auditLog("AUTH_FAILURE", {
        userId: decoded.userId || null,
        ipAddress: req.ip,
      });
      return res.status(401).json({ error: "Session is no longer valid" });
    }

    const user = await db.User.findByPk(session.userId);
    if (!user) {
      await auditLog("AUTH_FAILURE", {
        userId: decoded.userId || null,
        ipAddress: req.ip,
      });
      return res.status(401).json({ error: "User is no longer available" });
    }

    req.user = {
      userId: user.id,
      id: user.id,
      email: user.email,
      roleId: user.roleId,
      xp: user.xp,
      points: user.points,
    };
    return next();
  } catch (err) {
    console.error("AuthMiddleware error:", err && err.message);
    await auditLog("AUTH_FAILURE", { userId: null, ipAddress: req.ip });
    return res.status(401).json({ error: "Invalid token" });
  }
};
