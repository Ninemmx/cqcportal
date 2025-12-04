import express from 'express';
import pool from '../config/db.js';
import dotenv from 'dotenv';
import JWTdecode from '../middleware/jwtdecode.js';
import { requireRole } from '../middleware/checkRole.js';

dotenv.config();
const router = express.Router();
router.use(express.json());

router.get('/', JWTdecode, async (req, res) => {
  try {
    const sql = `
      SELECT
        s.set_id,
        s.set_title,
        s.description,
        s.created_at,
        s.created_by,
        COUNT(DISTINCT sq.question_id) AS question_count,
        COALESCE(SUM(q.question_score), 0) AS total_score,
        GROUP_CONCAT(DISTINCT dl.database_name ORDER BY dl.database_name SEPARATOR ', ') AS db_names
      FROM question_set s
      LEFT JOIN question_set_items sq ON s.set_id = sq.set_id
      LEFT JOIN question q                 ON q.question_id = sq.question_id
      LEFT JOIN database_list dl           ON q.database_id = dl.database_id
      GROUP BY s.set_id, s.set_title, s.description, s.created_at, s.created_by
      ORDER BY s.created_at DESC;
    `;
    const [rows] = await pool.query(sql);
    res.json(rows);
  } catch (error) {
    console.error('Error in GET /assignment-sets:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


router.post('/', JWTdecode, requireRole(3), async (req, res) => {
  const { set_title, description, questions = [] } = req.body;
  const created_by = req.user.user_id;

  if (!set_title || !created_by) {
    return res.status(400).json({ message: 'set_title และ created_by เป็นค่าบังคับ' });
  }

  const cleanTitle = set_title.trim();
  const cleanDesc = description ? description.trim() : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existingSets] = await conn.query(
      `SELECT set_id FROM question_set
       WHERE set_title = ? AND created_by = ?`,
      [cleanTitle, created_by]
    );
    
    if (existingSets.length > 0) {
      await conn.rollback();
      return res.status(400).json({ message: 'ชื่อชุดคำถามนี้มีอยู่แล้วสำหรับผู้ใช้คนนี้' });
    }

    const [result] = await conn.query(
      `INSERT INTO question_set (set_title, description, created_by)
       VALUES (?, ?, ?)`,
      [cleanTitle, cleanDesc, created_by]
    );
    const newSetId = result.insertId;

    if (Array.isArray(questions) && questions.length > 0) {
      const uniqueQuestions = [];
      const seenIds = new Set();
      
      for (const q of questions) {
        if (!seenIds.has(q.question_id)) {
          seenIds.add(q.question_id);
          uniqueQuestions.push(q);
        }
      }
      
      const values = uniqueQuestions.map((item, idx) => ([
        newSetId,
        item.question_id,
        item.sequence ?? (idx + 1),
      ]));

      await conn.query(
        `INSERT INTO question_set_items (set_id, question_id, sequence)
         VALUES ?`,
        [values]
      );
    }

    await conn.commit();
    res.status(201).json({ message: 'สร้างชุดสำเร็จ', set_id: newSetId });
  } catch (err) {
    await conn.rollback();
    console.error('Error in POST /assignment-sets:', err);

    if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ message: 'ชื่อชุดคำถามนี้มีอยู่แล้ว' });
    }

    res.status(500).json({ message: 'ไม่สามารถสร้างชุดได้' });
  } finally {
    conn.release();
  }
});



