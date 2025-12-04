import pkg from "node-sql-parser";
const { Parser } = pkg;
const parser = new Parser();

function stripQuote(s) { 
    return typeof s === "string" ? s.replace(/[`"'[\]]/g, "") : s; 
}

export function getSQLType(sql) {
    try {
        const trimmedSQL = sql.trim();
        
        // ใช้ regex เพื่อตรวจสอบคำสั่ง SQL แบบ case-insensitive และจับคู่เฉพาะคำสั่งหลัก
        const sqlTypeMatch = trimmedSQL.match(/^\s*(select|delete|insert|update|create|drop|alter|show|truncate|replace|call|explain|describe|desc)\b/i);
        
        if (sqlTypeMatch) {
            const sqlType = sqlTypeMatch[1].toLowerCase();
            
            // ส่งคืนเฉพาะประเภทที่รองรับในระบบ
            if (['select', 'delete', 'insert', 'update'].includes(sqlType)) {
                return sqlType;
            }
            
            // สำหรับคำสั่งอื่นๆ ที่ไม่ได้รองรับในการตรวจสอบ
            console.log(`Detected unsupported SQL type: ${sqlType}`);
            return 'unsupported';
        }
        
        return 'unknown';
    } catch (error) {
        console.error('Error detecting SQL type:', error);
        return 'unknown';
    }
}

/**
 * แยกชื่อตารางจากคำสั่ง SQL
 * @param {string} sql - คำสั่ง SQL
 * @returns {string|null} - ชื่อตาราง หรือ null ถ้าไม่พบ
 */
export function extractTableNameFromSQL(sql) {
    try {
        const trimmedSQL = sql.trim();
        
        // ใช้ regex แบบง่ายก่อน เพราะ parser อาจมีปัญหากับ SQL บางรูปแบบ
        const lowerSQL = trimmedSQL.toLowerCase();
        
        // สำหรับ SELECT
        const selectMatch = lowerSQL.match(/from\s+`?(\w+)`?/i);
        if (selectMatch) {
            return selectMatch[1];
        }
        
        // สำหรับ DELETE
        const deleteMatch = lowerSQL.match(/delete\s+from\s+`?(\w+)`?/i);
        if (deleteMatch) {
            return deleteMatch[1];
        }
        
        // สำหรับ INSERT
        const insertMatch = lowerSQL.match(/insert\s+into\s+`?(\w+)`?/i);
        if (insertMatch) {
            return insertMatch[1];
        }
        
        // สำหรับ UPDATE
        const updateMatch = lowerSQL.match(/update\s+`?(\w+)`?/i);
        if (updateMatch) {
            return updateMatch[1];
        }
        
        // ถ้า regex ไม่พบ ให้ลองใช้ parser
        const sqlType = getSQLType(trimmedSQL);
        
        if (sqlType === 'unknown' || sqlType === 'unsupported') {
            return null;
        }
        
        // ใช้ SQL parser เพื่อแยกชื่อตาราง
        const ast = parser.astify(trimmedSQL, { database: "mysql" });
        const node = Array.isArray(ast) ? ast[0] : ast;
        
        if (!node) {
            return null;
        }
        
        let tableName = null;
        
        switch (sqlType) {
            case 'select':
                // สำหรับ SELECT ดึงชื่อตารางจาก FROM clause
                if (node.from && node.from.length > 0) {
                    tableName = stripQuote(node.from[0].table);
                }
                break;
                
            case 'delete':
                // สำหรับ DELETE ดึงชื่อตารางจาก table property
                if (node.table && node.table.length > 0) {
                    tableName = stripQuote(node.table[0].table);
                }
                break;
                
            case 'insert':
                // สำหรับ INSERT ดึงชื่อตารางจาก table property
                if (node.table && node.table.length > 0) {
                    tableName = stripQuote(node.table[0].table);
                }
                break;
                
            case 'update':
                // สำหรับ UPDATE ดึงชื่อตารางจาก table property
                if (node.table && node.table.length > 0) {
                    tableName = stripQuote(node.table[0].table);
                }
                break;
        }
        
        return tableName;
    } catch (error) {
        console.error('Error extracting table name from SQL:', error);
        return null;
    }
}

/**
 * แยกโครงสร้างของคำสั่ง DELETE
*/
function extractDeleteStructure(ast) {
    const node = Array.isArray(ast) ? ast[0] : ast;
    if (!node || node.type !== "delete") {
        return { type: node?.type || "unknown" };
    }
    
    return {
        type: "delete",
        table: stripQuote(node.table?.[0]?.table) || null,
        where: node.where || null,
        orderBy: node.orderby || null,
        limit: node.limit || null
    };
}

/**
 * แยกโครงสร้างของคำสั่ง INSERT
 */
function extractInsertStructure(ast) {
    const node = Array.isArray(ast) ? ast[0] : ast;
    if (!node || node.type !== "insert") {
        return { type: node?.type || "unknown" };
    }
    
    return {
        type: "insert",
        table: stripQuote(node.table?.[0]?.table) || null,
        columns: node.columns?.map(col => stripQuote(col)) || [],
        values: node.values || []
    };
}

/**
 * แยกโครงสร้างของคำสั่ง UPDATE
 */
function extractUpdateStructure(ast) {
    const node = Array.isArray(ast) ? ast[0] : ast;
    if (!node || node.type !== "update") {
        return { type: node?.type || "unknown" };
    }
    
    return {
        type: "update",
        table: stripQuote(node.table?.[0]?.table) || null,
        set: node.set || null,
        where: node.where || null,
        orderBy: node.orderby || null,
        limit: node.limit || null
    };
}

/**
 * เปรียบเทียบโครงสร้างของคำสั่ง DELETE สองคำสั่ง
 */
function diffDeleteStructures(studentStruct, teacherStruct) {
    const issues = [];
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    
    if (studentStruct.type !== teacherStruct.type) {
        issues.push({ field: "type", expect: teacherStruct.type, got: studentStruct.type });
    }
    
    const fields = ["table", "where", "orderBy", "limit"];
    for (const f of fields) {
        if (!same(studentStruct[f], teacherStruct[f])) {
            issues.push({
                field: f,
                expect: teacherStruct[f],
                got: studentStruct[f]
            });
        }
    }
    
    const ok = issues.length === 0;
    const score = Math.max(0, Math.round(100 - (issues.length / fields.length) * 100));
    return { ok, issues, score };
}

/**
 * เปรียบเทียบโครงสร้างของคำสั่ง INSERT สองคำสั่ง
 */
function diffInsertStructures(studentStruct, teacherStruct) {
    const issues = [];
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    
    if (studentStruct.type !== teacherStruct.type) {
        issues.push({ field: "type", expect: teacherStruct.type, got: studentStruct.type });
    }
    
    const fields = ["table", "columns"];
    for (const f of fields) {
        if (!same(studentStruct[f], teacherStruct[f])) {
            issues.push({
                field: f,
                expect: teacherStruct[f],
                got: studentStruct[f]
            });
        }
    }
    
    const ok = issues.length === 0;
    const score = Math.max(0, Math.round(100 - (issues.length / fields.length) * 100));
    return { ok, issues, score };
}

/**
 * เปรียบเทียบโครงสร้างของคำสั่ง UPDATE สองคำสั่ง
 */
function diffUpdateStructures(studentStruct, teacherStruct) {
    const issues = [];
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    
    if (studentStruct.type !== teacherStruct.type) {
        issues.push({ field: "type", expect: teacherStruct.type, got: studentStruct.type });
    }
    
    const fields = ["table", "set", "where", "orderBy", "limit"];
    for (const f of fields) {
        if (!same(studentStruct[f], teacherStruct[f])) {
            issues.push({
                field: f,
                expect: teacherStruct[f],
                got: studentStruct[f]
            });
        }
    }
    
    const ok = issues.length === 0;
    const score = Math.max(0, Math.round(100 - (issues.length / fields.length) * 100));
    return { ok, issues, score };
}

/**
 * ตรวจสอบโครงสร้างของคำสั่ง DELETE
 **/
export async function checkDeleteStructure(studentSQL, teacherSQL, opts = {}) {
    let studentAST, teacherAST;
    console.log("checkDeleteStructure: Parsing SQL...");
    try {
        studentAST = parser.astify(studentSQL, { database: opts.dialect || "mysql" });
    } catch (e) {
        return { error: "Invalid studentSQL", detail: String(e.message || e) };
    }
    try {
        teacherAST = parser.astify(teacherSQL, { database: opts.dialect || "mysql" });
    } catch (e) {
        return { error: "Invalid teacherSQL", detail: String(e.message || e) };
    }
    
    const sAst = Array.isArray(studentAST) ? studentAST.find(n => n?.type === "delete") : studentAST;
    const tAst = Array.isArray(teacherAST) ? teacherAST.find(n => n?.type === "delete") : teacherAST;
    
    if (!sAst || !tAst) {
        return { error: "Only DELETE comparison is supported in this function." };
    }
    
    const studentStruct = extractDeleteStructure(sAst);
    const teacherStruct = extractDeleteStructure(tAst);
    const { ok, issues, score } = diffDeleteStructures(studentStruct, teacherStruct);
    
    console.log("checkDeleteStructure:", { ok, score, issues });
    return {
        ok,
        score,     
        issues,      
        studentStruct,
        teacherStruct
    };
}

/**
 * ตรวจสอบโครงสร้างของคำสั่ง INSERT
 * @param {string} studentSQL - คำสั่ง SQL ของนักเรียน
 * @param {string} teacherSQL - คำสั่ง SQL ของอาจารย์
 * @param {Object} opts - ตัวเลือกเพิ่มเติม
 * @returns {Object} - ผลการตรวจสอบโครงสร้าง
 */
export async function checkInsertStructure(studentSQL, teacherSQL, opts = {}) {
    let studentAST, teacherAST;
    try {
        studentAST = parser.astify(studentSQL, { database: opts.dialect || "mysql" });
    } catch (e) {
        return { error: "Invalid studentSQL", detail: String(e.message || e) };
    }
    try {
        teacherAST = parser.astify(teacherSQL, { database: opts.dialect || "mysql" });
    } catch (e) {
        return { error: "Invalid teacherSQL", detail: String(e.message || e) };
    }
    
    const sAst = Array.isArray(studentAST) ? studentAST.find(n => n?.type === "insert") : studentAST;
    const tAst = Array.isArray(teacherAST) ? teacherAST.find(n => n?.type === "insert") : teacherAST;
    
    if (!sAst || !tAst) {
        return { error: "Only INSERT comparison is supported in this function." };
    }
    
    const studentStruct = extractInsertStructure(sAst);
    const teacherStruct = extractInsertStructure(tAst);
    const { ok, issues, score } = diffInsertStructures(studentStruct, teacherStruct);
    
    return {
        ok,
        score,     
        issues,      
        studentStruct,
        teacherStruct
    };
}

/**
 * ตรวจสอบโครงสร้างของคำสั่ง UPDATE
 * @param {string} studentSQL - คำสั่ง SQL ของนักเรียน
 * @param {string} teacherSQL - คำสั่ง SQL ของอาจารย์
 * @param {Object} opts - ตัวเลือกเพิ่มเติม
 * @returns {Object} - ผลการตรวจสอบโครงสร้าง
 */
export async function checkUpdateStructure(studentSQL, teacherSQL, opts = {}) {
    let studentAST, teacherAST;
    try {
        studentAST = parser.astify(studentSQL, { database: opts.dialect || "mysql" });
    } catch (e) {
        return { error: "Invalid studentSQL", detail: String(e.message || e) };
    }
    try {
        teacherAST = parser.astify(teacherSQL, { database: opts.dialect || "mysql" });
    } catch (e) {
        return { error: "Invalid teacherSQL", detail: String(e.message || e) };
    }
    
    const sAst = Array.isArray(studentAST) ? studentAST.find(n => n?.type === "update") : studentAST;
    const tAst = Array.isArray(teacherAST) ? teacherAST.find(n => n?.type === "update") : teacherAST;
    
    if (!sAst || !tAst) {
        return { error: "Only UPDATE comparison is supported in this function." };
    }
    
    const studentStruct = extractUpdateStructure(sAst);
    const teacherStruct = extractUpdateStructure(tAst);
    const { ok, issues, score } = diffUpdateStructures(studentStruct, teacherStruct);
    
    return {
        ok,
        score,
        issues,
        studentStruct,
        teacherStruct
    };
}

/**
 * ตรวจสอบผลลัพธ์ของคำสั่ง DELETE
 * @param {string} studentSQL - คำสั่ง SQL ของนักเรียน
 * @param {string} teacherSQL - คำสั่ง SQL ของอาจารย์
 * @param {Object} dbConnection - การเชื่อมต่อฐานข้อมูล
 * @param {string} testTable - ชื่อตารางสำหรับทดสอบ
 * @returns {Object} - ผลการตรวจสอบผลลัพธ์
 */
export async function checkDeleteResults(studentSQL, teacherSQL, dbConnection, testTable) {
    if (!testTable) {
        return {
            error: "Test table not specified",
            score: 0,
            match: false,
            reason: "ไม่มีตารางสำหรับทดสอบ"
        };
    }
    
    // สร้างชื่อตารางชั่วคราว
    const timestamp = Date.now();
    const tempOriginalTable = `temp_original_${timestamp}`;
    const tempStudentTable = `temp_student_${timestamp}`;
    const tempTeacherTable = `temp_teacher_${timestamp}`;
    const tempStudentDeleted = `temp_student_deleted_${timestamp}`;
    const tempTeacherDeleted = `temp_teacher_deleted_${timestamp}`;
    
    try {
        // คัดลอกโครงสร้างและข้อมูลของตารางต้นฉบับ
        await dbConnection.query(`CREATE TABLE ${tempOriginalTable} AS SELECT * FROM ${testTable}`);
        await dbConnection.query(`CREATE TABLE ${tempStudentTable} AS SELECT * FROM ${testTable}`);
        await dbConnection.query(`CREATE TABLE ${tempTeacherTable} AS SELECT * FROM ${testTable}`);
        
        // นับจำนวนแถวก่อนการลบ
        const [originalCount] = await dbConnection.query(`SELECT COUNT(*) as count FROM ${testTable}`);
        
        // รันคำสั่ง DELETE ของนักเรียน
        const studentDeleteSQL = studentSQL.replace(new RegExp(testTable, 'gi'), tempStudentTable);
        await dbConnection.query(studentDeleteSQL);
        
        // รันคำสั่ง DELETE ของอาจารย์
        const teacherDeleteSQL = teacherSQL.replace(new RegExp(testTable, 'gi'), tempTeacherTable);
        await dbConnection.query(teacherDeleteSQL);
        
        // สร้างตารางเก็บข้อมูลที่ถูกลบโดยนักเรียน
        const primaryKeyColumn = await getPrimaryKeyColumn(tempOriginalTable, dbConnection);
        
        await dbConnection.query(`
            CREATE TABLE ${tempStudentDeleted} AS
            SELECT o.* FROM ${tempOriginalTable} o
            LEFT JOIN ${tempStudentTable} s ON o.${primaryKeyColumn} = s.${primaryKeyColumn}
            WHERE s.${primaryKeyColumn} IS NULL
        `);
        
        // สร้างตารางเก็บข้อมูลที่ถูกลบโดยอาจารย์
        await dbConnection.query(`
            CREATE TABLE ${tempTeacherDeleted} AS
            SELECT o.* FROM ${tempOriginalTable} o
            LEFT JOIN ${tempTeacherTable} t ON o.${primaryKeyColumn} = t.${primaryKeyColumn}
            WHERE t.${primaryKeyColumn} IS NULL
        `);
        
        // นับจำนวนแถวที่ถูกลบ
        const [studentDeletedRows] = await dbConnection.query(`SELECT COUNT(*) as count FROM ${tempStudentDeleted}`);
        const [teacherDeletedRows] = await dbConnection.query(`SELECT COUNT(*) as count FROM ${tempTeacherDeleted}`);
        
        const studentDeleted = studentDeletedRows[0].count;
        const teacherDeleted = teacherDeletedRows[0].count;
        
        // ตรวจสอบว่าแถวที่ถูกลบตรงกันหรือไม่
        let exactMatch = false;
        let matchScore = 0;
        
        if (studentDeleted === teacherDeleted && studentDeleted > 0) {
            // ตรวจสอบว่าข้อมูลในแถวที่ถูกลบตรงกันทุกแถวหรือไม่
            // ใช้วิธีการเปรียบเทียบแถวโดยตรงโดยใช้ Primary Key
            const [matchCheck] = await dbConnection.query(`
                SELECT COUNT(*) as match_count FROM (
                    SELECT s.${primaryKeyColumn} FROM ${tempStudentDeleted} s
                    WHERE EXISTS (
                        SELECT 1 FROM ${tempTeacherDeleted} t WHERE s.${primaryKeyColumn} = t.${primaryKeyColumn}
                    )
                ) AS matched_rows
            `);
            
            const exactMatches = matchCheck[0].match_count;
            matchScore = exactMatches / teacherDeleted;
            exactMatch = exactMatches === teacherDeleted;
        } else if (studentDeleted === 0 && teacherDeleted === 0) {
            // กรณีไม่มีการลบข้อมูล
            exactMatch = true;
            matchScore = 1.0;
        }
        
        // คำนวณคะแนนสุดท้าย
        const finalScore = exactMatch ? 1.0 : matchScore;
        
        return {
            match: exactMatch,
            score: finalScore,
            studentDeleted,
            teacherDeleted,
            originalCount: originalCount[0].count,
            reason: exactMatch
                ? `ลบข้อมูลถูกต้อง (${studentDeleted} แถว)`
                : studentDeleted === teacherDeleted
                    ? `ลบข้อมูลจำนวนแถวถูกต้อง (${studentDeleted} แถว) แต่ข้อมูลที่ลบไม่ตรงกัน (ตรงกัน ${Math.round(matchScore * 100)}%)`
                    : `ลบข้อมูลไม่ถูกต้อง (นักเรียน: ${studentDeleted} แถว, อาจารย์: ${teacherDeleted} แถว)`
        };
    } catch (error) {
        console.error('Error in checkDeleteResults:', error);
        return {
            error: error.message,
            score: 0,
            match: false,
            reason: `เกิดข้อผิดพลาด: ${error.message}`
        };
    } finally {
        // ลบตารางชั่วคราว
        try {
            await dbConnection.query(`DROP TABLE IF EXISTS ${tempOriginalTable}`);
            await dbConnection.query(`DROP TABLE IF EXISTS ${tempStudentTable}`);
            await dbConnection.query(`DROP TABLE IF EXISTS ${tempTeacherTable}`);
            await dbConnection.query(`DROP TABLE IF EXISTS ${tempStudentDeleted}`);
            await dbConnection.query(`DROP TABLE IF EXISTS ${tempTeacherDeleted}`);
        } catch (error) {
            console.error('Error dropping temporary tables:', error);
        }
    }
}

/**
 * ตรวจสอบผลลัพธ์ของคำสั่ง INSERT
 * @param {string} studentSQL - คำสั่ง SQL ของนักเรียน
 * @param {string} teacherSQL - คำสั่ง SQL ของอาจารย์
 * @param {Object} dbConnection - การเชื่อมต่อฐานข้อมูล
 * @param {string} testTable - ชื่อตารางสำหรับทดสอบ
 * @returns {Object} - ผลการตรวจสอบผลลัพธ์
 */
export async function checkInsertResults(studentSQL, teacherSQL, dbConnection, testTable) {
    if (!testTable) {
        return {
            error: "Test table not specified",
            score: 0,
            match: false,
            reason: "ไม่มีตารางสำหรับทดสอบ"
        };
    }
    
    // สร้างชื่อตารางชั่วคราว
    const timestamp = Date.now();
    const tempOriginalTable = `temp_original_${timestamp}`;
    const tempStudentTable = `temp_student_${timestamp}`;
    const tempTeacherTable = `temp_teacher_${timestamp}`;
    
    try {
        // คัดลอกโครงสร้างของตารางต้นฉบับ (ไม่รวมข้อมูล)
        await dbConnection.query(`CREATE TABLE ${tempStudentTable} AS SELECT * FROM ${testTable} WHERE 1=0`);
        await dbConnection.query(`CREATE TABLE ${tempTeacherTable} AS SELECT * FROM ${testTable} WHERE 1=0`);
        
        // รันคำสั่ง INSERT ของนักเรียน
        const studentInsertSQL = studentSQL.replace(new RegExp(testTable, 'gi'), tempStudentTable);
        await dbConnection.query(studentInsertSQL);
        
        // รันคำสั่ง INSERT ของอาจารย์
        const teacherInsertSQL = teacherSQL.replace(new RegExp(testTable, 'gi'), tempTeacherTable);
        await dbConnection.query(teacherInsertSQL);
        
        // นับจำนวนแถวที่ถูกเพิ่ม
        const [studentInsertedRows] = await dbConnection.query(`SELECT COUNT(*) as count FROM ${tempStudentTable}`);
        const [teacherInsertedRows] = await dbConnection.query(`SELECT COUNT(*) as count FROM ${tempTeacherTable}`);
        
        const studentInserted = studentInsertedRows[0].count;
        const teacherInserted = teacherInsertedRows[0].count;
        
        // ตรวจสอบว่าแถวที่ถูกเพิ่มตรงกันหรือไม่
        let exactMatch = false;
        let matchScore = 0;
        
        if (studentInserted === teacherInserted && studentInserted > 0) {
            // ตรวจสอบว่าข้อมูลในแถวที่ถูกเพิ่มตรงกันทุกแถวหรือไม่
            const primaryKeyColumn = await getPrimaryKeyColumn(tempStudentTable, dbConnection);
            
            const [matchCheck] = await dbConnection.query(`
                SELECT COUNT(*) as match_count FROM (
                    SELECT s.${primaryKeyColumn} FROM ${tempStudentTable} s
                    WHERE EXISTS (
                        SELECT 1 FROM ${tempTeacherTable} t WHERE s.${primaryKeyColumn} = t.${primaryKeyColumn}
                    )
                ) AS matched_rows
            `);
            
            const exactMatches = matchCheck[0].match_count;
            matchScore = exactMatches / teacherInserted;
            exactMatch = exactMatches === teacherInserted;
        } else if (studentInserted === 0 && teacherInserted === 0) {
            // กรณีไม่มีการเพิ่มข้อมูล
            exactMatch = true;
            matchScore = 1.0;
        }
        
        // คำนวณคะแนนสุดท้าย
        const finalScore = exactMatch ? 1.0 : matchScore;
        
        return {
            match: exactMatch,
            score: finalScore,
            studentInserted,
            teacherInserted,
            reason: exactMatch
                ? `เพิ่มข้อมูลถูกต้อง (${studentInserted} แถว)`
                : studentInserted === teacherInserted
                    ? `เพิ่มข้อมูลจำนวนแถวถูกต้อง (${studentInserted} แถว) แต่ข้อมูลที่เพิ่มไม่ตรงกัน (ตรงกัน ${Math.round(matchScore * 100)}%)`
                    : `เพิ่มข้อมูลไม่ถูกต้อง (นักเรียน: ${studentInserted} แถว, อาจารย์: ${teacherInserted} แถว)`
        };
    } catch (error) {
        console.error('Error in checkInsertResults:', error);
        return {
            error: error.message,
            score: 0,
            match: false,
            reason: `เกิดข้อผิดพลาด: ${error.message}`
        };
    } finally {
        // ลบตารางชั่วคราว
        try {
            await dbConnection.query(`DROP TABLE IF EXISTS ${tempStudentTable}`);
            await dbConnection.query(`DROP TABLE IF EXISTS ${tempTeacherTable}`);
        } catch (error) {
            console.error('Error dropping temporary tables:', error);
        }
    }
}

/**
 * ตรวจสอบผลลัพธ์ของคำสั่ง UPDATE
 * @param {string} studentSQL - คำสั่ง SQL ของนักเรียน
 * @param {string} teacherSQL - คำสั่ง SQL ของอาจารย์
 * @param {Object} dbConnection - การเชื่อมต่อฐานข้อมูล
 * @param {string} testTable - ชื่อตารางสำหรับทดสอบ
 * @returns {Object} - ผลการตรวจสอบผลลัพธ์
 */
export async function checkUpdateResults(studentSQL, teacherSQL, dbConnection, testTable) {
    if (!testTable) {
        return {
            error: "Test table not specified",
            score: 0,
            match: false,
            reason: "ไม่มีตารางสำหรับทดสอบ"
        };
    }
    
    // สร้างชื่อตารางชั่วคราว
    const timestamp = Date.now();
    const tempOriginalTable = `temp_original_${timestamp}`;
    const tempStudentTable = `temp_student_${timestamp}`;
    const tempTeacherTable = `temp_teacher_${timestamp}`;
    
    try {
        // คัดลอกโครงสร้างและข้อมูลของตารางต้นฉบับ
        await dbConnection.query(`CREATE TABLE ${tempOriginalTable} AS SELECT * FROM ${testTable}`);
        await dbConnection.query(`CREATE TABLE ${tempStudentTable} AS SELECT * FROM ${testTable}`);
        await dbConnection.query(`CREATE TABLE ${tempTeacherTable} AS SELECT * FROM ${testTable}`);
        
        // รันคำสั่ง UPDATE ของนักเรียน
        const studentUpdateSQL = studentSQL.replace(new RegExp(testTable, 'gi'), tempStudentTable);
        await dbConnection.query(studentUpdateSQL);
        
        // รันคำสั่ง UPDATE ของอาจารย์
        const teacherUpdateSQL = teacherSQL.replace(new RegExp(testTable, 'gi'), tempTeacherTable);
        await dbConnection.query(teacherUpdateSQL);
        
        // ตรวจสอบว่าแถวที่ถูกอัปเดตตรงกันหรือไม่
        let exactMatch = false;
        let matchScore = 0;
        
        // นับจำนวนแถวทั้งหมดในตาราง
        const [studentCount] = await dbConnection.query(`SELECT COUNT(*) as count FROM ${tempStudentTable}`);
        const [teacherCount] = await dbConnection.query(`SELECT COUNT(*) as count FROM ${tempTeacherTable}`);
        
        // หา Primary Key
        const primaryKeyColumn = await getPrimaryKeyColumn(tempStudentTable, dbConnection);
        
        // ตรวจสอบว่ามีแถวที่ถูกอัปเดตหรือไม่
        const studentUpdateCondition = await getUpdateComparisonCondition('s', 'o', dbConnection, tempStudentTable);
        const [studentChangedRows] = await dbConnection.query(`
            SELECT COUNT(*) as count FROM ${tempStudentTable} s
            JOIN ${tempOriginalTable} o ON s.${primaryKeyColumn} = o.${primaryKeyColumn}
            WHERE ${studentUpdateCondition}
        `);
        
        const teacherUpdateCondition = await getUpdateComparisonCondition('t', 'o', dbConnection, tempTeacherTable);
        const [teacherChangedRows] = await dbConnection.query(`
            SELECT COUNT(*) as count FROM ${tempTeacherTable} t
            JOIN ${tempOriginalTable} o ON t.${primaryKeyColumn} = o.${primaryKeyColumn}
            WHERE ${teacherUpdateCondition}
        `);
        
        const studentChanged = studentChangedRows[0].count;
        const teacherChanged = teacherChangedRows[0].count;
        
        if (studentChanged === teacherChanged && studentChanged > 0) {
            // ตรวจสอบว่าข้อมูลที่ถูกอัปเดตตรงกันทุกแถวหรือไม่
            const matchUpdateCondition = await getUpdateComparisonCondition('s', 't', dbConnection, tempStudentTable, 'equal');
            const [matchCheck] = await dbConnection.query(`
                SELECT COUNT(*) as match_count FROM (
                    SELECT s.${primaryKeyColumn} FROM ${tempStudentTable} s
                    JOIN ${tempTeacherTable} t ON s.${primaryKeyColumn} = t.${primaryKeyColumn}
                    WHERE ${matchUpdateCondition}
                ) AS matched_rows
            `);
            
            const exactMatches = matchCheck[0].match_count;
            // แก้ไขการคำนวณเปอร์เซ็นต์ให้ไม่เกิน 100%
            matchScore = Math.min(exactMatches / teacherChanged, 1.0);
            exactMatch = exactMatches === teacherChanged;
        } else if (studentChanged === 0 && teacherChanged === 0) {
            // กรณีไม่มีการอัปเดตข้อมูล
            exactMatch = true;
            matchScore = 1.0;
        }
        
        // คำนวณคะแนนสุดท้าย
        const finalScore = exactMatch ? 1.0 : matchScore;
        
        return {
            match: exactMatch,
            score: finalScore,
            studentChanged,
            teacherChanged,
            reason: exactMatch
                ? `อัปเดตข้อมูลถูกต้อง (${studentChanged} แถว)`
                : studentChanged === teacherChanged
                    ? `อัปเดตข้อมูลจำนวนแถวถูกต้อง (${studentChanged} แถว) แต่ข้อมูลที่อัปเดตไม่ตรงกัน (ตรงกัน ${Math.round(matchScore * 100)}%)`
                    : `อัปเดตข้อมูลไม่ถูกต้อง (นักเรียน: ${studentChanged} แถว, อาจารย์: ${teacherChanged} แถว)`
        };
    } catch (error) {
        console.error('Error in checkUpdateResults:', error);
        return {
            error: error.message,
            score: 0,
            match: false,
            reason: `เกิดข้อผิดพลาด: ${error.message}`
        };
    } finally {
        // ลบตารางชั่วคราว
        try {
            await dbConnection.query(`DROP TABLE IF EXISTS ${tempOriginalTable}`);
            await dbConnection.query(`DROP TABLE IF EXISTS ${tempStudentTable}`);
            await dbConnection.query(`DROP TABLE IF EXISTS ${tempTeacherTable}`);
        } catch (error) {
            console.error('Error dropping temporary tables:', error);
        }
    }
}

/**
 * สร้างเงื่อนไขการเชื่อมต่อตาม Primary Key
 * @param {string} table1 - ชื่อตารางแรก
 * @param {string} table2 - ชื่อตารางที่สอง
 * @param {Object} dbConnection - การเชื่อมต่อฐานข้อมูล
 * @returns {string} - เงื่อนไขการเชื่อมต่อ
 */
async function getPrimaryKeyJoinCondition(table1, table2, dbConnection) {
    try {
        // ในกรณีที่ไม่สามารถระบุ Primary Key ได้ ให้ใช้วิธีเปรียบเทียบคอลัมน์ทั้งหมด
        const [columns] = await dbConnection.query(`SHOW COLUMNS FROM ${table1}`);
        const conditions = columns.map(col => `${table1}.${col.Field} = ${table2}.${col.Field}`).join(' AND ');
        return conditions;
    } catch (error) {
        console.error('Error getting primary key join condition:', error);
        // ถ้าเกิดข้อผิดพลาด ให้ใช้วิธีเปรียบเทียบคอลัมน์ทั้งหมด
        return `${table1}.* = ${table2}.*`;
    }
}

/**
 * ดึงชื่อคอลัมน์ Primary Key
 * @param {string} tableName - ชื่อตาราง
 * @param {Object} dbConnection - การเชื่อมต่อฐานข้อมูล
 * @returns {string} - ชื่อคอลัมน์ Primary Key
 */
async function getPrimaryKeyColumn(tableName, dbConnection) {
    try {
        // พยายามหา Primary Key จากข้อมูลโครงสร้างตาราง
        const [keyInfo] = await dbConnection.query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'
            AND CONSTRAINT_NAME = 'PRIMARY'
            LIMIT 1
        `);
        
        if (keyInfo.length > 0) {
            return keyInfo[0].COLUMN_NAME;
        }
        
        // ถ้าไม่พบ Primary Key ให้ลองคอลัมน์ที่น่าจะเป็น Primary Key ทั่วไป
        const [columns] = await dbConnection.query(`SHOW COLUMNS FROM ${tableName}`);
        
        // ตรวจสอบคอลัมน์ที่น่าจะเป็น Primary Key
        const possibleKeys = ['id', 'ID', 'Id', '_id', 'uuid', 'UUID'];
        for (const key of possibleKeys) {
            if (columns.some(col => col.Field === key)) {
                return key;
            }
        }
        
        // ถ้าไม่พบ ให้ใช้คอลัมน์แรก
        return columns[0]?.Field || 'id';
    } catch (error) {
        console.error('Error getting primary key column:', error);
        return 'id'; // ค่าเริ่มต้น
    }
}

