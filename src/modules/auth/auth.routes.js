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
import validateClient from "../../middleware/ClientMiddleware.js";
import { authenticate } from "./auth.middleware.js";
import roleMiddleware from "../../middleware/RoleMiddleware.js";

const router = express.Router();

// Per-endpoint rate limiters for auth endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 login attempts per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // limit each IP to 5 registrations per hour
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
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

// Example admin-only route (roleId 1 = ADMIN per seeders)
router.get("/admin", authenticate, roleMiddleware(1), (req, res) => {
  res.json({ message: "admin access granted" });
});

export default router;
