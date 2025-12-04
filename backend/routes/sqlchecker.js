import express from 'express';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { checkSQLStructure } from '../sqlchecker/sqlparser.js';
import { compareResults, percentageCompareResults } from '../sqlchecker/resultsCompare.js';
import { getSQLType, checkDeleteStructure, checkDeleteResults, checkInsertStructure, checkInsertResults, checkUpdateStructure, checkUpdateResults, extractTableNameFromSQL } from '../sqlchecker/sqlTypeChecker.js';
import JWTdecode from '../middleware/jwtdecode.js';
import { requireRole } from '../middleware/checkRole.js';

dotenv.config();

const router = express.Router();

// สร้างการเชื่อมต่อกับฐานข้อมูล
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// API สำหรับทดสอบการตรวจสอบโครงสร้าง SQL
router.post('/check-structure', JWTdecode, requireRole(3), async (req, res) => {
    const { studentSQL, teacherSQL } = req.body;
    
    if (!studentSQL || !teacherSQL) {
        return res.status(400).json({ error: 'ต้องระบุ studentSQL และ teacherSQL' });
    }
    
    try {
        // ลบคอมเมนต์ออกก่อนตรวจสอบโครงสร้าง
        const cleanStudentSQL = studentSQL.replace(/(--[^\n]*\n?)/g, '').trim();
        const cleanTeacherSQL = teacherSQL.replace(/(--[^\n]*\n?)/g, '').trim();
        
        const result = await checkSQLStructure(cleanStudentSQL, cleanTeacherSQL);
        res.status(200).json(result);
    } catch (error) {
        console.error('Error checking SQL structure:', error);
        res.status(500).json({ error: error.message });
    }
});

// API สำหรับทดสอบการเปรียบเทียบผลลัพธ์ SQL
router.post('/compare-results', JWTdecode, requireRole(3), async (req, res) => {
    const { studentSQL, teacherSQL, databaseName, testTable } = req.body;
    
    if (!studentSQL || !teacherSQL || !databaseName) {
        return res.status(400).json({ error: 'ต้องระบุ studentSQL, teacherSQL และ databaseName' });
    }
    
    // ลบคอมเมนต์ออกก่อนแยกชื่อตาราง
    const cleanStudentSQL = studentSQL.replace(/(--[^\n]*\n?)/g, '').trim();
    const cleanTeacherSQL = teacherSQL.replace(/(--[^\n]*\n?)/g, '').trim();
    
    // ถ้าไม่ได้ระบุ testTable ให้แยกชื่อตารางจาก teacherSQL โดยอัตโนมัติ
    let autoTestTable = testTable;
    if (!autoTestTable) {
        autoTestTable = extractTableNameFromSQL(cleanTeacherSQL);
        if (!autoTestTable) {
            return res.status(400).json({ error: 'ไม่สามารถแยกชื่อตารางจาก SQL ของอาจารย์ได้ กรุณาระบุ testTable ด้วยตนเอง' });
        }
    }
    
    let dbConn;
    try {
        // สร้างการเชื่อมต่อกับฐานข้อมูลที่ระบุ
        dbConn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: databaseName,
            port: 3306,
            multipleStatements: true
        });
        
        // รันคำสั่ง SQL ทั้งสองฝั่ง
        let studentResult = [];
        let teacherResult = [];
        
        try {
            [studentResult] = await dbConn.query(studentSQL);
        } catch (e) {
            console.error('Student SQL execution error:', e.message);
            return res.status(400).json({ error: `Student SQL Error: ${e.message}` });
        }
        
        try {
            [teacherResult] = await dbConn.query(teacherSQL);
        } catch (e) {
            console.error('Teacher SQL execution error:', e.message);
            return res.status(400).json({ error: `Teacher SQL Error: ${e.message}` });
        }
        
        // เปรียบเทียบผลลัพธ์
        const resultComparison = percentageCompareResults(studentResult, teacherResult);
        
        res.status(200).json({
            studentResult,
            teacherResult,
            comparison: resultComparison,
            detectedTable: autoTestTable // ส่งชื่อตารางที่ตรวจพบกลับไปด้วย
        });
        
    } catch (error) {
        console.error('Error comparing SQL results:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbConn) {
            await dbConn.end();
        }
    }
});

