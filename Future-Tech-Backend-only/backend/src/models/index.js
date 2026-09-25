const sequelize = require("../config/database");

const School = require("./School");
const Admin = require("./Admin");
const ContactMessage = require("./ContactMessage");
const IndividualAdmission = require("./IndividualAdmission");
const BulkAdmission = require("./BulkAdmission");
const Payment = require("./Payment");
const Student = require("./Student");
const QuizResult = require("./QuizResult");
const SchoolInvoice = require("./SchoolInvoice");

// ---- Associations ----
School.hasMany(BulkAdmission, { foreignKey: "schoolId" });
BulkAdmission.belongsTo(School, { foreignKey: "schoolId" });

School.hasMany(IndividualAdmission, { foreignKey: "schoolId", constraints: false });
IndividualAdmission.belongsTo(School, { foreignKey: "schoolId", constraints: false });

IndividualAdmission.belongsTo(Payment, { foreignKey: "paymentId", constraints: false });
BulkAdmission.belongsTo(Payment, { foreignKey: "paymentId", constraints: false });

IndividualAdmission.hasOne(Student, { foreignKey: "admissionId", constraints: false });
Student.belongsTo(IndividualAdmission, { foreignKey: "admissionId", constraints: false });

Student.hasMany(QuizResult, { foreignKey: "studentId", constraints: false });
QuizResult.belongsTo(Student, { foreignKey: "studentId", constraints: false });

School.hasMany(SchoolInvoice, { foreignKey: "schoolId", constraints: false });
SchoolInvoice.belongsTo(School, { foreignKey: "schoolId", constraints: false });

module.exports = {
  sequelize,
  School,
  Admin,
  ContactMessage,
  IndividualAdmission,
  BulkAdmission,
  Payment,
  Student,
  QuizResult,
  SchoolInvoice,
};
