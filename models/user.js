import { Model } from "sequelize";

export default (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {}
  }

  User.init(
    {
      email: DataTypes.STRING,
      password: DataTypes.STRING,
      failedLoginAttempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      lockedUntil: DataTypes.DATE,
      roleId: DataTypes.INTEGER,
      xp: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      points: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      sequelize,
      modelName: "User",
    },
  );

  return User;
};
