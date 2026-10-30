const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One row per (level, module) - the "Live Class" meeting link shown as a
 * button at the top of that module's page. Kept separate from
 * ClassContent since it's one link for the whole module, not per-class.
 */
const LiveClass = sequelize.define(
  "LiveClass",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    level: { type: DataTypes.STRING(20), allowNull: false },
    module: { type: DataTypes.STRING(20), allowNull: false },
    meetingUrl: { type: DataTypes.STRING, allowNull: true },
    // Optional short note shown next to the button, e.g. "Every Mon/Wed, 5pm".
    note: { type: DataTypes.STRING, allowNull: true },
  },
  {
    tableName: "live_classes",
    timestamps: true,
    indexes: [{ unique: true, fields: ["level", "module"] }],
  }
);

module.exports = LiveClass;
