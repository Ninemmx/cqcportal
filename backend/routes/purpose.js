import express from "express";
import pool from "../config/db.js";
import dotenv from "dotenv";
import JWTdecode from "../middleware/jwtdecode.js";
import {requireRole} from "../middleware/checkRole.js";
dotenv.config();

const router = express.Router();
router.use(express.json());

router.post("/", JWTdecode, requireRole(3), async (req, res) => {
    try {
        const { unit_id, purpose_name } = req.body;
        const userId = req.user.user_id;
        const permLevel = req.user.perm_level;
        
        if (!unit_id || !purpose_name) {
            return res.status(400).json({ error: "กรอกข้อมูลไม่ครบ" });
        }

        const [unitCheck] = await pool.query(
            "SELECT created_by FROM unit WHERE unit_id = ?",
            [unit_id]
        );
        
        if (unitCheck.length === 0) {
            return res.status(404).json({ error: "ไม่พบหน่วยการเรียน" });
        }
        
        const ownerOfUnit = unitCheck[0].created_by;

        if (permLevel !== 10 && userId !== ownerOfUnit) {
            return res.status(403).json({ error: "ไม่มีสิทธิ์เพิ่มวัตถุประสงค์ในหน่วยการเรียนนี้" });
        }

        const cleanName = purpose_name.trim();
        const checkSql = `SELECT purpose_id FROM purpose WHERE purpose_name = ? AND unit_id = ?`;
        const [existing] = await pool.query(checkSql, [cleanName, unit_id]);

        if (existing.length > 0) {
            return res.status(400).json({ error: "ชื่อวัตถุประสงค์นี้มีอยู่แล้วในหน่วยการเรียนนี้" });
        }

        const sql = `INSERT INTO purpose (purpose_name, unit_id ) VALUES (?, ?)`;
        const [result] = await pool.query(sql, [cleanName, unit_id]);

        res.status(201).json({
            purpose_id: result.insertId,
            unit_id,
            purpose_name: cleanName,
        });
    } catch (err) {
        console.error("Insert purpose failed:", err);
        res.status(500).json({ error: "Server error" });
    }
});

