/**
 * MySQL only. Finds - and optionally drops - DUPLICATE unique indexes.
 *
 * Why this exists: sequelize.sync({ alter: true }) on MySQL adds one more copy
 * of every `unique: true` column's index each time it runs
 * (email, email_2, email_3 ...). They pile up with every app start until MySQL
 * refuses with "Too many keys specified; max 64 keys allowed" and the app can
 * no longer start.
 *
 * Only an index that is provably redundant is touched: unique, named
 * "<base>_<number>", where an index named exactly "<base>" already exists on the
 * same table, is unique, and covers exactly the same columns. The original
 * index stays, so uniqueness is still enforced. Nothing else is ever dropped.
 *
 * @returns {Promise<Array<{table:string,index:string,keeps:string,dropped:boolean,error?:string}>>}
 */
async function cleanDuplicateIndexes(sequelize, { apply = false } = {}) {
  if (sequelize.getDialect() !== "mysql") return [];

  const [rows] = await sequelize.query(
    "SELECT TABLE_NAME AS tbl, INDEX_NAME AS idx, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seq, COLUMN_NAME AS col " +
      "FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX"
  );

  const tables = {};
  rows.forEach((r) => {
    const t = (tables[r.tbl] = tables[r.tbl] || {});
    const i = (t[r.idx] = t[r.idx] || { unique: Number(r.nonUnique) === 0, cols: [] });
    i.cols.push(r.col);
  });

  const found = [];
  Object.keys(tables).forEach((tbl) => {
    const idxs = tables[tbl];
    Object.keys(idxs).forEach((name) => {
      const m = /^(.+)_(\d+)$/.exec(name);
      if (!m || name === "PRIMARY") return;
      const base = idxs[m[1]];
      const me = idxs[name];
      if (base && base.unique && me.unique && base.cols.join(",") === me.cols.join(",")) {
        found.push({ table: tbl, index: name, keeps: m[1], dropped: false });
      }
    });
  });

  if (apply) {
    for (const f of found) {
      try {
        await sequelize.query("ALTER TABLE `" + f.table + "` DROP INDEX `" + f.index + "`");
        f.dropped = true;
      } catch (err) {
        f.error = (err.parent && err.parent.sqlMessage) || err.message;
      }
    }
  }
  return found;
}

module.exports = { cleanDuplicateIndexes };
