import express from "express";
const { Request, Response } = express;
import { generateResetToken } from "../auth.service.js";
import { sendEmail } from "../../../utils/email.js";
import db from "../../../database/index.js";
const { User } = db;

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ where: { email: normalizedEmail } });

    if (user) {
      const token = await generateResetToken(user.id);
      const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
      const resetLink = `${frontendUrl}/#/reset-password/${token}`;

      await sendEmail({
        to: user.email,
        subject: "Password Reset Request",
        text: `Reset your password by clicking here: ${resetLink}`,
        html: `<p>You requested a password reset. Please click the link below to set a new password:</p><a href="${resetLink}">${resetLink}</a>`,
      });
    }

    // Always return a generic success message to prevent user enumeration
    res.json({ message: "If an account exists, a reset link has been sent to the email provided." });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
