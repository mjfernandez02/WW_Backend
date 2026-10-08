import { z } from "zod";
import bcrypt from "bcrypt";
import db from "../../../database/index.js";
import * as authService from "../auth.service.js";
import { setSessionCookie } from "./helpers.js";

export const token = async (req, res) => {
  try {
    const schema = z.object({
      grant_type: z.literal("authorization_code"),
      code: z.string(),
      client_id: z.string(),
      redirect_uri: z.string().url(),
      client_secret: z.string().optional(),
      code_verifier: z.string().optional(),
    });
    const { code, client_id, redirect_uri, client_secret, code_verifier } =
      schema.parse(req.body);

    const application = await db.Application.findOne({
      where: { clientId: client_id },
    });
    if (!application)
      return res.status(400).json({ error: "Invalid client_id" });
    if (application.redirectUri !== redirect_uri)
      return res.status(400).json({ error: "Invalid redirect_uri" });

    if (application.clientSecret) {
      const storedSecret = application.clientSecret;
      const isHashed = storedSecret.startsWith("$2");
      const validSecret = isHashed
        ? await bcrypt.compare(client_secret || "", storedSecret)
        : storedSecret === client_secret;
      if (!validSecret)
        return res.status(401).json({ error: "Invalid client_secret" });
    }

    const authCode = await authService.consumeAuthorizationCode({
      code,
      clientId: client_id,
      redirectUri: redirect_uri,
      codeVerifier: code_verifier || null,
      requirePkce: !application.clientSecret,
    });
    if (!authCode)
      return res
        .status(400)
        .json({ error: "Invalid or expired authorization code" });

    const user = await db.User.findByPk(authCode.userId);
    if (!user)
      return res.status(400).json({ error: "Invalid authorization code user" });

    const session = await authService.createSession({
      user,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
    });

    setSessionCookie(res, session.refreshToken);
    return res.json({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      token_type: "Bearer",
      expires_in: 15 * 60,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid token request" });
    }
    console.error("TOKEN ERROR:", err && err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
