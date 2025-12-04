// routes/units.js
import express from "express";
import pool from "../config/db.js";
import JWTdecode from "../middleware/jwtdecode.js";
import {requireRole} from "../middleware/checkRole.js";
const router = express.Router();
router.use(express.json());

router.get("/", JWTdecode, requireRole(3), async (req, res) => {
  const ownerId = req.user.user_id;
  const perm_level = req.user.perm_level;
  try {
    let sql;
    let params;

    if (perm_level === 10) {
      sql = `
        SELECT
          u.unit_id,
          u.unit_name,
          u.unit_detail,
          COUNT(p.purpose_id) AS purpose_count,
          CONCAT(m.prefix, ' ', m.first_name, ' ', m.last_name) AS creator_name
        FROM unit u
        LEFT JOIN purpose p ON p.unit_id = u.unit_id
        LEFT JOIN member m ON m.user_id = u.created_by
        GROUP BY u.unit_id, u.unit_name, u.unit_detail, creator_name
        ORDER BY u.unit_name ASC;
      `;
      params = [];
    } else {
      sql = `
        SELECT
          u.unit_id,
          u.unit_name,
          u.unit_detail,
          COUNT(p.purpose_id) AS purpose_count
        FROM unit u
        LEFT JOIN purpose p ON p.unit_id = u.unit_id
        WHERE u.created_by = ?
        GROUP BY u.unit_id, u.unit_name, u.unit_detail
        ORDER BY u.unit_name ASC;
      `;
      params = [ownerId];
    }

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("Fetch units failed:", err);
    res.status(500).json({ error: "server error" });
  }
});


router.post("/", JWTdecode, requireRole(3), async (req, res) => {
  try {
    const { name, description } = req.body;
    const ownerId = req.user.user_id;

    if (!name) return res.status(400).json({ message: "กรุณากรอกชื่อหน่วยการเรียน" });

    const checkSql = `SELECT unit_id FROM unit WHERE unit_name = ? AND created_by = ?`;
    const [existing] = await pool.query(checkSql, [name.trim(), ownerId]);

    if (existing.length > 0) {
      return res.status(400).json({ message: "ชื่อหน่วยการเรียนนี้มีอยู่แล้ว" });
    }

    const sql = `INSERT INTO unit (unit_name, unit_detail, created_by) VALUES (?, ?, ?)`;
    const [result] = await pool.query(sql, [name.trim(), description || null, ownerId]);
    
    res
      .status(201)
      .location(`/units/${result.insertId}`)
      .json({
        unit_id: result.insertId,
        unit_name: name.trim(),
        unit_detail: description || null,
        created_by: ownerId,
      });
  } catch (err) {
    console.error("Insert unit failed:", err);
    res.status(500).json({ message: "server error" });
  }
});


router.put("/:unitId", JWTdecode, requireRole(3), async (req, res) => {
  const { unitId } = req.params;
  const { name, description } = req.body;
  
  const userId = req.user.user_id; 
  const permLevel = req.user.perm_level;

  try {
  
    const [targetUnit] = await pool.query("SELECT created_by FROM unit WHERE unit_id = ?", [unitId]);
    if (targetUnit.length === 0) return res.status(404).json({ message: "ไม่พบหน่วยการเรียน" });
    
    const ownerOfUnit = targetUnit[0].created_by;

    if (permLevel !== 10 && userId !== ownerOfUnit) {
        return res.status(403).json({ message: "ไม่มีสิทธิ์แก้ไขข้อมูลนี้" });
    }

    const checkSql = `SELECT unit_id FROM unit WHERE unit_name = ? AND created_by = ? AND unit_id != ?`;
    const [existing] = await pool.query(checkSql, [name.trim(), ownerOfUnit, unitId]);

    if (existing.length > 0) {
      return res.status(400).json({ message: "ชื่อหน่วยการเรียนนี้มีอยู่แล้ว" });
    }

    const sql = `UPDATE unit SET unit_name = ?, unit_detail = ? WHERE unit_id = ?`;
    await pool.query(sql, [name.trim(), description || null, unitId]);
    
    res.json({ message: "แก้ไขหน่วยการเรียนสำเร็จ" });

  } catch (err) {
    console.error("Update unit failed:", err);
    res.status(500).json({ message: "server error" });
  }
});

router.delete("/:unitid", JWTdecode, requireRole(3), async (req, res) => {
  const { unitid } = req.params;
  const userId = req.user.user_id;
  const permLevel = req.user.perm_level;

  try {
    let sql;
    let params;

    if (permLevel === 10) {
        sql = 'DELETE FROM unit WHERE unit_id = ?';
        params = [unitid];
    } else {
        sql = 'DELETE FROM unit WHERE unit_id = ? AND created_by = ?';
        params = [unitid, userId];
    }

    const [result] = await pool.query(sql, params); 

    if (result.affectedRows === 0) { 
        if (permLevel !== 10) {
             const [check] = await pool.query("SELECT unit_id FROM unit WHERE unit_id = ?", [unitid]);
             if (check.length > 0) return res.status(403).json({ error: "ไม่มีสิทธิ์ลบหน่วยการเรียนนี้" });
        }
        return res.status(404).json({ error: "ไม่พบหน่วยการเรียน" }); 
    }

    res.status(200).json({ message: "ลบหน่วยการเรียนสำเร็จ" });
  } 
  catch(err)
  {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.status(400).json({ error: "ไม่สามารถลบได้ เนื่องจากมีข้อมูลจุดประสงค์หรือคำถามที่ใช้งานหน่วยการเรียนนี้อยู่" });
    }
    console.error("เกิดข้อผิดพลาดในการลบหน่วยการเรียน", err);
    res.status(500).json({ error: "server error" });
  }
});

export default router;