/**
 * สร้างเงื่อนไขการเปรียบเทียบแถว
 * @param {string} alias1 - ชื่อ alias ตารางแรก
 * @param {string} alias2 - ชื่อ alias ตารางที่สอง
 * @param {Object} dbConnection - การเชื่อมต่อฐานข้อมูล
 * @returns {string} - เงื่อนไขการเปรียบเทียบแถว
 */
async function getRowComparisonCondition(alias1, alias2, dbConnection) {
    try {
        // ดึงข้อมูลคอลัมน์ทั้งหมดในตาราง
        const [columns] = await dbConnection.query(`SHOW COLUMNS FROM temp_student_deleted`);
        const conditions = columns.map(col => `${alias1}.${col.Field} = ${alias2}.${col.Field}`).join(' AND ');
        return conditions;
    } catch (error) {
        console.error('Error getting row comparison condition:', error);
        return `${alias1}.* = ${alias2}.*`;
    }
}

/**
 * สร้างเงื่อนไขการเปรียบเทียบข้อมูลที่ถูกอัปเดต
 * @param {string} alias1 - ชื่อ alias ตารางแรก
 * @param {string} alias2 - ชื่อ alias ตารางที่สอง
 * @param {Object} dbConnection - การเชื่อมต่อฐานข้อมูล
 * @param {string} comparisonType - ประเภทการเปรียบเทียบ ('not_equal' หรือ 'equal')
 * @returns {string} - เงื่อนไขการเปรียบเทียบ
 */
async function getUpdateComparisonCondition(alias1, alias2, dbConnection, tableName, comparisonType = 'not_equal') {
    try {
        // ดึงข้อมูลคอลัมน์ทั้งหมดในตาราง ยกเว้น Primary Key
        const [columns] = await dbConnection.query(`SHOW COLUMNS FROM ${tableName}`);
        const primaryKeyColumn = await getPrimaryKeyColumn(tableName, dbConnection);
        
        // สร้างเงื่อนไขการเปรียบเทียบสำหรับคอลัมน์ทั้งหมดที่ไม่ใช่ Primary Key
        const conditions = columns
            .filter(col => col.Field !== primaryKeyColumn)
            .map(col => {
                const operator = comparisonType === 'not_equal' ? '!=' : '=';
                return `${alias1}.${col.Field} ${operator} ${alias2}.${col.Field}`;
            })
            .join(' OR ');
        
        return conditions;
    } catch (error) {
        console.error('Error getting update comparison condition:', error);
        return '1=0'; // ค่าเริ่มต้นที่ปลอดภัย
    }
}