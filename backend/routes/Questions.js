import express from 'express';
import pool from '../config/db.js';
import JWTdecode from '../middleware/jwtdecode.js';
import { requireRole } from '../middleware/checkRole.js';
const router = express.Router();
router.use(express.json());

router.get('/', JWTdecode, requireRole(3), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT q.*, db.database_name
      FROM question q
      JOIN database_list db ON q.database_id = db.database_id
      ORDER BY q.question_id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('ดึงข้อมูลคำถามล้มเหลว:', err);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

router.get('/compare/:questionId', JWTdecode, requireRole(3), async (req, res) => {
    const { questionId } = req.params;
    const [rows] = await pool.query(
        `SELECT question_id, question_name, question_detail, answer, question_score, keyword, database_id FROM question WHERE question_id=?`,
        [questionId]
    );
    res.json(rows[0] || {});
});

router.get('/purpose/:purposeId/questions', JWTdecode, requireRole(3), async (req, res) => {
  const purposeId = Number(req.params.purposeId);

  if (Number.isNaN(purposeId)) {
    return res.status(400).json({ message: 'purposeId ไม่ถูกต้อง' });
  }

  try {
    let sql = `
      SELECT
        q.question_id,
        q.question_name,
        q.question_detail,
        q.answer,
        q.question_score,
        q.keyword,
        q.database_id,
        db.database_name
      FROM question q
      JOIN database_list db ON q.database_id = db.database_id
      WHERE q.purpose_id = ?
    `;
    const params = [purposeId];

    sql += ' ORDER BY q.question_id DESC';

    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('ดึงคำถามตาม purpose ผิดพลาด:', err);
    return res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

router.get('/purpose/:purposeId/random', JWTdecode, requireRole(3), async (req, res) => {
  const purposeId = Number(req.params.purposeId);
  const count = Number(req.query.count) || 5; // ค่าเริ่มต้น 5 คำถาม

  if (Number.isNaN(purposeId)) {
    return res.status(400).json({ message: 'purposeId ไม่ถูกต้อง' });
  }

  if (Number.isNaN(count) || count <= 0) {
    return res.status(400).json({ message: 'จำนวนคำถามต้องเป็นตัวเลขที่มากกว่า 0' });
  }

  try {
    // ดึงคำถามทั้งหมดในจุดประสงค์นั้น
    const [allQuestions] = await pool.query(`
      SELECT
        q.question_id,
        q.question_name,
        q.question_detail,
        q.answer,
        q.question_score,
        q.keyword,
        q.database_id,
        db.database_name
      FROM question q
      JOIN database_list db ON q.database_id = db.database_id
      WHERE q.purpose_id = ?
      ORDER BY q.question_id DESC
    `, [purposeId]);

    if (allQuestions.length === 0) {
      return res.status(404).json({ message: 'ไม่พบคำถามในจุดประสงค์นี้' });
    }

    // สุ่มคำถามตามจำนวนที่ต้องการ
    const shuffled = allQuestions.sort(() => 0.5 - Math.random());
    const randomQuestions = shuffled.slice(0, Math.min(count, allQuestions.length));

    return res.json({
      questions: randomQuestions,
      total_available: allQuestions.length,
      requested_count: count,
      actual_count: randomQuestions.length
    });
  } catch (err) {
    console.error('สุ่มคำถามตาม purpose ผิดพลาด:', err);
    return res.status(500).json({ message: 'เกิดข้อผิดพลาดในการสุ่มคำถาม' });
  }
});

router.post('/', JWTdecode, requireRole(3), async (req, res) => {
    let {
        question_name, question_detail, answer, question_score, 
        keyword, database_id, purpose_id
    } = req.body;
    const created_by = req.user?.user_id;

    const numScore = Number(question_score); 
    const numDbId = Number(database_id);
    const numPurposeId = Number(purpose_id);

    if (
        !question_name || !question_detail || !answer ||
        Number.isNaN(numScore) || 
        Number.isNaN(numDbId) ||Number.isNaN(numPurposeId)
    ) {
        return res.status(400).json({ message: 'ข้อมูลไม่ครบถ้วนหรือชนิดข้อมูลไม่ถูกต้อง' });
    }

    const cleanName = question_name.trim();
    keyword = keyword?.trim() || '-';

    try {
        const checkSql = `SELECT question_id FROM question WHERE question_name = ? `;
        const [existing] = await pool.query(checkSql, [cleanName]);

        if (existing.length > 0) {
            return res.status(400).json({ message: 'ชื่อโจทย์นี้มีอยู่แล้ว' });
        }

        const sql = `
        INSERT INTO question
          (question_name, question_detail, answer, question_score, keyword, database_id, purpose_id,created_by)
        VALUES (?, ?, ?, ?, ?, ?,?,?)
      `;
        const params = [
            cleanName, question_detail, answer, numScore, keyword,
            numDbId,  numPurposeId, created_by
        ];
        const [result] = await pool.query(sql, params);
        res.status(201).json({ message: 'เพิ่มคำถามสำเร็จ', question_id: result.insertId });
    } catch (err) {
        console.error('เพิ่มคำถามไม่สำเร็จ:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเพิ่มข้อมูล' });
    }
});

router.put('/:questionId', JWTdecode, requireRole(3), async (req, res) => {
    const questionId = Number(req.params.questionId);
    let {
        question_name, question_detail, answer, question_score,
        keyword, database_id, purpose_id
    } = req.body;

    const numScore = Number(question_score);
    const numDbId = Number(database_id);
    const numPurposeId = Number(purpose_id);

    if (
        Number.isNaN(questionId) ||
        !question_name || !question_detail || !answer ||
        Number.isNaN(numScore) ||
        Number.isNaN(numDbId) || Number.isNaN(numPurposeId)
    ) {
        return res.status(400).json({ message: 'ข้อมูลไม่ครบถ้วนหรือชนิดข้อมูลไม่ถูกต้อง' });
    }

    const cleanName = question_name.trim();
    keyword = keyword?.trim() || '-';

    try {
        const checkSql = `SELECT question_id FROM question WHERE question_name = ? AND question_id != ?`;
        const [existing] = await pool.query(checkSql, [cleanName, questionId]);

        if (existing.length > 0) {
            return res.status(400).json({ message: 'ชื่อโจทย์นี้มีอยู่แล้ว' });
        }

        const sql = `
        UPDATE question SET
          question_name = ?, question_detail = ?, answer = ?,
          question_score = ?, keyword = ?, database_id = ?, purpose_id = ?
        WHERE question_id = ?
      `;
        const params = [
            cleanName, question_detail, answer,
            numScore, keyword, numDbId, numPurposeId,
            questionId
        ];
        const [result] = await pool.query(sql, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: `ไม่พบคำถาม (question_id=${questionId})` });
        }
        res.json({ message: 'แก้ไขคำถามสำเร็จ' });
    } catch (err) {
        console.error('แก้ไขคำถามไม่สำเร็จ:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการแก้ไขข้อมูล' });
    }
});

router.delete('/:questionId', JWTdecode, requireRole (3), async (req, res) => {
  const questionId = Number(req.params.questionId);
  if (Number.isNaN(questionId)) {
    return res.status(400).json({ message: 'questionId ไม่ถูกต้อง' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `DELETE FROM question_set_items WHERE question_id = ?`,
      [questionId]
    );
    const [result] = await conn.query(
      `DELETE FROM question WHERE question_id = ?`,
      [questionId]
    );

    if (!result.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ message: `ไม่พบคำถาม (question_id=${questionId})` });
    }

    await conn.commit();
    res.json({ message: 'ลบคำถามสำเร็จ' });
  } catch (err) {
    await conn.rollback();
    console.error('ลบคำถามไม่สำเร็จ:', err);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการลบข้อมูล' });
  } finally {
    conn.release();
  }
});

export default router;