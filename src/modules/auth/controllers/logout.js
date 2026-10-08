import { z } from "zod";
import * as authService from "../auth.service.js";
import {
  getRefreshTokenFromRequest,
  AUTH_SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "./helpers.js";

export const logout = async (req, res) => {
  try {
    const schema = z.object({ refreshToken: z.string().optional() });
    const { refreshToken } = schema.parse(req.body || {});
    const authHeader = req.headers.authorization;
    const accessToken =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : null;

    const cookieRefreshToken = getRefreshTokenFromRequest(req);

    if (!refreshToken && !accessToken && !cookieRefreshToken)
      return res.status(400).json({ error: "Missing token" });

    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers["user-agent"] || null;

    const ok = await authService.revokeSession({
      refreshToken: refreshToken || cookieRefreshToken,
      accessToken,
      ipAddress,
      userAgent,
    });
    const { maxAge, ...cookieOptions } = sessionCookieOptions();
    res.clearCookie(AUTH_SESSION_COOKIE_NAME, cookieOptions);
    if (!ok) return res.status(404).json({ error: "Session not found" });

    return res.json({ message: "Logged out" });
  } catch (err) {
    console.error("LOGOUT ERROR:", err && err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
