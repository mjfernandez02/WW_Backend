"use strict";
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Users", "xp", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn("Users", "points", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.createTable("PracticeCompletions", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      userId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: {
          model: "Users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      practiceId: {
        allowNull: false,
        type: Sequelize.STRING(128),
      },
      xpAwarded: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      pointsAwarded: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.addIndex("PracticeCompletions", ["userId", "practiceId"], {
      unique: true,
      name: "practice_completions_user_practice_unique",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("PracticeCompletions");
    await queryInterface.removeColumn("Users", "points");
    await queryInterface.removeColumn("Users", "xp");
  },
};
