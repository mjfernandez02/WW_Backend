import { z } from "zod";
import * as rewardsService from "./rewards.service.js";

export const getRewards = async (req, res) => {
  try {
    const dashboard = await rewardsService.getRewardsDashboard(req.user.userId);
    if (!dashboard) return res.status(404).json({ error: "User not found" });
    return res.json(dashboard);
  } catch (error) {
    console.error("REWARDS GET ERROR:", error.message);
    return res.status(500).json({ error: "Unable to load rewards" });
  }
};

export const unlockReward = async (req, res) => {
  const parsed = z.object({ rewardId: z.string().min(1).max(64) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid reward" });
  try {
    const result = await rewardsService.unlockReward({
      userId: req.user.userId,
      rewardId: parsed.data.rewardId,
    });
    if (result.status === "reward_not_found") return res.status(404).json({ error: "Reward not found" });
    if (result.status === "user_not_found") return res.status(404).json({ error: "User not found" });
    if (result.status === "already_unlocked") return res.status(409).json({ error: "This item is already unlocked" });
    if (result.status === "insufficient_points") return res.status(409).json({ error: `You need ${result.cost} points to unlock this item.` });
    return res.status(201).json(result);
  } catch (error) {
    console.error("REWARD UNLOCK ERROR:", error.message);
    return res.status(500).json({ error: "Unable to unlock reward" });
  }
};
