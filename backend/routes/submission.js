import express from 'express';
import dotenv from 'dotenv';
import pool from '../config/db.js';
import JWTdecode from '../middleware/jwtdecode.js';
import { requireRole } from '../middleware/checkRole.js';

dotenv.config();
const router = express.Router();

router.get('/submission/:assignmentId', JWTdecode, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const userId = req.user.user_id;

        const [rows] = await pool.query(
            `SELECT s.*
             FROM submission s
             LEFT JOIN question q ON s.question_id = q.question_id
             WHERE s.user_id=? AND s.assignment_id=?
             ORDER BY s.attempt_no DESC, s.question_id ASC`,
            [userId, assignmentId]
        );

        res.json({ submissions: rows });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/submission/:assignmentId', JWTdecode, async (req, res) => {
    const { assignmentId } = req.params;
    const userId = req.user.user_id;
    const { answers } = req.body;

    if (!Array.isArray(answers)) {
        return res.status(400).json({ error: 'Invalid answers format' });
    }

    const conn = await pool.getConnection(); 

    try {
        await conn.beginTransaction(); 

        const [assignmentRows] = await conn.query(
            'SELECT end_time, late_end_at FROM assignment WHERE assignment_id = ?',
            [assignmentId]
        );

        if (assignmentRows.length === 0) {
            throw new Error('ไม่พบแบบฝึกหัดนี้');
        }
        
        const assignment = assignmentRows[0];
        const now = new Date();
        const endTime = new Date(assignment.end_time);
        const lateEndTime = assignment.late_end_at ? new Date(assignment.late_end_at) : null;

        let isLate = 0;
        if (now <= endTime) {
            isLate = 0;
        } else if (lateEndTime && now <= lateEndTime) {
            isLate = 1; 
        } else {
            return res.status(403).json({ error: 'หมดเวลาส่งแบบฝึกหัดแล้ว' });
        }

        const [rows] = await conn.query(
            'SELECT MAX(attempt_no) AS last_attempt FROM submission WHERE user_id=? AND assignment_id=?',
            [userId, assignmentId]
        );
        const newAttempt = (rows[0]?.last_attempt || 0) + 1;

        for (const ans of answers) {
            if (!ans.sql || String(ans.sql).trim() === '') continue;
            
            await conn.query(
                `INSERT INTO submission (user_id, assignment_id, question_id, answers_json, attempt_no, submitted_at, is_late)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId, 
                    assignmentId, 
                    ans.question_id, 
                    JSON.stringify({ sql: ans.sql }), 
                    newAttempt, 
                    now, 
                    isLate 
                ]
            );
            console.log('isLate', isLate);   ;
        }
        
        await conn.query(
            'INSERT INTO queue (user_id, target_type, target_id, attempt_no, queue_at) VALUES (?, ?, ?, ?, ?)',
            [userId, 'assignment', assignmentId, newAttempt, now]
        );

        await conn.commit();

        res.json({ ok: true, attempt_no: newAttempt });

    } catch (err) {
        await conn.rollback();
        console.error('Submission Error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        if (conn) conn.release();
    }
});

router.get('/assignment_submission/:assignmentId', JWTdecode, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const userId = req.user.user_id;

      
        const [rows] = await pool.query(
            `SELECT s.*
             FROM assignment_submission s
             LEFT JOIN question q ON s.question_id = q.question_id
             WHERE s.user_id = ? AND s.assignment_id = ?
             ORDER BY s.attempt_no DESC, s.question_id ASC`,
            [userId, assignmentId]
        );

        res.json({ submissions: rows });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});
router.post('/assignment_submission/:assignmentId', JWTdecode, async (req, res) => {
    const { assignmentId } = req.params;
    const userId = req.user.user_id;
    const { answers } = req.body;

    if (!Array.isArray(answers)) {
        return res.status(400).json({ error: 'Invalid answers format' });
    }

    const conn = await pool.getConnection(); 

    try {
        await conn.beginTransaction(); 

        const [assignmentRows] = await conn.query(
            'SELECT end_time, late_end_at FROM assignment WHERE assignment_id = ?',
            [assignmentId]
        );

        if (assignmentRows.length === 0) {
            throw new Error('ไม่พบแบบฝึกหัดนี้');
        }
        
        const assignment = assignmentRows[0];
        const now = new Date();
        const endTime = new Date(assignment.end_time);
        const lateEndTime = assignment.late_end_at ? new Date(assignment.late_end_at) : null;

        let isLate = 0;
        if (now <= endTime) {
            isLate = 0;
        } else if (lateEndTime && now <= lateEndTime) {
            isLate = 1; 
        } else {
            return res.status(403).json({ error: 'หมดเวลาส่งแบบฝึกหัดแล้ว' });
        }

        const [rows] = await conn.query(
            'SELECT MAX(attempt_no) AS last_attempt FROM assignment_submission WHERE user_id=? AND assignment_id=?',
            [userId, assignmentId]
        );
        const newAttempt = (rows[0]?.last_attempt || 0) + 1;

        for (const ans of answers) {
            if (!ans.sql || String(ans.sql).trim() === '') continue;
            
            await conn.query(
                `INSERT INTO assignment_submission 
                (user_id, assignment_id, question_id, answer_json, attempt_no, submitted_at, is_late)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId, 
                    assignmentId, 
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
            [userId, 'assignment', assignmentId, newAttempt, now]
        );

        await conn.commit();

        res.json({ ok: true, attempt_no: newAttempt });

    } catch (err) {
        await conn.rollback();
        console.error('Submission Error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        if (conn) conn.release();
    }
});


router.get('/submission_draft/:assignmentId', JWTdecode, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const userId = req.user.user_id;

        const [rows] = await pool.query(
            'SELECT answer_json FROM submission_draft WHERE user_id=? AND assignment_id=?',
            [userId, assignmentId]
        );

        if (!rows[0]) return res.json({});

        let parsed;
        try {
            const rawData = rows[0].answer_json;
            parsed = (typeof rawData === 'string') ? JSON.parse(rawData) : rawData;
        } catch {
            parsed = rows[0].answer_json;
        }

        res.json({ answers: parsed });

    } catch (err) {
        console.error('Get Draft Error:', err); 
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/submission_draft/:assignmentId', JWTdecode, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const userId = req.user.user_id;
        const { answers } = req.body;

    
        await pool.query(
            `INSERT INTO submission_draft (user_id, assignment_id, answer_json, updated_at)
             VALUES (?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE 
                answer_json = VALUES(answer_json), 
                updated_at = NOW()`,
            [
                userId, 
                assignmentId, 
                JSON.stringify(answers || {}) 
            ]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error('Save Draft Error:', err); // เพิ่ม Log เพื่อให้แก้ปัญหาได้ง่ายขึ้น
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/submission_draft/:assignmentId', JWTdecode, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const userId = req.user.user_id;

        await pool.query(
            'DELETE FROM submission_draft WHERE user_id=? AND assignment_id=?',
            [userId, assignmentId]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error('Delete Draft Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/schema/:db', JWTdecode, async (req, res) => {
    try {
        const { db } = req.params;

        if (!/^[A-Za-z0-9_]+$/.test(db)) {
            return res.status(400).json({ message: 'invalid db name' });
        }

        const [columns] = await pool.query(
            `
      SELECT
        TABLE_NAME        AS table_name,
        COLUMN_NAME       AS column_name,
        DATA_TYPE         AS data_type,
        IS_NULLABLE       AS is_nullable,
        COLUMN_KEY        AS column_key,
        COLUMN_DEFAULT    AS column_default,
        EXTRA             AS extra,
        ORDINAL_POSITION  AS ordinal_position
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION
      `,
            [db]
        );

        const [fks] = await pool.query(
            `
      SELECT
        k.TABLE_NAME             AS table_name,
        k.COLUMN_NAME            AS column_name,
        k.REFERENCED_TABLE_NAME  AS referenced_table_name,
        k.REFERENCED_COLUMN_NAME AS referenced_column_name,
        k.CONSTRAINT_NAME        AS constraint_name
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS k
      WHERE k.TABLE_SCHEMA = ?
        AND k.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY k.TABLE_NAME, k.COLUMN_NAME
      `,
            [db]
        );

        const tableMap = new Map();
        for (const c of columns) {
            if (!tableMap.has(c.table_name)) {
                tableMap.set(c.table_name, { name: c.table_name, columns: [] });
            }
            tableMap.get(c.table_name).columns.push({
                name: c.column_name,
                data_type: c.data_type,
                is_nullable: c.is_nullable === 'YES',
                column_key: c.column_key,
                column_default: c.column_default,
                extra: c.extra,
                pos: c.ordinal_position,
            });
        }

        for (const t of tableMap.values()) {
            t.columns.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
        }

        res.json({
            database: db,
            tables: Array.from(tableMap.values()),
            foreign_keys: fks,
        });
    } catch (e) {
        console.error('get schema error:', e);
        res.status(500).json({ message: 'cannot load schema' });
    }
});
router.get('/results/:assignmentId', JWTdecode, requireRole(2), async (req, res) => {
  try {
    const { assignmentId } = req.params;

    // --- ส่วนดึงข้อมูล assignment, max_question, total_students, submitted_count (เหมือนเดิม) ---
    const [assignRows] = await pool.query(
      `SELECT group_id, set_id FROM assignment WHERE assignment_id = ?`,
      [assignmentId]
    );
    if (!assignRows[0]) return res.status(404).json({ error: 'Assignment not found' });
    const { group_id: groupId, set_id: setId } = assignRows[0];
    // ... (โค้ดดึง max_question, total_students, submitted_count เหมือนเดิม) ...
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
       WHERE s.assignment_id = ? AND m.group_id = ?`,
      [assignmentId, groupId]
    );
    const submitted_count = submissionCountRows[0]?.submitted_count || 0;
    const not_submitted_count = Math.max(total_students - submitted_count, 0);
    // --- สิ้นสุดส่วนที่เหมือนเดิม ---

    // [แก้ไข Query ใหม่] ใช้ INNER JOIN กับ Subquery เพื่อหา max_attempt
    const [rows] = await pool.query(
      `SELECT
         s.user_id,
         CONCAT(m.prefix, m.first_name, ' ', m.last_name) AS name,
         s.question_id,
         aq.sequence,
         s.result_score,
         s.syntax_score,
         s.keyword_score,
         s.teacher_score,
         s.final_score,  -- ดึง final_score
         s.is_late,      -- ดึง is_late
         s.answers_json,
         s.submission_id,
         s.submitted_at,
         q.question_score   AS max_question_score,
         (q.question_score * 0.7)   AS max_result_score,
         (q.question_score * 0.2)   AS max_syntax_score,
         (q.question_score * 0.1)  AS max_keyword_score,
         q.question_score AS max_total_score,
         q.question_name
       FROM submission s
       -- Join เพื่อหา max_attempt ของแต่ละข้อสำหรับ assignment นี้
       INNER JOIN (
           SELECT
               user_id,
               question_id,
               MAX(attempt_no) AS max_attempt
           FROM submission
           WHERE assignment_id = ? -- กรอง assignment ที่ถูกต้อง
           GROUP BY user_id, question_id
       ) la ON s.user_id = la.user_id
            AND s.question_id = la.question_id
            AND s.attempt_no = la.max_attempt -- เอาเฉพาะ attempt ล่าสุด
       -- Join ตารางอื่นๆ (เหมือนเดิม)
       JOIN member m
         ON m.user_id = s.user_id
        AND m.group_id = ? -- กรอง group ที่ถูกต้อง
       LEFT JOIN question_set_items aq
         ON aq.set_id = ? AND aq.question_id = s.question_id
       LEFT JOIN question q
         ON q.question_id = s.question_id
       ORDER BY s.user_id, aq.sequence, s.question_id`,
      // Parameters: [assignmentId, groupId, setId] (เรียงตาม ? ใน Query)
      [assignmentId, groupId, setId]
    );

    return res.json({
      submissions: rows,
      max_question,
      total_students,
      submitted_count,
      not_submitted_count
    });
  } catch (err) {
    console.error('Error in /results/:assignmentId', err);
    res.status(500).json({ error: 'Server error' });
  }
});


router.get('/score/:assignmentId', JWTdecode, requireRole(2), async (req, res) => {
    try {
        const assignmentId = req.params.assignmentId;
        if (!assignmentId) return res.status(400).json({ error: 'Missing assignment id' });

        const [setRows] = await pool.query(
            `SELECT set_id FROM assignment WHERE assignment_id = ?`,
            [assignmentId]
        );
        const setId = setRows[0]?.set_id;
        if (!setId) return res.status(404).json({ error: 'Assignment not found' });

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
        console.error('Error in /score:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

export default router;