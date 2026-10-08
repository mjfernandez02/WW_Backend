import { z } from "zod";
import * as authService from "../auth.service.js";
import db from "../../../database/index.js";
import { auditLog, sendError } from "./helpers.js";

export const register = async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      // Stronger password policy: min 12 chars, mixed types
      password: z
        .string()
        .min(12)
        .regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*\W)/, {
          message:
            "Password must include upper, lower, number and special char",
        }),
    });

    const parsed = schema.parse(req.body);
    const normalizedEmail = parsed.email.trim().toLowerCase();

    const user = await authService.registerUser({
      email: normalizedEmail,
      password: parsed.password,
    });

    try {
      await auditLog("REGISTER_SUCCESS", {
        userId: user.id,
        ipAddress: req.ip,
      });
    } catch (e) {}

    res.status(201).json({
      message: "User registered",
      data: {
        id: user.id,
        email: user.email,
        roleId: user.roleId,
        xp: user.xp,
        points: user.points,
      },
    });
  } catch (err) {
    console.log("REGISTER ERROR:", err.message);
    try {
      const found = await db.User.findOne({
        where: { email: req.body?.email },
      });
      await auditLog("REGISTER_FAILURE", {
        userId: found ? found.id : null,
        ipAddress: req.ip,
      });
    } catch (e) {}
    // Structured errors for frontend
    if (err instanceof z.ZodError) {
      const details = err.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      }));
      return sendError(res, "VALIDATION_ERROR", "Invalid input", 400, details);
    }

    // Unique/email taken
    if (
      err.name === "SequelizeUniqueConstraintError" ||
      (err.message && err.message.includes("Email already exists"))
    ) {
      return sendError(res, "EMAIL_TAKEN", "Email already in use", 409);
    }

    return sendError(res, "SERVER_ERROR", "Something went wrong", 500);
  }
};