// API สำหรับทดสอบการตรวจสอบคำสั่ง DELETE
router.post('/check-delete', JWTdecode, requireRole(3), async (req, res) => {
    const { studentSQL, teacherSQL, databaseName, testTable } = req.body;
    
    if (!studentSQL || !teacherSQL || !databaseName || !testTable) {
        return res.status(400).json({ error: 'ต้องระบุ studentSQL, teacherSQL, databaseName และ testTable' });
    }
    
    let dbConn;
    try {
        dbConn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: databaseName,
            port: 3306,
            multipleStatements: true
        });
        
        // ตรวจสอบโครงสร้าง
        const structureResult = await checkDeleteStructure(studentSQL, teacherSQL);
        
        // ตรวจสอบผลลัพธ์
        const deleteResult = await checkDeleteResults(studentSQL, teacherSQL, dbConn, testTable);
        
        res.status(200).json({
            structure: structureResult,
            result: deleteResult
        });
        
    } catch (error) {
        console.error('Error checking DELETE:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbConn) {
            await dbConn.end();
        }
    }
});

// API สำหรับทดสอบการตรวจสอบคำสั่ง INSERT
router.post('/check-insert', JWTdecode, requireRole(3), async (req, res) => {
    const { studentSQL, teacherSQL, databaseName, testTable } = req.body;
    
    if (!studentSQL || !teacherSQL || !databaseName || !testTable) {
        return res.status(400).json({ error: 'ต้องระบุ studentSQL, teacherSQL, databaseName และ testTable' });
    }
    
    let dbConn;
    try {
        dbConn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: databaseName,
            port: 3306,
            multipleStatements: true
        });
        
        // ตรวจสอบโครงสร้าง
        const structureResult = await checkInsertStructure(studentSQL, teacherSQL);
        
        // ตรวจสอบผลลัพธ์
        const insertResult = await checkInsertResults(studentSQL, teacherSQL, dbConn, testTable);
        
        res.status(200).json({
            structure: structureResult,
            result: insertResult
        });
        
    } catch (error) {
        console.error('Error checking INSERT:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbConn) {
            await dbConn.end();
        }
    }
});

// API สำหรับทดสอบการตรวจสอบคำสั่ง UPDATE
router.post('/check-update', JWTdecode, requireRole(3), async (req, res) => {
    const { studentSQL, teacherSQL, databaseName, testTable } = req.body;
    
    if (!studentSQL || !teacherSQL || !databaseName || !testTable) {
        return res.status(400).json({ error: 'ต้องระบุ studentSQL, teacherSQL, databaseName และ testTable' });
    }
    
    let dbConn;
    try {
        dbConn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: databaseName,
            port: 3306,
            multipleStatements: true
        });
        
        // ตรวจสอบโครงสร้าง
        const structureResult = await checkUpdateStructure(studentSQL, teacherSQL);
        
        // ตรวจสอบผลลัพธ์
        const updateResult = await checkUpdateResults(studentSQL, teacherSQL, dbConn, testTable);
        
        res.status(200).json({
            structure: structureResult,
            result: updateResult
        });
        
    } catch (error) {
        console.error('Error checking UPDATE:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbConn) {
            await dbConn.end();
        }
    }
});

