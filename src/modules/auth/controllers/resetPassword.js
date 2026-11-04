import express from "express";
const { Request, Response } = express;
import { verifyResetToken, resetUserPassword } from "../auth.service.js";

export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required" });
    }

    const userId = await verifyResetToken(token);
    if (!userId) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    await resetUserPassword(userId, newPassword);
    res.json({ message: "Password has been successfully reset." });
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
