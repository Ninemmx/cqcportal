import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import mysql from '../config/db.js';
import JWTdecode from '../middleware/jwtdecode.js';
import {requireRole} from '../middleware/checkRole.js';
import { create } from 'domain';
import 'dotenv/config';

const router = express.Router();


// ตั้งค่าที่เก็บไฟล์
const upload = multer({ dest: 'uploads/' });

const MAIN_DB = process.env.DB_NAME || 'cpeqcs2';

// GET ดึงฐานข้อมูลทั้งหมด
router.get('/all', JWTdecode,requireRole(1),async (req, res) => {
  try {
    const [rows] = await mysql.query(`SELECT * FROM ${MAIN_DB}.database_list ORDER BY created_at ASC`);
    res.json(rows);
  } catch (err) {
    console.error('โหลดฐานข้อมูลล้มเหลว:', err);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการโหลดฐานข้อมูล' });
  }
});

router.post('/create', JWTdecode, upload.single('file'), async (req, res) => {
    const { name, is_active } = req.body;
    const created_by = req.user.user_id;
    const sqlFile = req.file;

    const cleanupFile = () => {
        if (sqlFile && fs.existsSync(sqlFile.path)) {
            fs.unlinkSync(sqlFile.path);
        }
    };

    if (!name || !sqlFile) {
        cleanupFile();
        return res.status(400).json({ message: 'ต้องกรอกชื่อฐานข้อมูลและอัปโหลดไฟล์' });
    }

    const dbNameRegex = /^[a-zA-Z0-9_]+$/;
    if (!dbNameRegex.test(name)) {
        cleanupFile();
        return res.status(400).json({ message: 'ชื่อฐานข้อมูลต้องเป็นภาษาอังกฤษ ตัวเลข หรือขีดล่าง (_) เท่านั้น ห้ามเว้นวรรค' });
    }

    const protectedNames = ['mysql', 'information_schema', 'performance_schema', 'sys', `${MAIN_DB}`, 'test'];
    if (protectedNames.includes(name.toLowerCase())) {
        cleanupFile();
        return res.status(400).json({ message: 'ชื่อนี้สงวนไว้สำหรับระบบ ไม่สามารถใช้งานได้' });
    }

    try {
        const conn = await mysql.getConnection();

        const [existing] = await conn.query(`SELECT database_id FROM ${MAIN_DB}.database_list WHERE database_name = ?`, [name]);
        if (existing.length > 0) {
            conn.release();
            cleanupFile();
            return res.status(400).json({ message: 'ชื่อฐานข้อมูลนี้มีอยู่แล้วในระบบ' });
        }

        const sqlPath = path.resolve(sqlFile.path);
        const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

        try {
            await conn.query(`CREATE DATABASE IF NOT EXISTS \`${name}\``);
        } catch (dbErr) {
            conn.release();
            cleanupFile();
            if (dbErr.code === 'ER_DB_CREATE_EXISTS') {
                return res.status(400).json({ message: 'ชื่อฐานข้อมูลนี้มีอยู่แล้วใน MySQL Server (Physical DB Exist)' });
            }
            throw dbErr;
        }

        try {
            await conn.query(
                `INSERT INTO ${MAIN_DB}.database_list (database_name, is_active, created_at, created_by) VALUES (?, ?, NOW(), ?)`,
                [name, is_active === 'true' || is_active === true, created_by]
            );
        } catch (insertErr) {
            await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
            conn.release();
            cleanupFile();

            if (insertErr.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ message: 'ชื่อฐานข้อมูลนี้มีอยู่แล้วในระบบ' });
            }
            throw insertErr;
        }

        try {
            await conn.query(`USE \`${name}\``);
            await conn.query(sqlContent);
        } catch (sqlErr) {
            await conn.query(`USE ${MAIN_DB}`); 
            await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
            await conn.query(`DELETE FROM ${MAIN_DB}.database_list WHERE database_name = ?`, [name]);
            
            conn.release();
            cleanupFile();
            console.error('Error executing SQL file:', sqlErr);
            return res.status(400).json({ message: 'รูปแบบไฟล์ SQL ไม่ถูกต้อง หรือมีข้อผิดพลาดในการรันคำสั่ง' });
        }

        await conn.query(`USE ${MAIN_DB}`); 
        conn.release();
        cleanupFile();

        res.status(201).json({ message: 'สร้างฐานข้อมูลสำเร็จ' });

    } catch (err) {
        cleanupFile();
        console.error('สร้างฐานข้อมูลล้มเหลว (Global Catch):', err);
        
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'ชื่อฐานข้อมูลนี้มีอยู่แล้วในระบบ' });
        }
        
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการสร้างฐานข้อมูล', error: err.message });
    }
});



// DELETE: ลบฐานข้อมูล
router.delete('/:name', JWTdecode,requireRole(3),async (req, res) => {
  const dbName = req.params.name;

  try {
    await mysql.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await mysql.query('DELETE FROM database_list WHERE database_name = ?', [dbName]);
    res.json({ message: 'ลบฐานข้อมูลแล้ว' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ลบฐานข้อมูลล้มเหลว' });
  }
});

// PUT: เปลี่ยนสถานะเปิด/ปิดฐานข้อมูล
router.put('/:name/toggle', JWTdecode,requireRole(3),async (req, res) => {
  const dbName = req.params.name;
  const { is_active } = req.body;

  try {
    await mysql.query(`UPDATE ${MAIN_DB}.database_list SET is_active = ? WHERE database_name = ?`, [is_active, dbName]);
    res.json({ message: 'อัปเดตสถานะสำเร็จ' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'อัปเดตสถานะล้มเหลว' });
  }
});

// GET: ดึงข้อมูลทั้งหมดจากทุกตารางในฐานข้อมูลที่ระบุ
router.get('/:name/data', JWTdecode, requireRole(1), async (req, res) => {
  const dbName = req.params.name;

  try {
    const conn = await mysql.getConnection();

    // ตรวจสอบว่าฐานข้อมูลมีอยู่จริง
    const [exists] = await conn.query(`SHOW DATABASES LIKE ?`, [dbName]);
    if (exists.length === 0) {
      conn.release();
      return res.status(404).json({ message: `ไม่พบฐานข้อมูลชื่อ ${dbName}` });
    }

    // ดึงรายชื่อตารางทั้งหมดในฐานข้อมูลนั้น
    const [tables] = await conn.query(`SHOW TABLES FROM \`${dbName}\``);

    const result = {};

    // วนทุกตารางและดึงข้อมูลทั้งหมด
    for (const table of tables) {
      const tableName = Object.values(table)[0];
      try {
        const [rows] = await conn.query(`SELECT * FROM \`${dbName}\`.\`${tableName}\``);
        result[tableName] = rows;
      } catch (tableErr) {
        console.error(`อ่านข้อมูลจากตาราง ${tableName} ล้มเหลว:`, tableErr);
        result[tableName] = { error: 'ไม่สามารถอ่านข้อมูลจากตารางนี้ได้' };
      }
    }

    conn.release();

    res.json({
      database: dbName,
      tables: result,
    });
  } catch (err) {
    console.error('ดึงข้อมูลทุกตารางล้มเหลว:', err);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูลจากฐานข้อมูล' });
  }
});



export default router;
