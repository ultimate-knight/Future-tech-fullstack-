/**
 * Repairs any gap between what's actually on disk under content/pdfs and
 * what's in the ClassContent table. This came up because the original
 * seedClassContent.js was built from a class list that didn't match what
 * was actually live for every level (Level 2 had 20 PDFs on disk but
 * only 10 were seeded) - this script finds any clN.pdf file that has NO
 * matching ClassContent row and creates one for it, so the file becomes
 * visible to students again. It never touches or duplicates a class that
 * already has a row - it only fills in gaps.
 *
 * New rows get a placeholder title like "Class 11" - rename them to the
 * real title from the Admin dashboard's Class Content tab (one click,
 * inline edit) once this has run.
 *
 * Safe to run more than once.
 *
 * Usage:  node src/scripts/syncClassContentFromDisk.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ClassContent } = require("../models");
const sequelize = require("../config/database");

const PDF_ROOT = path.join(__dirname, "..", "..", "content", "pdfs");
const LEVELS = ["level1", "level2", "level3", "level4"];

async function run() {
  for (const level of LEVELS) {
    const levelDir = path.join(PDF_ROOT, level);
    if (!fs.existsSync(levelDir)) continue;

    const modules = fs.readdirSync(levelDir).filter((name) =>
      fs.statSync(path.join(levelDir, name)).isDirectory()
    );

    for (const moduleParam of modules) {
      const moduleDir = path.join(levelDir, moduleParam);
      const files = fs.readdirSync(moduleDir).filter((f) => /^cl(\d+)\.pdf$/i.test(f));

      const existing = await ClassContent.findAll({ where: { level, module: moduleParam } });
      const existingByFile = new Set(existing.map((r) => r.pdfFilename));
      const existingNumbers = new Set(existing.map((r) => r.classNumber));

      let created = 0;
      for (const file of files) {
        if (existingByFile.has(file)) continue; // already has a row - leave it alone

        const match = /^cl(\d+)\.pdf$/i.exec(file);
        const classNumber = parseInt(match[1], 10);

        // Extremely unlikely, but don't collide class numbers if one's
        // already taken by a differently-named file.
        let finalNumber = classNumber;
        while (existingNumbers.has(finalNumber)) finalNumber++;
        existingNumbers.add(finalNumber);

        await ClassContent.create({
          level,
          module: moduleParam,
          classNumber: finalNumber,
          title: `Class ${classNumber}`,
          pdfFilename: file,
        });
        created++;
      }

      if (created > 0) {
        console.log(`${level}/${moduleParam}: added ${created} missing class(es) - rename their titles in the admin dashboard.`);
      } else {
        console.log(`${level}/${moduleParam}: nothing missing (${files.length} PDF(s) on disk, all already tracked).`);
      }
    }
  }
  console.log("Done.");
}

run()
  .catch((err) => {
    console.error("Sync failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
