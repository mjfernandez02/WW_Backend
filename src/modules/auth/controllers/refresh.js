import { z } from "zod";
import * as authService from "../auth.service.js";
import { setSessionCookie } from "./helpers.js";

export const refresh = async (req, res) => {
  try {
    const schema = z.object({ refreshToken: z.string() });
    const { refreshToken } = schema.parse(req.body);

    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers["user-agent"] || null;

    const result = await authService.refreshAccessToken(refreshToken, {
      ipAddress,
      userAgent,
    });

    if (!result)
      return res.status(401).json({ error: "Invalid refresh token" });

    setSessionCookie(res, result.refreshToken);
    return res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid refresh request" });
    }
    console.error("REFRESH ERROR:", err && err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
