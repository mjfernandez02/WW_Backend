import db from "../../../database/index.js";
import jwt from "jsonwebtoken";
import auditLog from "../../audit/log.js";

export const FRONTEND_LOGIN_URL =
  process.env.FRONTEND_LOGIN_URL || "http://localhost:5173/#/login";
export const AUTH_SESSION_COOKIE_NAME =
  process.env.AUTH_SESSION_COOKIE_NAME || "auth_session";

// Hash-router clients keep route parameters in the fragment.
export const authorizationRedirect = (redirectUri, params) => {
  const url = new URL(redirectUri);
  if (url.hash.startsWith("#/")) {
    const [route, query = ""] = url.hash.slice(1).split("?");
    const search = new URLSearchParams(query);
    for (const [key, value] of params) search.set(key, value);
    url.hash = `${route}?${search}`;
  } else {
    for (const [key, value] of params) url.searchParams.set(key, value);
  }
  return url.toString();
};

export const parseCookies = (cookieHeader = "") =>
  cookieHeader.split(";").reduce((cookies, pair) => {
    const [name, ...rest] = pair.split("=");
    if (!name) return cookies;
    try {
      cookies[name.trim()] = decodeURIComponent((rest || []).join("=").trim());
    } catch {
      /* Ignore malformed cookies rather than failing authentication. */
    }
    return cookies;
  }, {});

export const getRefreshTokenFromRequest = (req) => {
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[AUTH_SESSION_COOKIE_NAME];
};

export const sessionCookieOptions = () => {
  const secure = process.env.NODE_ENV === "production";
  const allowCrossSite =
    !!process.env.AUTH_COOKIE_DOMAIN ||
    process.env.ALLOW_CROSS_SITE_SSO === "true";
  const cookieOptions = {
    httpOnly: true,
    sameSite: allowCrossSite ? "none" : "lax",
    secure: secure || allowCrossSite,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
  if (process.env.AUTH_COOKIE_DOMAIN)
    cookieOptions.domain = process.env.AUTH_COOKIE_DOMAIN;
  return cookieOptions;
};

export const setSessionCookie = (res, refreshToken) => {
  res.cookie(AUTH_SESSION_COOKIE_NAME, refreshToken, sessionCookieOptions());
};

export const getAuthenticatedUser = async (req) => {
  const refreshToken = getRefreshTokenFromRequest(req);
  if (refreshToken) {
    const session = await db.Session.findOne({ where: { refreshToken } });
    if (
      session &&
      (!session.expiresAt || new Date(session.expiresAt) > new Date())
    ) {
      return await db.User.findByPk(session.userId);
    }
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const session = await db.Session.findOne({
        where: { token, userId: decoded.userId },
      });
      if (
        !session ||
        (session.expiresAt && new Date(session.expiresAt) <= new Date())
      ) {
        return null;
      }
      return await db.User.findByPk(session.userId);
    } catch (err) {}
  }

  return null;
};

export const sendError = (
  res,
  errorCode,
  message,
  status = 400,
  details = null,
) => {
  const payload = { errorCode, message };
  if (details) payload.details = details;
  return res.status(status).json(payload);
};

export { auditLog };
