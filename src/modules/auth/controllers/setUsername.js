import { z } from "zod";
import db from "../../../database/index.js";
import { sendError } from "./helpers.js";

export const setUsername = async (req, res) => {
  try {
    const { username } = z
      .object({
        username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, {
          message: "Username can only use letters, numbers, and underscores",
        }),
      })
      .parse(req.body);
    const normalizedUsername = username.toLowerCase();
    const existing = await db.User.findOne({
      where: { username: normalizedUsername },
    });
    if (existing && existing.id !== req.user.userId) {
      return sendError(res, "USERNAME_TAKEN", "Username already in use", 409);
    }
    const user = await db.User.findByPk(req.user.userId);
    await user.update({ username: normalizedUsername });
    return res.json({ user: { ...req.user, username: user.username } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.errors.map((item) => ({
        field: item.path.join("."),
        message: item.message,
      }));
      return sendError(res, "VALIDATION_ERROR", "Invalid input", 400, details);
    }
    return sendError(res, "SERVER_ERROR", "Unable to save username", 500);
  }
};
