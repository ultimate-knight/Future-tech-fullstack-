/**
 * One-time migration: populates the new ClassContent table (admin-managed
 * class list) from what used to be hardcoded `CLASSES` arrays inside each
 * level's module1.html. Points each row at the SAME pdf filename that was
 * already there (cl1.pdf, cl2.pdf, ...) under content/pdfs/<level>/module1/,
 * so nothing needs to be re-uploaded - existing PDFs keep working exactly
 * as before. From here on, add/edit/remove classes and upload videos
 * through the Admin dashboard's "Class Content" tab instead of editing
 * HTML.
 *
 * Safe to run more than once - skips a level/module that already has any
 * ClassContent rows, so it won't create duplicates or clobber content an
 * admin has since edited through the dashboard.
 *
 * Usage:  node src/scripts/seedClassContent.js
 */
require("dotenv").config();
const { ClassContent } = require("../models");
const sequelize = require("../config/database");

const DATA = {
  level1: {
    module1: [
      "Introduction to Computers",
      "History of Computer & Generations of Computers",
      "Types of Computers",
      "Parts of Computer",
      "Input and Output Devices",
      "Storage Devices",
      "Computer Software-System Software-Application Software",
      "Operating Systems-Windows,Android & Linux",
      "Starting & Shutting Down a Computer,Desktopicons & Taskbar",
      "Mouse Practice-Click,Double Click,Drag & Drop",
      "Mouse Practice-Click,Double Click,Drag & Drop",
      "Mouse Practice-Click,Double Click,Drag & Drop",
      "Mouse Practice-Click,Double Click,Drag & Drop",
      "Mouse Practice-Click,Double Click,Drag & Drop",
      "Mouse Practice-Click,Double Click,Drag & Drop",
      "Mouse Practice-Click,Double Click,Drag & Drop",
      "Mouse Practice-Click,Double Click,Drag & Drop",
      "Mouse Practice-Click,Double Click,Drag & Drop",
      "Mouse Practice-Click,Double Click,Drag & Drop",
      "Mouse Practice-Click,Double Click,Drag & Drop",
    ],
  },
  level2: {
    module1: [
      "Course Introduction",
      "Computer Basics",
      "Hardware & Software",
      "Input & Output Devices",
      "Operating System Basics",
      "Files & Folders",
      "Internet Basics",
      "Google Search Skills",
      "Digital Citizenship",
      "Module Activity & Quiz",
    ],
  },
  level3: {
    module1: [
      "Introduction to Future Engineers & Technology",
      "Introduction to Programming & Python",
      "Installing Python & Setting Up VS Code",
      "First Python Program",
      "Python Syntax, Keywords & Comments",
      "Variables & Constants",
      "Data Types",
      "Input & Output",
      "Operators in Python",
      "Python Basics Activity & Quiz",
    ],
  },
  level4: {
    module1: [
      "Advanced Python Introduction",
      "Python Programming Best Practices",
      "Advanced Variables & Data Types",
      "Strings & Advanced String Operations",
      "Lists & Advanced List Operations",
      "Tuples & Sets",
      "Dictionaries",
      "List, Set & Dictionary Comprehension",
      "Functions – Advanced Concepts",
      "*args and **kwargs",
      "Lambda Functions",
      "map(), filter() & reduce()",
      "Modules & Packages",
      "File Handling",
      "CSV File Handling",
      "JSON Data Handling",
      "Exception Handling",
      "Debugging Python Programs",
      "Object-Oriented Programming",
      "Constructors & Methods",
      "Inheritance & Polymorphism",
      "Encapsulation & Abstraction",
      "Python Libraries",
      "Python Mini Project",
      "Module Assessment",
    ],
  },
};

async function run() {
  for (const level of Object.keys(DATA)) {
    for (const moduleParam of Object.keys(DATA[level])) {
      const titles = DATA[level][moduleParam];

      const existingCount = await ClassContent.count({ where: { level, module: moduleParam } });
      if (existingCount > 0) {
        console.log(`${level}/${moduleParam}: already has ${existingCount} class(es) - skipping.`);
        continue;
      }

      console.log(`${level}/${moduleParam}: creating ${titles.length} class(es)...`);
      for (let i = 0; i < titles.length; i++) {
        const classNumber = i + 1;
        await ClassContent.create({
          level,
          module: moduleParam,
          classNumber,
          title: titles[i],
          pdfFilename: `cl${classNumber}.pdf`, // matches the files already on disk
        });
      }
    }
  }
  console.log("Done.");
}

run()
  .catch((err) => {
    console.error("Seeding failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
