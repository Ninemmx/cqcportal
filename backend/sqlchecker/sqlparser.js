import pkg from "node-sql-parser";
const { Parser } = pkg;
const parser = new Parser();

function stripQuote(s) { return typeof s === "string" ? s.replace(/[`"'[\]]/g, "") : s; }
function removeAliasFromRef(ref) {
  if (!ref) return "";
  const parts = String(ref).split(".");
  return stripQuote(parts[parts.length - 1] || "");
}

function canonSelectColumns(cols, { ignoreSelectOrder }) {
  const list = (cols || []).map((c) => {
    const e = c?.expr || c;
    if (!e) return "*unknown*";
    if (e.type === "star") return "*";
    if (e.type === "column_ref") {
      return removeAliasFromRef(`${e.table}.${e.column}`);
    }
    if (e.type === "aggr_func") {
      const arg = e.args?.expr;
      const inner = arg?.type === "star" ? "*" : removeAliasFromRef(`${arg?.table}.${arg?.column}`);
      return `FUNC:${String(e.name)}(${inner})`;
    }
    return `EXPR:${JSON.stringify(e)}`;
  });
  return ignoreSelectOrder ? [...list].sort() : list;
}

function canonTables(fromArr) {
  const names = [];
  for (const f of Array.isArray(fromArr) ? fromArr : [fromArr]) {
    if (!f) continue;
    if (f.table) names.push(stripQuote(f.table));
    if (f.as) names.push(stripQuote(f.as));
  }
  return [...new Set(names)].sort();
}

function canonJoins(fromArr) {
  const joins = [];
  for (const f of Array.isArray(fromArr) ? fromArr : [fromArr]) {
    if (!f?.join) continue;
    joins.push({
      join: String(f.join),
      table: stripQuote(f.table || ""),
      on: f.on || null
    });
  }
  joins.sort((a, b) => (a.table + a.join).localeCompare(b.table + b.join));
  return joins;
}

function canonGroupBy(groupby) {
  const cols = groupby?.columns ?? groupby ?? [];
  return (Array.isArray(cols) ? cols : [cols])
    .map((c) => removeAliasFromRef(`${c?.table}.${c?.column}`))
    .filter(Boolean)
    .sort();
}

function canonOrderBy(orderby, { ignoreOrderBy }) {
  const list = (orderby || []).map((o) => {
    const e = o.expr || {};
    const key =
      e.type === "column_ref"
        ? removeAliasFromRef(`${e.table}.${e.column}`)
        : `EXPR:${JSON.stringify(e)}`;
    const dir = String(o.type || "ASC");
    return `${key}:${dir}`;
  });
  return ignoreOrderBy ? [] : list;
}

function extractStructure(ast, opts = {}) {
  const node = Array.isArray(ast) ? ast[0] : ast;
  if (!node || node.type !== "select") {
    return { type: node?.type || "unknown" };
  }
  return {
    type: "select",
    columns: canonSelectColumns(node.columns, opts),
    tables: canonTables(node.from),
    joins: canonJoins(node.from),
    where: node.where || null,
    having: node.having || null,
    groupBy: canonGroupBy(node.groupby),
    orderBy: canonOrderBy(node.orderby, opts)
  };
}

function diffStructures(A, B) {
  const issues = [];
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  if (A.type !== B.type) issues.push({ field: "type", expect: B.type, got: A.type });
  const fields = ["columns", "tables", "joins", "where", "having", "groupBy", "orderBy"];
  for (const f of fields) {
    if (!same(A[f], B[f])) {
      issues.push({
        field: f,
        expect: B[f],
        got: A[f]
      });
    }
  }
  const ok = issues.length === 0;
  const score = Math.max(0, Math.round(100 - (issues.length / fields.length) * 100));
  return { ok, issues, score };
}

export async function checkSQLStructure(studentSQL, teacherSQL, opts = {}) {
  let studentAST, teacherAST;
  console.log("checkSQLStructure: Parsing SQL...");
  
  // ลบคอมเมนต์ออกก่อน parsing
  const cleanStudentSQL = studentSQL.replace(/(--[^\n]*\n?)/g, '').trim();
  const cleanTeacherSQL = teacherSQL.replace(/(--[^\n]*\n?)/g, '').trim();
  
  try {
    studentAST = parser.astify(cleanStudentSQL, { database: opts.dialect || "mysql" });
  } catch (e) {
    return { error: "Invalid studentSQL", detail: String(e.message || e) };
  }
  try {
    teacherAST = parser.astify(cleanTeacherSQL, { database: opts.dialect || "mysql" });
  } catch (e) {
    return { error: "Invalid teacherSQL", detail: String(e.message || e) };
  }
  const sAst = Array.isArray(studentAST) ? studentAST.find(n => n?.type === "select") : studentAST;
  const tAst = Array.isArray(teacherAST) ? teacherAST.find(n => n?.type === "select") : teacherAST;
  if (!sAst || !tAst) {
    return { error: "Only SELECT comparison is supported currently." };
  }
  const studentStruct = extractStructure(sAst, opts);
  const teacherStruct = extractStructure(tAst, opts);
  const { ok, issues, score } = diffStructures(studentStruct, teacherStruct);
  console.log("checkSQLStructure:", { ok, score, issues });
  return {
    ok,
    score,     
    issues,      
    studentStruct,
    teacherStruct
  };
}
