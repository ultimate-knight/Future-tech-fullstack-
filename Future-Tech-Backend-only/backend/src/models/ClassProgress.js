const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One row per (student, level, module, file) the student has opened the
 * notes PDF for. This replaces an earlier browser-localStorage-only
 * version of "classes opened" tracking, which showed the SAME opened/not
 * opened state to every student who used the same browser/device (since
 * it was never tied to the actual logged-in student). This table is the
 * real, per-student, server-side source of truth instead.
 */
const ClassProgress = sequelize.define(
  "ClassProgress",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    studentId: { type: DataTypes.UUID, allowNull: false },
    // "level1".."level4"
    level: { type: DataTypes.STRING(20), allowNull: false },
    // "module1", "module2", ...
    module: { type: DataTypes.STRING(20), allowNull: false },
    // Either a PDF filename (e.g. "cl1.pdf") or a class's id (UUID) -
    // explicitly bounded (not the STRING default of 255) because this
    // column is part of a 4-column unique index below: at the default
    // length, level+module+file+studentId together exceed MySQL's
    // 3072-byte max key length under utf8mb4 and the index fails to
    // create. 150 chars is far more than either a filename or a UUID
    // ever needs, while keeping the index comfortably under that limit.
    file: { type: DataTypes.STRING(150), allowNull: false },
  },
  {
    tableName: "class_progress",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["studentId", "level", "module", "file"],
      },
    ],
  }
);

module.exports = ClassProgress;
