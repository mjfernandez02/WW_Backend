"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("UserRewards", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      userId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      rewardId: { allowNull: false, type: Sequelize.STRING(64) },
      unlockedAt: { allowNull: false, type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex("UserRewards", ["userId", "rewardId"], {
      unique: true,
      name: "user_rewards_user_reward_unique",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("UserRewards");
  },
};
