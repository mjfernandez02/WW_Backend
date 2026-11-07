import { Model } from "sequelize";

export default (sequelize, DataTypes) => {
  class UserReward extends Model {
    static associate(models) {
      UserReward.belongsTo(models.User, { foreignKey: "userId" });
    }
  }

  UserReward.init(
    {
      userId: { type: DataTypes.INTEGER, allowNull: false },
      rewardId: { type: DataTypes.STRING(64), allowNull: false },
      unlockedAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      modelName: "UserReward",
      tableName: "UserRewards",
      indexes: [{ unique: true, fields: ["userId", "rewardId"] }],
    },
  );

  return UserReward;
};
