const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One row per class within a level/module (what used to be a hardcoded
 * `CLASSES` array inside each level's module1.html). The admin dashboard
 * manages these now - adding/reordering/renaming classes and uploading
 * their PDF notes and recorded video, instead of a developer manually
 * editing HTML and FTP-ing files onto the server.
 */
const ClassContent = sequelize.define(
  "ClassContent",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // "level1".."level4"
    level: { type: DataTypes.STRING(20), allowNull: false },
    // "module1", "module2", ...
    module: { type: DataTypes.STRING(20), allowNull: false },
    // Display order within the level/module (1, 2, 3, ...). Also used as
    // the "Class N" number shown to students.
    classNumber: { type: DataTypes.INTEGER, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },

    // PDF notes - filename only, stored under
    // content/pdfs/<level>/<module>/<pdfFilename>
    pdfFilename: { type: DataTypes.STRING, allowNull: true },

    // Recorded video - EITHER an uploaded file (videoFilename, stored
    // under content/videos/<level>/<module>/<videoFilename> and streamed
    // through the auth-gated /api/content/video route) OR an external
    // link (videoUrl - YouTube/Drive/Vimeo etc, lighter on server
    // storage & bandwidth). An admin sets at most one of the two; a
    // filename takes priority if somehow both are set.
    videoFilename: { type: DataTypes.STRING, allowNull: true },
    videoUrl: { type: DataTypes.STRING, allowNull: true },
  },
  {
    tableName: "class_content",
    timestamps: true,
    indexes: [{ fields: ["level", "module", "classNumber"] }],
  }
);

module.exports = ClassContent;
