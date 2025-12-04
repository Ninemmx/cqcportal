import mysql from 'mysql2/promise'
import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import JWTdecode from '../middleware/jwtdecode.js';
import { requireRole } from '../middleware/checkRole.js';
dotenv.config();

const router = express.Router();

const dbPools = new Map();

const adminPool = mysql.createPool({
    host: 'localhost',
    user: 'cpeqcs',
    password: '!cpe66231',
    database: 'cpeqcs2',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function cloneDatabaseStructureAndData(connection, sourceDb, targetDb) {
    const [tables] = await connection.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = ?`,
        [sourceDb]
    );

    for (const row of tables) {
        const tableName = row.table_name || row.TABLE_NAME;

        if (!tableName) {
            console.warn('Skipping table with undefined table_name:', row);
            continue;
        }

        await connection.query(
            `CREATE TABLE \`${targetDb}\`.\`${tableName}\` LIKE \`${sourceDb}\`.\`${tableName}\``
        );

        await connection.query(
            `INSERT INTO \`${targetDb}\`.\`${tableName}\` SELECT * FROM \`${sourceDb}\`.\`${tableName}\``
        );
    }

}

function getOrCreateDBPool(dbName) {
    if (!dbPools.has(dbName)) {
        try {
            const pool = mysql.createPool({
                host: 'localhost',
                user: 'cpeqcs',
                password: '!cpe66231',
                database: dbName,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            });
            dbPools.set(dbName, pool);
        } catch (error) {
            console.error(`Error creating DB pool for ${dbName}:`, error);
            throw error;
        }
    }
    return dbPools.get(dbName);
}