// API สำหรับทดสอบการตรวจสอบคำสั่ง SQL แบบสมบูรณ์ (เหมือนใน worker.js)
router.post('/check-complete', JWTdecode, requireRole(3), async (req, res) => {
    const {
        studentSQL,
        teacherSQL,
        databaseName,
        testTable,
        questionScore = 10,
        keywords = ""
    } = req.body;
    
    if (!studentSQL || !teacherSQL || !databaseName) {
        return res.status(400).json({ error: 'ต้องระบุ studentSQL, teacherSQL และ databaseName' });
    }
    
    // ลบคอมเมนต์ออกก่อนแยกชื่อตาราง
    const cleanStudentSQL = studentSQL.replace(/(--[^\n]*\n?)/g, '').trim();
    const cleanTeacherSQL = teacherSQL.replace(/(--[^\n]*\n?)/g, '').trim();
    
    // ถ้าไม่ได้ระบุ testTable ให้แยกชื่อตารางจาก teacherSQL โดยอัตโนมัติ
    let autoTestTable = testTable;
    if (!autoTestTable) {
        autoTestTable = extractTableNameFromSQL(cleanTeacherSQL);
        if (!autoTestTable) {
            return res.status(400).json({ error: 'ไม่สามารถแยกชื่อตารางจาก SQL ของอาจารย์ได้ กรุณาระบุ testTable ด้วยตนเอง' });
        }
    }
    
    let dbConn;
    try {
        dbConn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: databaseName,
            port: 3306,
            multipleStatements: true
        });
        
        const sqlType = getSQLType(cleanStudentSQL);
        
        let syntaxScore = 0;
        let resultScore = 0;
        let compareError = false;
        let resultComparison = null;
        
        // คำนวณคะแนนย่อยตามสัดส่วน
        const qkeywordScore = questionScore * 0.33;  // 33% สำหรับ keyword
        const qsyntaxScore = questionScore * 0.33;   // 33% สำหรับ syntax
        const qresultScore = questionScore * 0.34;   // 34% สำหรับ result
        
        if (sqlType === 'unknown' || sqlType === 'unsupported') {
            // กรณีไม่รู้จักประเภท SQL หรือไม่รองรับ
            compareError = true;
            syntaxScore = 0;
            resultScore = 0;
        } else if (sqlType === 'delete') {
            // ตรวจสอบคำสั่ง DELETE
            try {
                // ตรวจสอบโครงสร้าง
                const structureResult = await checkDeleteStructure(cleanStudentSQL, teacherSQL);
                syntaxScore = (structureResult.score / 100) * qsyntaxScore;
                
                // ตรวจสอบผลลัพธ์
                const deleteResult = await checkDeleteResults(cleanStudentSQL, teacherSQL, dbConn, autoTestTable);
                resultScore = deleteResult.score * qresultScore;
                
                if (deleteResult.error) {
                    compareError = true;
                }
            } catch (err) {
                syntaxScore = 0;
                resultScore = 0;
                compareError = true;
            }
        } else if (sqlType === 'insert') {
            // ตรวจสอบคำสั่ง INSERT
            try {
                // ตรวจสอบโครงสร้าง
                const structureResult = await checkInsertStructure(cleanStudentSQL, teacherSQL);
                syntaxScore = (structureResult.score / 100) * qsyntaxScore;
                
                // ตรวจสอบผลลัพธ์
                const insertResult = await checkInsertResults(cleanStudentSQL, teacherSQL, dbConn, autoTestTable);
                resultScore = insertResult.score * qresultScore;
                
                if (insertResult.error) {
                    compareError = true;
                }
            } catch (err) {
                syntaxScore = 0;
                resultScore = 0;
                compareError = true;
            }
        } else if (sqlType === 'update') {
            // ตรวจสอบคำสั่ง UPDATE
            try {
                // ตรวจสอบโครงสร้าง
                const structureResult = await checkUpdateStructure(cleanStudentSQL, teacherSQL);
                syntaxScore = (structureResult.score / 100) * qsyntaxScore;
                
                // ตรวจสอบผลลัพธ์
                const updateResult = await checkUpdateResults(cleanStudentSQL, teacherSQL, dbConn, autoTestTable);
                resultScore = updateResult.score * qresultScore;
                
                if (updateResult.error) {
                    compareError = true;
                }
            } catch (err) {
                syntaxScore = 0;
                resultScore = 0;
                compareError = true;
            }
        } else {
            // ตรวจสอบคำสั่ง SELECT แบบเดิม
            // ตรวจผลลัพธ์ SQL ทั้งสองฝั่ง
            let studentResult = [];
            let teacherResult = [];
            try {
                [studentResult] = await dbConn.query(studentSQL);
            } catch (e) {
                console.error('Student SQL execution error:', e.message);
                compareError = true;
            }
            try {
                [teacherResult] = await dbConn.query(teacherSQL);
            } catch (e) {
                console.error('Teacher SQL execution error:', e.message);
                compareError = true;
            }
            
            if (!compareError) {
                // เปรียบเทียบผลลัพธ์
                resultComparison = percentageCompareResults(studentResult, teacherResult);
                const resultMatch = resultComparison.score;
                
                try {
                    const structureResult = await checkSQLStructure(cleanStudentSQL, cleanTeacherSQL);
                    syntaxScore = (structureResult.score / 100) * qsyntaxScore;
                    resultScore = resultMatch * qresultScore;
                } catch (err) {
                    syntaxScore = 0;
                    resultScore = 0;
                    compareError = true;
                }
            }
        }
        
        // ตรวจสอบ keyword
        const keywordList = String(keywords || "")
            .split(",")
            .map(k => k.trim())
            .filter(Boolean);
        
        const keywordScoreFull = qkeywordScore;
        let keywordScore = 0;
        
        if (keywordList.length > 0 && keywordScoreFull > 0) {
            let found = 0;
            keywordList.forEach(k => {
                // ตรวจสอบ keyword ทั้งแบบ case-sensitive และ case-insensitive
                if (studentSQL.includes(k) || studentSQL.toLowerCase().includes(k.toLowerCase())) {
                    found++;
                }
            });
            keywordScore = (found / keywordList.length) * keywordScoreFull;
        } else {
            // ถ้าไม่มี keyword ให้คะแนนเต็มในส่วนของ keyword
            keywordScore = keywordScoreFull;
        }
        
        // ป้องกัน NaN
        if (isNaN(syntaxScore)) syntaxScore = 0;
        if (isNaN(resultScore)) resultScore = 0;
        if (isNaN(keywordScore)) keywordScore = 0;
        
        const originalTotalScore = syntaxScore + resultScore + keywordScore;
        const finalTotalScore = Math.round(originalTotalScore * 100) / 100;
        
        // สร้างข้อความแสดงข้อผิดพลาดสำหรับ SQL type ที่ไม่รู้จักหรือไม่รองรับ
        let errorMessage = null;
        if (sqlType === 'unknown') {
            errorMessage = 'ไม่สามารถระบุประเภทของคำสั่ง SQL ได้ กรุณาตรวจสอบคำสั่ง SQL ให้ถูกต้อง';
        } else if (sqlType === 'unsupported') {
            errorMessage = 'คำสั่ง SQL นี้ไม่ได้รับการรองรับในระบบตรวจสอบ (รองรับเฉพาะ SELECT, INSERT, UPDATE, DELETE)';
        }

        res.status(200).json({
            sqlType,
            keywordScore,
            syntaxScore,
            resultScore,
            originalTotalScore,
            finalTotalScore,
            compareError,
            resultComparison,
            keywordList,
            detectedTable: autoTestTable, // ส่งชื่อตารางที่ตรวจพบกลับไปด้วย
            errorMessage, // เพิ่มข้อความแสดงข้อผิดพลาด
            scoreBreakdown: {
                keyword: `${keywordScore}/${keywordScoreFull}`,
                syntax: `${syntaxScore}/${qsyntaxScore}`,
                result: `${resultScore}/${qresultScore}`
            }
        });
        
    } catch (error) {
        console.error('Error in complete SQL check:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbConn) {
            await dbConn.end();
        }
    }
});

// API สำหรับดึงรายการฐานข้อมูลที่มีอยู่
router.get('/databases', JWTdecode, requireRole(3), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM database_list WHERE is_active = 1');
        res.status(200).json({ databases: rows });
    } catch (error) {
        console.error('Error fetching databases:', error);
        res.status(500).json({ error: error.message });
    }
});

// API สำหรับดึงตารางในฐานข้อมูล
router.get('/tables/:databaseName', JWTdecode, requireRole(3), async (req, res) => {
    const { databaseName } = req.params;
    
    let dbConn;
    try {
        dbConn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: databaseName,
            port: 3306
        });
        
        const [rows] = await dbConn.query('SHOW TABLES');
        const tables = rows.map(row => Object.values(row)[0]);
        
        res.status(200).json({ tables });
    } catch (error) {
        console.error('Error fetching tables:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbConn) {
            await dbConn.end();
        }
    }
});

export default router;