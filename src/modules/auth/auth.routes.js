import express from "express";
import rateLimit from "express-rate-limit";
import {
  register,
  login,
  authorize,
  token,
  refresh,
  logout,
  clientToken,
  session,
} from "./auth.controller.js";
import { forgotPassword } from "./controllers/forgotPassword.js";
import { resetPassword } from "./controllers/resetPassword.js";
import validateClient from "../../middleware/ClientMiddleware.js";
import { authenticate } from "./auth.middleware.js";
import { setUsername } from "./controllers/setUsername.js";
import roleMiddleware from "../../middleware/RoleMiddleware.js";

const router = express.Router();

// Per-endpoint rate limiters for auth endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 login attempts per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 50, // limit each IP to 50 registrations per hour
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // limit each IP to 5 reset attempts per hour
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/forgot-password", passwordResetLimiter, forgotPassword);
router.post("/reset-password", passwordResetLimiter, resetPassword);
router.get("/authorize", authorize);
router.post("/token", token);
router.get("/session", session);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.post("/client-token", validateClient, clientToken);

// Returns the current user after validating both the JWT and its active session.
router.get("/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});
router.put("/username", authenticate, setUsername);

// Example admin-only route (roleId 1 = ADMIN per seeders)
router.get("/admin", authenticate, roleMiddleware(1), (req, res) => {
  res.json({ message: "admin access granted" });
});

export default router;
