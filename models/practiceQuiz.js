import { Model } from "sequelize";

export default (sequelize, DataTypes) => {
  class PracticeQuiz extends Model {
    static associate(models) {
      PracticeQuiz.belongsTo(models.User, { foreignKey: "userId" });
    }
  }

  PracticeQuiz.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      answerKey: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "PracticeQuiz",
    },
  );

  return PracticeQuiz;
};
