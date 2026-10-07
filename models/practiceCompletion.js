import { Model } from "sequelize";

export default (sequelize, DataTypes) => {
  class PracticeCompletion extends Model {
    static associate(models) {
      PracticeCompletion.belongsTo(models.User, { foreignKey: "userId" });
    }
  }

  PracticeCompletion.init(
    {
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      practiceId: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      correctAnswers: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      totalQuestions: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      xpAwarded: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      pointsAwarded: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "PracticeCompletion",
      indexes: [
        {
          unique: true,
          fields: ["userId", "practiceId"],
        },
      ],
    },
  );

  return PracticeCompletion;
};
