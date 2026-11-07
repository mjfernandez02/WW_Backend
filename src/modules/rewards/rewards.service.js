import db from "../../database/index.js";
import { REWARD_CATALOG } from "./rewards.catalog.js";

const achievementsFor = ({ user, completions, unlockedCount }) => {
  const quizzesCompleted = completions.length;
  const correctAnswers = completions.reduce(
    (total, completion) => total + completion.correctAnswers,
    0,
  );
  const perfectQuiz = completions.some(
    (completion) =>
      completion.totalQuestions > 0 &&
      completion.correctAnswers === completion.totalQuestions,
  );
  const perfectQuizzes = completions.filter(
    (completion) =>
      completion.totalQuestions > 0 &&
      completion.correctAnswers === completion.totalQuestions,
  ).length;

  return [
    { id: "first-quiz", name: "First Word", description: "Complete your first quiz.", icon: "✦", tier: "starter", unlocked: quizzesCompleted >= 1 },
    { id: "quiz-regular", name: "Quiz Regular", description: "Complete 10 quizzes.", icon: "🎯", tier: "bronze", unlocked: quizzesCompleted >= 10, progress: Math.min(quizzesCompleted, 10), target: 10 },
    { id: "perfect-score", name: "Perfect Score", description: "Get every answer right in a quiz.", icon: "🥉", tier: "bronze", unlocked: perfectQuiz },
    { id: "perfect-trio", name: "Perfect Trio", description: "Get a perfect score in 3 quizzes.", icon: "🥈", tier: "silver", unlocked: perfectQuizzes >= 3, progress: Math.min(perfectQuizzes, 3), target: 3 },
    { id: "wordsmith", name: "Wordsmith", description: "Answer 50 questions correctly.", icon: "✎", tier: "bronze", unlocked: correctAnswers >= 50, progress: Math.min(correctAnswers, 50), target: 50 },
    { id: "lexicon-keeper", name: "Lexicon Keeper", description: "Answer 250 questions correctly.", icon: "📖", tier: "gold", unlocked: correctAnswers >= 250, progress: Math.min(correctAnswers, 250), target: 250 },
    { id: "bronze-scholar", name: "Bronze Scholar", description: "Earn 500 XP.", icon: "🥉", tier: "bronze", unlocked: user.xp >= 500, progress: Math.min(user.xp, 500), target: 500 },
    { id: "silver-scholar", name: "Silver Scholar", description: "Earn 1,500 XP.", icon: "🥈", tier: "silver", unlocked: user.xp >= 1500, progress: Math.min(user.xp, 1500), target: 1500 },
    { id: "gold-scholar", name: "Gold Scholar", description: "Earn 3,000 XP.", icon: "🥇", tier: "gold", unlocked: user.xp >= 3000, progress: Math.min(user.xp, 3000), target: 3000 },
    { id: "platinum-scholar", name: "Platinum Scholar", description: "Earn 5,000 XP.", icon: "🏵️", tier: "platinum", unlocked: user.xp >= 5000, progress: Math.min(user.xp, 5000), target: 5000 },
    { id: "diamond-scholar", name: "Diamond Scholar", description: "Earn 7,500 XP.", icon: "💎", tier: "diamond", unlocked: user.xp >= 7500, progress: Math.min(user.xp, 7500), target: 7500 },
    { id: "master-scholar", name: "Master Scholar", description: "Earn 10,000 XP.", icon: "🏅", tier: "master", unlocked: user.xp >= 10000, progress: Math.min(user.xp, 10000), target: 10000 },
    { id: "grandmaster-scholar", name: "Grandmaster Scholar", description: "Earn 15,000 XP.", icon: "🎖️", tier: "master", unlocked: user.xp >= 15000, progress: Math.min(user.xp, 15000), target: 15000 },
    { id: "legend-scholar", name: "Legendary Scholar", description: "Earn 25,000 XP.", icon: "🏆", tier: "legend", unlocked: user.xp >= 25000, progress: Math.min(user.xp, 25000), target: 25000 },
    { id: "wordwell-legacy", name: "WordWell Legacy", description: "Earn 50,000 XP.", icon: "👑", tier: "legacy", unlocked: user.xp >= 50000, progress: Math.min(user.xp, 50000), target: 50000 },
    { id: "collector", name: "Collector", description: "Unlock 3 shelf items.", icon: "◈", tier: "bronze", unlocked: unlockedCount >= 3, progress: Math.min(unlockedCount, 3), target: 3 },
    { id: "curator", name: "Curator", description: "Unlock 8 shelf items.", icon: "🏛️", tier: "gold", unlocked: unlockedCount >= 8, progress: Math.min(unlockedCount, 8), target: 8 },
    { id: "archivist", name: "Archivist", description: "Unlock every shelf item.", icon: "🔐", tier: "legend", unlocked: unlockedCount >= REWARD_CATALOG.length, progress: Math.min(unlockedCount, REWARD_CATALOG.length), target: REWARD_CATALOG.length },
  ];
};

export const getRewardsDashboard = async (userId) => {
  const [user, unlockedRewards, completions] = await Promise.all([
    db.User.findByPk(userId, { attributes: ["id", "xp", "points"] }),
    db.UserReward.findAll({ where: { userId }, attributes: ["rewardId", "unlockedAt"] }),
    db.PracticeCompletion.findAll({
      where: { userId },
      attributes: ["correctAnswers", "totalQuestions"],
    }),
  ]);
  if (!user) return null;

  const unlockedById = new Map(
    unlockedRewards.map((reward) => [reward.rewardId, reward.unlockedAt]),
  );
  return {
    xp: user.xp,
    points: user.points,
    rewards: REWARD_CATALOG.map((reward) => ({
      ...reward,
      unlocked: unlockedById.has(reward.id),
      unlockedAt: unlockedById.get(reward.id) || null,
    })),
    achievements: achievementsFor({
      user,
      completions,
      unlockedCount: unlockedRewards.length,
    }),
  };
};

export const unlockReward = async ({ userId, rewardId }) => {
  const reward = REWARD_CATALOG.find((item) => item.id === rewardId);
  if (!reward) return { status: "reward_not_found" };

  return db.sequelize.transaction(async (transaction) => {
    const user = await db.User.findByPk(userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!user) return { status: "user_not_found" };

    const existing = await db.UserReward.findOne({
      where: { userId, rewardId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (existing) return { status: "already_unlocked" };
    if (user.points < reward.cost) return { status: "insufficient_points", cost: reward.cost };

    await db.UserReward.create(
      { userId, rewardId, unlockedAt: new Date() },
      { transaction },
    );
    await user.update({ points: user.points - reward.cost }, { transaction });
    return { status: "unlocked", rewardId, points: user.points };
  });
};
