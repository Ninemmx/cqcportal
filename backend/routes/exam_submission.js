import express from 'express';
import dotenv from 'dotenv';
import pool from '../config/db.js';
import JWTdecode from '../middleware/jwtdecode.js';
import { requireRole } from '../middleware/checkRole.js';

dotenv.config();
const router = express.Router();

// ดึงข้อมูล submission ทั้งหมดของ exam สำหรับ user
router.get('/submission/:examId', JWTdecode, async (req, res) => {
    try {
        const { examId } = req.params;
        const userId = req.user.user_id;

        const [rows] = await pool.query(
            `SELECT es.*
             FROM exam_submission es
             LEFT JOIN question q ON es.question_id = q.question_id
             WHERE es.user_id=? AND es.exam_id=?
             ORDER BY es.attempt_no DESC, es.question_id ASC`,
            [userId, examId]
        );

        res.json({ submissions: rows });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ส่งคำตอบสำหรับ exam
router.post('/submission/:examId', JWTdecode, async (req, res) => {
    const { examId } = req.params;
    const userId = req.user.user_id;
    const { answers } = req.body;

    if (!Array.isArray(answers)) {
        return res.status(400).json({ error: 'Invalid answers format' });
    }

    const conn = await pool.getConnection(); 

    try {
        await conn.beginTransaction(); 

        const [examRows] = await conn.query(
            'SELECT end_time FROM exam WHERE exam_id = ?',
            [examId]
        );

        if (examRows.length === 0) {
            throw new Error('ไม่พบสอบนี้');
        }
        
        const exam = examRows[0];
        const now = new Date();
        const endTime = new Date(exam.end_time);

        // [แก้ไขแล้ว] ตรวจสอบเวลาสิ้นสุดเท่านั้น (ข้อสอบไม่มีส่งสาย)
        if (now > endTime) {
            return res.status(403).json({ error: 'หมดเวลาส่งสอบแล้ว' });
        }
        const isLate = 0; // ข้อสอบไม่มีส่งสาย

        const [rows] = await conn.query(
            'SELECT MAX(attempt_no) AS last_attempt FROM exam_submission WHERE user_id=? AND exam_id=?',
            [userId, examId]
        );
        const newAttempt = (rows[0]?.last_attempt || 0) + 1;

        for (const ans of answers) {
            if (!ans.sql || String(ans.sql).trim() === '') continue;
            
            await conn.query(
                `INSERT INTO exam_submission (user_id, exam_id, question_id, answers_json, attempt_no, submitted_at, is_late)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    examId,
                    ans.question_id,
                    JSON.stringify({ sql: ans.sql }),
                    newAttempt,
                    now,
                    isLate
                ]
            );
        }
        
        await conn.query(
            'INSERT INTO queue (user_id, target_type, target_id, attempt_no, queue_at) VALUES (?, ?, ?, ?, ?)',
            [userId, 'exam', examId, newAttempt, now]
        );

        await conn.commit();

        res.json({ ok: true, attempt_no: newAttempt });

    } catch (err) {
        await conn.rollback();
        console.error('Exam Submission Error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        if (conn) conn.release();
    }
});

// GET draft สำหรับ exam
router.get('/submission/draft/:examId', JWTdecode, async (req, res) => {
    try {
        const { examId } = req.params;
        const userId = req.user.user_id;
        const [rows] = await pool.query(
            'SELECT answers_json FROM submission_draft WHERE user_id=? AND exam_id=?',
            [userId, examId]
        );
        if (!rows[0]) return res.json({});
        let parsed;
        try {
            parsed = JSON.parse(rows[0].answers_json);
        } catch {
            parsed = rows[0].answers_json;
        }
        res.json({ answers: parsed });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST draft สำหรับ exam
router.post('/submission/draft/:examId', JWTdecode, async (req, res) => {
    try {
        const { examId } = req.params;
        const userId = req.user.user_id;
        const { answers } = req.body;
        await pool.query(
            `INSERT INTO submission_draft (user_id, exam_id, answers_json)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE answers_json=VALUES(answers_json), updated_at=NOW()`,
            [userId, examId, JSON.stringify(answers || {})]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE draft สำหรับ exam
router.delete('/submission/draft/:examId', JWTdecode, async (req, res) => {
    try {
        const { examId } = req.params;
        const userId = req.user.user_id;
        await pool.query(
            'DELETE FROM submission_draft WHERE user_id=? AND exam_id=?',
            [userId, examId]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ดึงคะแนนสำหรับ exam
router.get('/submission/score/:examId', JWTdecode, async (req, res) => {
    try {
        const examId = req.params.examId;
        if (!examId) return res.status(400).json({ error: 'Missing exam id' });

        const [setRows] = await pool.query(
            `SELECT set_id FROM exam WHERE exam_id = ?`,
            [examId]
        );
        const setId = setRows[0]?.set_id;
        if (!setId) return res.status(404).json({ error: 'Exam not found' });

        const [rows] = await pool.query(
            `SELECT q.question_id, q.question_score
             FROM question_set_items asq
             JOIN question q ON asq.question_id = q.question_id
             WHERE asq.set_id = ?`,
            [setId]
        );

        const total_score = rows.reduce((sum, r) =>
            sum + (r.question_score || 0), 0);

        res.json({
            scores: rows,
            total_score
        });
    } catch (err) {
        console.error('Error in /exam_score:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ดึงผลลัพธ์สำหรับ exam
router.get('/submission/results/:examId', JWTdecode, requireRole(2), async (req, res) => {
  try {
    const { examId } = req.params;

    const [examRows] = await pool.query(
      `SELECT group_id, set_id FROM exam WHERE exam_id = ?`,
      [examId]
    );
    if (!examRows[0]) return res.status(404).json({ error: 'Exam not found' });

    const { group_id: groupId, set_id: setId } = examRows[0];

    const [qCountRows] = await pool.query(
      `SELECT COUNT(*) AS max_question FROM question_set_items WHERE set_id = ?`,
      [setId]
    );
    const max_question = qCountRows[0]?.max_question || 0;

    const [memberRows] = await pool.query(
      `SELECT user_id, prefix, first_name, last_name FROM member WHERE group_id = ?`,
      [groupId]
    );
    const total_students = memberRows.length;

    const [submissionCountRows] = await pool.query(
      `SELECT COUNT(DISTINCT s.user_id) AS submitted_count
       FROM submission s
       JOIN member m ON m.user_id = s.user_id
       WHERE s.exam_id = ? AND m.group_id = ?`,
      [examId, groupId]
    );
    const submitted_count = submissionCountRows[0]?.submitted_count || 0;
    const not_submitted_count = Math.max(total_students - submitted_count, 0);

    const [rows] = await pool.query(
      `WITH latest_attempt AS (
         SELECT s.user_id,
                s.question_id,
                MAX(s.attempt_no) AS max_attempt
         FROM submission s
         WHERE s.exam_id = ?
         GROUP BY s.user_id, s.question_id
       )
       SELECT
         s.user_id,
         CONCAT(m.prefix, m.first_name, ' ', m.last_name) AS name,
         s.question_id,
         aq.sequence,
         s.result_score,
         s.syntax_score,
         s.keyword_score,
         s.teacher_score,
         s.answers_json,
         s.submission_id,
         s.submitted_at,
         -- คะแนนเต็มจากตาราง question
         q.question_score   AS max_question_score,
         (q.question_score * 0.7)   AS max_result_score,
         (q.question_score * 0.2)   AS max_syntax_score,
         (q.question_score * 0.1)  AS max_keyword_score,
         q.question_score AS max_total_score,
         q.question_name
       FROM latest_attempt la
       JOIN submission s
         ON s.user_id = la.user_id
        AND s.question_id = la.question_id
        AND s.attempt_no = la.max_attempt
       JOIN member m
         ON m.user_id = s.user_id
        AND m.group_id = ?
       LEFT JOIN question_set_items aq
         ON aq.set_id = ? AND aq.question_id = s.question_id
       LEFT JOIN question q
         ON q.question_id = s.question_id
       WHERE s.exam_id = ?
       ORDER BY s.user_id, aq.sequence, s.question_id`,
      [examId, groupId, setId, examId]
    );

    return res.json({
      submissions: rows,
      max_question,
      total_students,
      submitted_count,
      not_submitted_count
    });
  } catch (err) {
    console.error('Error in /exam_results/:examId', err);
    res.status(500).json({ error: 'Server error' });
  }
});
// ดึงข้อมูลนักเรียนและ submission สำหรับ exam (เฉพาะครั้งล่าสุด)
router.get('/submission/student/:examId/:userId', JWTdecode, requireRole(2), async (req, res) => {
try {
    const { examId, userId } = req.params;

    const [studentRows] = await pool.query(
        `SELECT prefix, first_name, last_name, student_id
         FROM member
         WHERE user_id = ?`,
        [userId]
    );
    const student = studentRows[0] || null;

    const [examRows] = await pool.query('SELECT set_id FROM exam WHERE exam_id = ?', [examId]);
    if (!examRows.length) {
         return res.status(404).json({ error: 'Exam not found' });
    }
    const setId = examRows[0].set_id;

    const [submissionRows] = await pool.query(
        `SELECT
            s.*,
            q.question_name,
            aq.sequence,
            q.answer AS teacher_answer,

            q.question_score AS max_question_score,
            (q.question_score * 0.2) AS max_syntax_score,
            (q.question_score * 0.7) AS max_result_score,
            (q.question_score * 0.1) AS max_keyword_score

          FROM submission s
          LEFT JOIN question q ON s.question_id = q.question_id
          LEFT JOIN question_set_items aq ON aq.question_id = s.question_id AND aq.set_id = ? 
          WHERE s.user_id = ? -- Placeholder 2: userId
            AND s.exam_id = ? -- Placeholder 3: examId
            AND s.attempt_no = (
                SELECT MAX(s2.attempt_no)
                FROM submission s2
                WHERE s2.user_id = s.user_id
                  AND s2.exam_id = s.exam_id 
                  AND s2.question_id = s.question_id
            )
          ORDER BY aq.sequence ASC, s.question_id ASC`,
        [setId, userId, examId]
    );

    const [latestSubmit] = await pool.query(
         `SELECT MAX(submitted_at) as submitted_at FROM submission WHERE user_id = ? AND exam_id = ?`,
         [userId, examId]
    );

    res.json({
         student: student ? { ...student, submitted_at: latestSubmit[0]?.submitted_at || null } : null,
        submissions: submissionRows
        
    });

} catch (err) {
    console.error('Error in /submission/student/:examId/:userId', err);
    res.status(500).json({ error: 'Server error retrieving student submissions' });
}
});
router.get('/submission/resultlist/:examId', JWTdecode, requireRole(2), async (req, res) => {
    try {
        const { examId } = req.params;

        const [examRows] = await pool.query(
            `SELECT group_id FROM exam WHERE exam_id = ?`,
            [examId]
        );
        if (!examRows[0]) return res.status(404).json({ error: 'Exam not found' });

        const { group_id: groupId } = examRows[0];

        const [rows] = await pool.query(
            `SELECT DISTINCT
                m.user_id,
                m.student_id,
                CONCAT(m.prefix, m.first_name, ' ', m.last_name) AS full_name,
                s.submitted_at
             FROM member m
             LEFT JOIN submission s ON m.user_id = s.user_id AND s.exam_id = ?
             WHERE m.group_id = ?
             ORDER BY m.first_name, m.last_name`,
            [examId, groupId]
        );

        res.json({ students: rows });
    } catch (err) {
        console.error('Error in /submission/resultlist/:examId', err);
        res.status(500).json({ error: 'Server error' });
    }
});

export default router;