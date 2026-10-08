import { z } from "zod";
import * as authService from "../auth.service.js";
import db from "../../../database/index.js";
import {
  auditLog,
  FRONTEND_LOGIN_URL,
  getAuthenticatedUser,
  authorizationRedirect,
} from "./helpers.js";

export const authorize = async (req, res) => {
  try {
    const schema = z.object({
      client_id: z.string(),
      redirect_uri: z.string().url(),
      state: z.string().optional(),
      code_challenge: z.string().optional(),
      code_challenge_method: z.string().optional(),
    });
    const {
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
    } = schema.parse(req.query);

    await auditLog("APP_AUTH_REQUEST", { userId: null, ipAddress: req.ip });

    const application = await db.Application.findOne({
      where: { clientId: client_id },
    });
    if (!application)
      return res.status(400).json({ error: "Invalid client_id" });
    if (application.redirectUri !== redirect_uri)
      return res.status(400).json({ error: "Invalid redirect_uri" });
    if (
      !application.clientSecret &&
      (!code_challenge || code_challenge_method !== "S256")
    ) {
      return res
        .status(400)
        .json({ error: "Public clients require S256 PKCE" });
    }

    const user = await getAuthenticatedUser(req);
    const userId = user?.id || user?.userId || null;
    if (userId) {
      const authCode = await authService.createAuthorizationCode({
        userId,
        clientId: client_id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge || null,
        codeChallengeMethod: code_challenge_method || null,
      });
      const code = authCode.code || authCode;

      try {
        await auditLog("APP_AUTH_GRANTED", { userId, ipAddress: req.ip });
      } catch (e) {}

      const params = new URLSearchParams({ code });
      if (state) params.set("state", state);
      return res.redirect(authorizationRedirect(redirect_uri, params));
    }

    const loginUrl = `${FRONTEND_LOGIN_URL}?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirect_uri)}${state ? `&state=${encodeURIComponent(state)}` : ""}${code_challenge ? `&code_challenge=${encodeURIComponent(code_challenge)}` : ""}${code_challenge_method ? `&code_challenge_method=${encodeURIComponent(code_challenge_method)}` : ""}`;
    return res.redirect(loginUrl);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid authorization request" });
    }
    console.error("AUTHORIZE ERROR:", err && err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
