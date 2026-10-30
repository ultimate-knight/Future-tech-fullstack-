const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * One row per quiz *attempt*. We keep every attempt (not just the best)
 * so a student's history/attempt count is real, and the "best attempt"
 * used for progress tracking is computed at read-time in the route.
 */
const QuizResult = sequelize.define(
  "QuizResult",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    studentId: { type: DataTypes.UUID, allowNull: false },
    // "level1".."level4"
    level: { type: DataTypes.STRING, allowNull: false },
    // "module1", "module2", ...
    module: { type: DataTypes.STRING, allowNull: false },
    // Distinguishes multiple quizzes within the same module, e.g.
    // "module1-quiz" vs "module1-practical".
    quizId: { type: DataTypes.STRING, allowNull: false, defaultValue: "module-quiz" },
    score: { type: DataTypes.INTEGER, allowNull: false }, // percent, 0-100
    correctCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    totalQuestions: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    passed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    attemptNumber: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  },
  {
    tableName: "quiz_results",
    timestamps: true,
  }
);

module.exports = QuizResult;
