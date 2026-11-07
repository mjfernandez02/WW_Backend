"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Users", "username", {
      type: Sequelize.STRING(24),
      allowNull: true,
    });
    await queryInterface.addIndex("Users", ["username"], {
      unique: true,
      name: "unique_users_username",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex("Users", "unique_users_username");
    await queryInterface.removeColumn("Users", "username");
  },
};
