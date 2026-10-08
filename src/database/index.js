import "dotenv/config"; // same as require('dotenv').config()
import { Sequelize, DataTypes } from "sequelize";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

// Recreate __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Sequelize
const databaseUrl =
  process.env.NODE_ENV === "test"
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;
if (!databaseUrl) {
  if (process.env.NODE_ENV === "test") {
    throw new Error(
      "TEST_DATABASE_URL is required for database integration tests",
    );
  }
  throw new Error("DATABASE_URL is required");
}

const sequelize = new Sequelize(databaseUrl, {
  dialect: "postgres",
  protocol: "postgres",
  logging: false,
  dialectOptions: {
    ssl:
      process.env.DB_SSL === "false"
        ? false
        : {
            rejectUnauthorized: false,
          },
  },
});

const db = {};

// 📂 Path to Sequelize CLI models folder
const modelsPath = path.join(__dirname, "../../models");

// 🔄 Load all models dynamically
const modelFiles = fs
  .readdirSync(modelsPath)
  .filter(
    (file) =>
      file !== "index.js" && (file.endsWith(".js") || file.endsWith(".cjs")),
  );

for (const file of modelFiles) {
  const modulePath = path.join(modelsPath, file);
  const moduleURL = pathToFileURL(modulePath).href;

  // Dynamic import instead of require
  const { default: modelFactory } = await import(moduleURL);
  const model = modelFactory(sequelize, DataTypes);

  db[model.name] = model;
}

// 🔗 Run associations
Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// Export
db.sequelize = sequelize;
db.Sequelize = Sequelize;

export default db;
