require("dotenv").config();

const config = {
  use_env_variable: "DATABASE_URL",
  dialect: "postgres",
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
};

module.exports = {
  development: config,
  production: config,
  test: {
    ...config,
    use_env_variable: "TEST_DATABASE_URL",
    dialectOptions: {
      ssl: process.env.DB_SSL === "false" ? false : config.dialectOptions.ssl,
    },
  },
};