router.get("/", JWTdecode, requireRole(3), async (req, res) => {
    const ownerId = req.user.user_id;
    const perm_level = req.user.perm_level;
    
    try {
        const { unit_id } = req.query;
        let sql;
        let params;

        if (perm_level === 10) {
            sql = `
                SELECT
                    p.purpose_id,
                    p.purpose_name,
                    p.unit_id,
                    u.unit_name,
                    CONCAT(m.prefix, ' ', m.first_name, ' ', m.last_name) AS creator_name
                FROM purpose p
                LEFT JOIN unit u ON u.unit_id = p.unit_id
                LEFT JOIN member m ON m.user_id = u.created_by
            `;
            params = [];
        } else {
            sql = `
                SELECT
                    p.purpose_id,
                    p.purpose_name,
                    p.unit_id,
                    u.unit_name
                FROM purpose p
                LEFT JOIN unit u ON u.unit_id = p.unit_id
                WHERE u.created_by = ?
            `;
            params = [ownerId];
        }

        if (unit_id) {
            if (perm_level === 10) {
                sql += ` WHERE p.unit_id = ?`;
            } else {
                sql += ` AND p.unit_id = ?`;
            }
            params.push(unit_id);
        }

        const [rows] = await pool.query(sql, params);
        res.status(200).json(rows);
    } catch (err) {
        console.error("Fetch purposes failed:", err);
        res.status(500).json({ error: "Server error" });
    }
});
router.get('/unit/:unitId/purposes', JWTdecode, requireRole(3), async (req, res) => {
    const unitId = req.params.unitId;
    const userId = req.user.user_id;
    const permLevel = req.user.perm_level;

    try {
        if (permLevel !== 10) {
            const [unitCheck] = await pool.query(
                "SELECT created_by FROM unit WHERE unit_id = ?",
                [unitId]
            );
            
            if (unitCheck.length === 0) {
                return res.status(404).json({ message: "ไม่พบหน่วยการเรียน" });
            }
            
            if (unitCheck[0].created_by !== userId) {
                return res.status(403).json({ message: "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้" });
            }
        }

        const [rows] = await pool.query(
            `SELECT *
             FROM purpose
             WHERE unit_id = ?`,
            [unitId]
        );

        res.json(rows);
    } catch (err) {
        console.error('ดึงวัตถุประสงค์ตามหน่วยการเรียนผิดพลาด:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
    }
});

router.put("/:purposeId", JWTdecode, requireRole(3), async (req, res) => {
    try {
        const { purposeId } = req.params;
        const { purpose_name, unit_id } = req.body;
        const userId = req.user.user_id;
        const permLevel = req.user.perm_level;

        if (!purpose_name || !unit_id) {
            return res.status(400).json({ error: "ข้อมูลไม่ครบถ้วน" });
        }

        const [unitCheck] = await pool.query(
            "SELECT u.created_by FROM unit u JOIN purpose p ON p.unit_id = u.unit_id WHERE p.purpose_id = ?",
            [purposeId]
        );
        
        if (unitCheck.length === 0) {
            return res.status(404).json({ error: "ไม่พบวัตถุประสงค์" });
        }
        
        const ownerOfUnit = unitCheck[0].created_by;

        if (permLevel !== 10 && userId !== ownerOfUnit) {
            return res.status(403).json({ error: "ไม่มีสิทธิ์แก้ไขวัตถุประสงค์นี้" });
        }

        const cleanName = purpose_name.trim();

        const checkSql = `SELECT purpose_id FROM purpose WHERE purpose_name = ? AND unit_id = ? AND purpose_id != ?`;
        const [existing] = await pool.query(checkSql, [cleanName, unit_id, purposeId]);

        if (existing.length > 0) {
            return res.status(400).json({ error: "ชื่อวัตถุประสงค์นี้มีอยู่แล้วในหน่วยการเรียนนี้" });
        }
        if (permLevel !== 10) {
        const [targetUnitCheck] = await pool.query(
            "SELECT created_by FROM unit WHERE unit_id = ?",
            [unit_id] 
        );
        
        if (targetUnitCheck.length === 0 || targetUnitCheck[0].created_by !== userId) {
            return res.status(403).json({ error: "คุณไม่มีสิทธิ์ย้ายวัตถุประสงค์ไปหน่วยการเรียนนี้" });
        }
    }

        const sql = `UPDATE purpose SET purpose_name = ?, unit_id = ? WHERE purpose_id = ?`;
        const [result] = await pool.query(sql, [cleanName, unit_id, purposeId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "ไม่พบวัตถุประสงค์" });
        }

        res.status(200).json({ message: "แก้ไขวัตถุประสงค์สำเร็จ" });
    } catch (err) {
        console.error("Update purpose failed:", err);
        res.status(500).json({ error: "Server error" });
    }
});

router.delete("/:purposeId", JWTdecode, requireRole(3), async (req, res) => {
    try {
        const { purposeId } = req.params;
        const userId = req.user.user_id;
        const permLevel = req.user.perm_level;

        const [purposeCheck] = await pool.query(
            "SELECT u.created_by FROM unit u JOIN purpose p ON p.unit_id = u.unit_id WHERE p.purpose_id = ?",
            [purposeId]
        );
        
        if (purposeCheck.length === 0) {
            return res.status(404).json({ error: "ไม่พบวัตถุประสงค์" });
        }
        
        const ownerOfUnit = purposeCheck[0].created_by;

        let sql;
        let params;

        if (permLevel === 10) {
            sql = 'DELETE FROM purpose WHERE purpose_id = ?';
            params = [purposeId];
        } else {
            sql = 'DELETE FROM purpose WHERE purpose_id = ? AND unit_id IN (SELECT unit_id FROM unit WHERE created_by = ?)';
            params = [purposeId, userId];
        }

        const [result] = await pool.query(sql, params);

        if (result.affectedRows === 0) {
            if (permLevel !== 10) {
                return res.status(403).json({ error: "ไม่มีสิทธิ์ลบวัตถุประสงค์นี้" });
            }
            return res.status(404).json({ error: "ไม่พบวัตถุประสงค์" });
        }

        res.status(200).json({ message: "ลบวัตถุประสงค์สำเร็จ" });
    } catch (err) {
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ error: "ไม่สามารถลบได้ เนื่องจากมีข้อมูลคำถามที่ใช้งานวัตถุประสงค์นี้อยู่" });
        }
        console.error("Delete purpose failed:", err);
        res.status(500).json({ error: "Server error" });
    }
});

export default router;