router.put("/:setId", JWTdecode, requireRole(3), async (req, res) => {
  const setId = Number(req.params.setId);
  const userId = req.user?.user_id;

  if (!Number.isInteger(setId)) {
    return res.status(400).json({ message: "setId ไม่ถูกต้อง" });
  }
  if (!userId) {
    return res.status(401).json({ message: "ยังไม่ยืนยันตัวตน" });
  }

  const { set_title, description, questions } = req.body ?? {};

  let cleaned = null;
  if (Array.isArray(questions)) {
    cleaned = questions
      .filter(q => q && q.question_id != null)
      .map((q, idx) => ({
        question_id: Number(q.question_id),
        sequence: Number(q.sequence ?? idx + 1),
      }));

    if (cleaned.some(q => !Number.isInteger(q.question_id) || !Number.isInteger(q.sequence))) {
      return res.status(400).json({ message: "question_id/sequence ต้องเป็นจำนวนเต็ม" });
    }
    const ids = cleaned.map(q => q.question_id);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup != null) {
      return res.status(400).json({ message: `มี question_id ซ้ำใน payload (${dup})` });
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[setRow]] = await conn.query(
      "SELECT set_id, created_by FROM question_set WHERE set_id = ? LIMIT 1",
      [setId]
    );
    if (!setRow) {
      await conn.rollback();
      return res.status(404).json({ message: "ไม่พบชุดข้อสอบ" });
    }
    
    if (set_title !== undefined || description !== undefined) {
      const sets = [];
      const params = [];

      if (set_title !== undefined) {
        const cleanTitle = String(set_title).trim();
        if (!cleanTitle) {
          await conn.rollback();
          return res.status(400).json({ message: "set_title ห้ามว่าง" });
        }
        
        // ตรวจสอบชื่อชุดคำถามซ้ำสำหรับผู้ใช้คนเดียวกัน (ยกเว้นชุดปัจจุบัน)
        const [existingSets] = await conn.query(
          `SELECT set_id FROM question_set
           WHERE set_title = ? AND created_by = ? AND set_id != ?`,
          [cleanTitle, userId, setId]
        );
        
        if (existingSets.length > 0) {
          await conn.rollback();
          return res.status(400).json({ message: 'ชื่อชุดคำถามนี้มีอยู่แล้วสำหรับผู้ใช้คนนี้' });
        }
        
        sets.push("set_title = ?");
        params.push(cleanTitle);
      }

      if (description !== undefined) {
        sets.push("description = ?");
        params.push(description ? description.trim() : null);
      }
      params.push(setId);

      if (sets.length > 0) {
          await conn.query(
            `UPDATE question_set SET ${sets.join(", ")} WHERE set_id = ?`,
            params
          );
      }
    }

    if (cleaned) {
      if (cleaned.length) {
        const [qs] = await conn.query(
          `SELECT question_id FROM question WHERE question_id IN (${cleaned.map(() => "?").join(",")})`,
          cleaned.map(q => q.question_id)
        );
        if (qs.length !== cleaned.length) {
          await conn.rollback();
          return res.status(400).json({ message: "มี question_id บางตัวไม่ถูกต้อง" });
        }
      }

      await conn.query("DELETE FROM question_set_items WHERE set_id = ?", [setId]);

      if (cleaned.length) {
        const values = cleaned.map(q => [setId, q.question_id, q.sequence]);
        await conn.query(
          `INSERT INTO question_set_items (set_id, question_id, sequence) VALUES ?`,
          [values]
        );
      }
    }

    await conn.commit();
    return res.json({
      message: "อัปเดตชุดข้อสอบสำเร็จ",
      updated: {
        title: set_title !== undefined,
        description: description !== undefined,
        questions: Array.isArray(questions) ? (cleaned?.length ?? 0) : null
      }
    });
  } catch (err) {
    await conn.rollback();
    
    if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ message: 'ชื่อชุดคำถามนี้มีอยู่แล้ว' });
    }

    if (err?.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(400).json({ message: "question_id ไม่ถูกต้อง (ผิด FK)", detail: err.sqlMessage });
    }
    
    console.error("PUT /assignment-sets/:setId error:", err);
    return res.status(500).json({ message: "ไม่สามารถอัปเดตชุดได้" });
  } finally {
    conn.release();
  }
});
router.get('/:setId', JWTdecode, async (req, res) => {
  const { setId } = req.params;
  try {
    const [setRows] = await pool.query(
      `SELECT set_id, set_title, description, created_by, created_at
       FROM question_set
       WHERE set_id = ?`,
      [setId]
    );
    if (setRows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบชุดนี้' });
    }

    const [qRows] = await pool.query(
      `SELECT
          sq.question_id,
          sq.sequence,
          
          q.question_name,
          q.question_detail, -- เพิ่มการดึงรายละเอียดคำถาม
          q.question_score, -- ดึงคะแนนข้อสอบออกมาด้วย (ถ้ามี)
          dl.database_name AS database_name
        FROM question_set_items sq
        JOIN question q      ON q.question_id = sq.question_id
        LEFT JOIN database_list dl ON q.database_id = dl.database_id
        WHERE sq.set_id = ?
        ORDER BY sq.sequence ASC`,
      [setId]
    );

    res.json({
      set_id: setRows[0].set_id,
      set_title: setRows[0].set_title,
      description: setRows[0].description,
      created_by: setRows[0].created_by,
      created_at: setRows[0].created_at,
      questions: qRows
    });
  } catch (error) {
    console.error('Error in GET /assignment-sets/:setId:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/:setId', requireRole(3), async (req, res) => {
  const { setId } = req.params;
  try {
    const [refRows] = await pool.query(
      `SELECT COUNT(*) AS ref_count FROM assignment WHERE set_id = ?`,
      [setId]
    );
    if (refRows[0].ref_count > 0) {
      return res.status(400).json({ message: 'ไม่สามารถลบชุดนี้ได้ เนื่องจากมีการใช้งานอยู่' });
    }

    await pool.query(`DELETE FROM question_set_items WHERE set_id = ?`, [setId]);

    const [result] = await pool.query(
      `DELETE FROM question_set WHERE set_id = ?`,
      [setId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'ไม่พบชุดนี้' });
    }

    res.json({ message: 'ลบชุดข้อสอบสำเร็จ' });
  } catch (error) {
    console.error('Error in DELETE /assignment-sets/:setId:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
})

export default router;