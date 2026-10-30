/**
 * Loads the official syllabus (levels.xlsx -> syllabusData.json) into
 * ClassContent: exactly 20 classes for every level/module that appears in
 * the spreadsheet (19 modules; Level 1 Module 1 is not in the sheet and is
 * left untouched, as its 20 classes + PDFs already exist).
 *
 * For each class number 1..20:
 *   - class already exists -> only its TITLE is updated. PDF / video
 *     attachments are never touched.
 *   - class missing        -> it is created (no PDF/video yet).
 * Classes numbered above 20 are never deleted (just reported).
 *
 * Safe to run any number of times. Use --dry-run to preview.
 *
 * Usage:  npm run class-content:sync-syllabus
 *         npm run class-content:sync-syllabus -- --dry-run
 */
require("dotenv").config();
const { ClassContent } = require("../models");
const sequelize = require("../config/database");
const SYLLABUS = require("./syllabusData.json");

const DRY_RUN = process.argv.includes("--dry-run");

async function run() {
  if (DRY_RUN) console.log("DRY RUN - nothing will be written.\n");
  let created = 0, renamed = 0, unchanged = 0;

  for (const level of Object.keys(SYLLABUS)) {
    for (const module of Object.keys(SYLLABUS[level])) {
      const titles = SYLLABUS[level][module];
      const rows = await ClassContent.findAll({ where: { level, module } });
      const byNumber = new Map(rows.map((r) => [r.classNumber, r]));
      let c = 0, r = 0;

      for (let i = 0; i < titles.length; i++) {
        const n = i + 1;
        const title = String(titles[i]).trim().slice(0, 255);
        const row = byNumber.get(n);
        if (!row) {
          if (!DRY_RUN) await ClassContent.create({ level, module, classNumber: n, title });
          c++;
        } else if (row.title !== title) {
          if (!DRY_RUN) await row.update({ title });
          r++;
        } else {
          unchanged++;
        }
      }
      const extra = rows.filter((x) => x.classNumber > titles.length).length;
      console.log(
        `${level}/${module}: ${titles.length} in syllabus -> ${c} created, ${r} renamed` +
          (extra ? `, ${extra} extra class(es) above ${titles.length} left alone` : "")
      );
      created += c; renamed += r;
    }
  }
  console.log(`\nDone. ${created} created, ${renamed} renamed, ${unchanged} already correct.`);
}

run()
  .catch((err) => { console.error("Sync failed:", err.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
