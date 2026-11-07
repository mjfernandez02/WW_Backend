import { getAuthenticatedUser } from "./helpers.js";

export const session = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.json({ authenticated: false });
    return res.json({
      authenticated: true,
      user: { id: user.id, email: user.email, username: user.username },
    });
  } catch (err) {
    console.error("SESSION ERROR:", err && err.message);
    return res.status(500).json({ error: "Server error" });
  }
};