//ดึง DB ของ นศ.
router.get('/', JWTdecode, requireRole(1), async (req, res) => {
    const user_id = req.query.user_id;
    if (!user_id) {
        return res.status(400).json({ error: 'user_id is required' });
    }

    try {
        const connection = await adminPool.getConnection();
        const [rows] = await connection.query(
            `SELECT 
                s.SCHEMA_NAME AS fullName,
                SUBSTRING_INDEX(s.SCHEMA_NAME, '_', -1) AS dbName
            FROM 
                information_schema.schemata s
            JOIN 
                cpeqcs2.database_list d 
                ON SUBSTRING_INDEX(s.SCHEMA_NAME, '_', -1) = d.database_name
            WHERE 
                s.SCHEMA_NAME REGEXP ?
                AND d.is_active = 1`,
            [`^db_${user_id}_[^_]+$`]
        );

        console.log('Fetched student DBs:', rows);
        connection.release();

        const cleanedRows = rows.map(row => ({
            dbName: row.dbName,    
            fullName: row.fullName, 
        }));

        res.status(200).json({ data: cleanedRows });
    } catch (error) {
        console.error('Error fetching student DBs:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/rows', JWTdecode, requireRole(1), async (req, res) => {
    const { tbl, dbName, user_id, limit = 100 } = req.query;

    if (!tbl || !dbName) {
        return res.status(400).json({ error: 'tbl and dbName are required' });
    }

    const studbName = `db_${user_id}_${dbName}`;

    const pool = getOrCreateDBPool(studbName);

    try {
        const [rows] = await pool.query(
            `SELECT * FROM \`${tbl}\` LIMIT ?`,
            [parseInt(limit)]
        );
        res.status(200).json({ data: rows });
    } catch (error) {
        console.error('SQL Error:', error);
        res.status(500).json({ error: error.message });
    }
});

//Clone DB
router.post('/', JWTdecode, requireRole(3), async (req, res) => {
    const { studentId } = req.body;

    if (!studentId) {
        return res.status(400).json({ error: 'studentId is required' });
    }

    const connection = await adminPool.getConnection();

    try {
        const [rows] = await connection.query(
            `SELECT database_name FROM database_list WHERE is_active = 1`
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'No active teacher database found' });
        }

        console.log(rows);
        console.log(studentId);

        const createdDbNames = [];

        for (const row of rows) {
            const teacherDb = row.database_name;
            const dbName = `db_${studentId}_${teacherDb}`;

            const [dbs] = await connection.query(
                `SELECT SCHEMA_NAME FROM information_schema.schemata WHERE SCHEMA_NAME = ?`,
                [dbName]
            );

            if (dbs.length === 0) {
                try {
                    await connection.query(`CREATE DATABASE \`${dbName}\``);
                    console.log(`Cloning from ${teacherDb} to ${dbName}`);
                    await cloneDatabaseStructureAndData(connection, teacherDb, dbName);
                    createdDbNames.push(dbName);
                } catch (error) {
                    console.error(`Error cloning ${teacherDb} to ${dbName}:`, error);
                }
            } else {
                console.log(`Database ${dbName} already exists, skipping creation and cloning.`);
            }
        }

        if (createdDbNames.length === 0) {
            return res.status(500).json({ error: 'Failed to create any sandbox database ' });
        }

        res.status(200).json({ dbNames: createdDbNames });
    } catch (error) {
        console.error('Error creating or cloning DB:', error);
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});


router.get('/tables', JWTdecode, requireRole(1), async (req, res) => {
    const dbName = req.query.dbName;
    if (!dbName) {
        return res.status(400).json({ error: 'dbName is required' });
    }

    const pool = getOrCreateDBPool(dbName);

    try {
        const [rows] = await pool.query('SHOW TABLES');
        res.status(200).json({ data: rows });
    } catch (error) {
        console.error('SQL Error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/execute', JWTdecode, requireRole(1), async (req, res) => {
    const { sqlQuery, dbName, user_id } = req.body;
    const studbName = `db_${user_id}_${dbName}`;
    console.log('Received SQL Query:', sqlQuery);
    console.log('DB Name: ', studbName);

    if (!dbName) {
        return res.status(400).json({ error: 'DB Name is required' });
    }

    if (!sqlQuery) {
        return res.status(400).json({ error: 'SQL query is required' });
    }

    // ลบคอมเมนต์ออกก่อนตรวจสอบ prefix
    const sqlWithoutComments = sqlQuery.replace(/(--[^\n]*\n?)/g, '').trim();
    const sqlLower = sqlWithoutComments.toLowerCase();
    const allowedPrefixes = ['select', 'show tables', 'insert', 'delete'];
    const isAllowed = allowedPrefixes.some(prefix => sqlLower.startsWith(prefix));

    if (!isAllowed) {
        return res.status(403).json({ error: 'Only SELECT, SHOW TABLES, INSERT, and DELETE queries are allowed' });
    }

    
    const pool = getOrCreateDBPool(studbName);

    try {
        // ใช้ SQL ที่มีคอมเมนต์อยู่ในการ execute แต่ตรวจสอบความปลอดภัยจาก SQL ที่ไม่มีคอมเมนต์
        const [rows] = await pool.query(sqlQuery);
        res.status(200).json({ data: rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/feedback', async (req, res) => {
    const { refSQL, userSQL } = req.body;
    console.log('Request body:', req.body);
    console.log('Authorization header:', `Bearer ${process.env.GROQ_API_KEY}`);
    if (!refSQL || !userSQL) {
        return res.status(400).json({ error: 'ต้องใส่ refSQL, userSQL' });
    }

    const prompt = `
        คุณคือนักวิเคราะห์ SQL และครูผู้ให้คำแนะนำแบบเข้าใจง่าย ใช้ภาษาไทย
        โจทย์:
        SQL ที่นักเรียนส่งมา:
        ${userSQL}

        SQL ที่ถูกต้องควรเป็น:
        ${refSQL}

        วิเคราะห์ว่านักเรียนผิดตรงไหน และควรเข้าใจอย่างไรเพื่อแก้ไขให้ถูกต้อง โดยให้คำแนะนำที่ชัดเจน เข้าใจง่ายและสั้นๆกระชับ
    `;

    try {
        const groqRes = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama3-8b-8192',
                messages: [
                    { role: 'system', content: 'คุณคือผู้ช่วยสอน SQL ใช้ภาษาไทยอธิบายเข้าใจง่ายสั้นๆและกระชับ' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.5
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const feedback = groqRes.data.choices[0].message.content;
        res.status(200).json({ feedback });
    } catch (error) {
        console.error('Groq API Error:', error?.response?.data || error.message);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดจากฝั่ง AI' });
    }
});

export default router;