import { z } from "zod";
import * as authService from "../auth.service.js";
import db from "../../../database/index.js";
import {
  auditLog,
  setSessionCookie,
  authorizationRedirect,
  sendError,
} from "./helpers.js";

export const login = async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1).max(1024),
      client_id: z.string().optional(),
      redirect_uri: z.string().url().optional(),
      state: z.string().optional(),
      code_challenge: z.string().optional(),
      code_challenge_method: z.string().optional(),
    });

    const parsed = schema.parse({ ...req.query, ...req.body });

    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers["user-agent"] || null;

    const normalizedEmail = parsed.email.trim().toLowerCase();

    const {
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
    } = parsed;
    if (Boolean(client_id) !== Boolean(redirect_uri)) {
      return res
        .status(400)
        .json({
          error: "client_id and redirect_uri must be provided together",
        });
    }
    if (client_id) {
      const application = await db.Application.findOne({
        where: { clientId: client_id },
      });
      if (!application)
        return res.status(400).json({ error: "Invalid client_id" });
      if (application.redirectUri !== redirect_uri) {
        return res.status(400).json({ error: "Invalid redirect_uri" });
      }
      if (
        !application.clientSecret &&
        (!code_challenge || code_challenge_method !== "S256")
      ) {
        return res
          .status(400)
          .json({ error: "Public clients require S256 PKCE" });
      }
    }

    const result = await authService.loginUser(
      { email: normalizedEmail, password: parsed.password },
      {
        ipAddress,
        userAgent,
      },
    );

    const { accessToken, refreshToken, userId } = result;

    if (client_id && redirect_uri) {
      const authCode = await authService.createAuthorizationCode({
        userId,
        clientId: client_id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
      });
      const code = authCode.code || authCode;

      const params = new URLSearchParams({ code });
      if (state) params.set("state", state);
      setSessionCookie(res, refreshToken);
      const redirectUrl = authorizationRedirect(redirect_uri, params);
      if (req.get("Accept")?.includes("application/json")) {
        return res.json({ redirectUrl });
      }
      return res.redirect(redirectUrl);
    }

    setSessionCookie(res, refreshToken);
    res.json({ message: "Login successful", accessToken, refreshToken });
  } catch (err) {
    console.error("LOGIN ERROR:", err.name);
    try {
      const found = await db.User.findOne({ where: { email: req.body.email } });
      await auditLog("LOGIN_FAILURE", {
        userId: found ? found.id : null,
        ipAddress: req.ip,
      });
    } catch (e) {
      console.error("AuditLog error (login failure):", e && e.message);
    }
    // Structured errors for frontend
    if (err instanceof z.ZodError) {
      const details = err.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      }));
      return sendError(res, "VALIDATION_ERROR", "Invalid input", 400, details);
    }

    if (err.message && err.message.toLowerCase().includes("locked")) {
      return sendError(
        res,
        "ACCOUNT_LOCKED",
        "Account locked. Try again later or reset your password.",
        403,
      );
    }

    if (
      err.message &&
      err.message.toLowerCase().includes("invalid credentials")
    ) {
      return sendError(res, "INVALID_CREDENTIALS", "Invalid credentials", 401);
    }

    return sendError(res, "SERVER_ERROR", "Something went wrong", 500);
  }
};
