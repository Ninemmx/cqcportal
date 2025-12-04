import express from 'express';
import pool from '../config/db.js';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import JWTdecode from '../middleware/jwtdecode.js';
import { requireRole } from '../middleware/checkRole.js';
dotenv.config();
const router = express.Router();

router.use(express.json());

function signExerciseToken({ assignment_id, maxAgeSec = 2 * 60 * 60 }) {
  return jwt.sign(
    { scope: 'exercise', assignment_id },
    process.env.JWT_SECRET,
    { expiresIn: maxAgeSec }
  );
}

function requireExerciseAccess(req, res, next) {
  const token = req.cookies?.exercise_access;
  if (!token) return res.status(401).json({ ok: false, message: 'ยังไม่ยืนยันรหัส' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.scope !== 'exercise') throw new Error('bad scope');
    const paramId = Number(req.params.id);
    if (paramId !== Number(payload.assignment_id)) throw new Error('assignment mismatch');
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, message: 'สิทธิ์ไม่ถูกต้อง/หมดอายุ' });
  }
}


router.get('/', JWTdecode, requireRole(2), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.*, g.group_name
      FROM assignment AS a
      JOIN group_student AS g ON a.group_id = g.group_id
    `);
    res.status(200).json(rows);
  } catch (err) {
    console.error('fetch exercise failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', JWTdecode, requireRole(2), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [rows] = await pool.query(`
      SELECT q.*, db.database_name, a.assignment_title
      FROM assignment as a
      JOIN question_set_items as asq ON a.set_id = asq.set_id
      JOIN question as q ON asq.question_id = q.question_id
      JOIN database_list as db ON q.database_id = db.database_id
      WHERE a.assignment_id = ?
    `, [id]);
    res.status(200).json(rows);
  } catch (err) {
    console.error('fetch exercise failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
router.post('/assignments', JWTdecode, requireRole(3), async (req, res) => {
  const {
    assignment_title,
    assignment_password,
    assignment_description,
    start_time,
    end_time,
    group_id,
    max_attempts,
    allow_retry,
    allow_view,
    allow_late,
    set_id,
    late_end_at,
    late_penalty_percent,
  } = req.body;

  const created_by = req.user.user_id;

  const trimmedTitle = assignment_title ? assignment_title.trim() : '';
  if (!trimmedTitle) {
    return res.status(400).json({ message: 'กรุณากรอกชื่อแบบฝึกหัด (ห้ามเว้นว่าง)' });
  }

  if (!start_time || !end_time || !group_id || !set_id || !created_by) {
    return res.status(400).json({ message: 'ข้อมูลไม่ครบถ้วน' });
  }

  if (allow_late && !late_end_at) {
    return res.status(400).json({ message: 'กรุณาเลือกวันที่สิ้นสุดส่งล่าช้า' });
  }

  try {
    const [dupRows] = await pool.query(
      'SELECT assignment_id FROM assignment WHERE assignment_title = ? AND group_id = ? LIMIT 1',
      [trimmedTitle, group_id]
    );

    if (dupRows.length > 0) {
      return res.status(400).json({ message: 'ชื่อแบบฝึกหัดนี้ซ้ำกับที่มีอยู่แล้วในกลุ่มเรียนนี้ กรุณาใช้ชื่ออื่น' });
    }

    const finalPassword = assignment_password && assignment_password.trim() !== '' ? assignment_password : null;

    const sql = `
            INSERT INTO assignment (
                assignment_title, 
                assignment_password, 
                assignment_description, 
                created_by, 
                created_at,
                start_time, 
                end_time, 
                group_id, 
                max_attempts,          
                allow_retry,          
                allow_view, 
                allow_late, 
                late_end_at, 
                late_penalty_percent, 
                set_id                 
            )
            VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

    const params = [
      trimmedTitle,
      finalPassword,
      assignment_description || null,
      created_by,
      start_time,
      end_time,
      group_id,
      max_attempts || null,
      allow_retry ? 1 : 0,
      allow_view ? 1 : 0,
      allow_late ? 1 : 0,
      (allow_late && late_end_at) ? late_end_at : null,
      (allow_late && late_penalty_percent) ? Number(late_penalty_percent) : null,
      set_id || null,
    ];

    const [r] = await pool.query(sql, params);
    res.status(201).json({ message: 'สร้างรายการสำเร็จ', assignment_id: r.insertId });

  } catch (err) {
    console.error('POST /assignments failed:', err);
    res.status(500).json({ message: 'ไม่สามารถสร้างรายการได้' });
  }
});
router.put('/assignments/:id', JWTdecode, requireRole(3), async (req, res) => {
  const id = Number(req.params.id);
  const {
    assignment_title,
    assignment_password,
    assignment_description,
    start_time,
    end_time,
    group_id,
    max_attempts,
    allow_retry,
    allow_view,
    allow_late,
    late_end_at,
    late_penalty_percent,
    set_id
  } = req.body;

  const trimmedTitle = assignment_title ? assignment_title.trim() : '';

  if (!id || !trimmedTitle) {
    return res.status(400).json({ message: 'กรุณากรอกชื่อแบบฝึกหัด (ห้ามเว้นว่าง)' });
  }

  if (!start_time || !end_time || !group_id || !set_id) {
    return res.status(400).json({ message: 'ข้อมูลไม่ครบถ้วน' });
  }

  try {
    const [dupRows] = await pool.query(
      `SELECT assignment_id FROM assignment
       WHERE assignment_title = ? AND group_id = ? AND assignment_id != ? LIMIT 1`,
      [trimmedTitle, group_id, id]
    );

    if (dupRows.length > 0) {
      return res.status(400).json({ message: 'ชื่อแบบฝึกหัดนี้ซ้ำกับที่มีอยู่แล้วในกลุ่มเรียนนี้ กรุณาใช้ชื่ออื่น' });
    }

    const finalPassword = assignment_password && assignment_password.trim() !== '' ? assignment_password : null;

    const sql = `
      UPDATE assignment SET
        assignment_title       = ?,
        assignment_password    = ?,
        assignment_description = ?,
        start_time             = ?,
        end_time               = ?,
        group_id               = ?,
        max_attempts           = ?,  
        allow_retry            = ?,  
        allow_view             = ?,
        allow_late             = ?,
        late_end_at            = ?,
        late_penalty_percent   = ?,
        set_id                 = ?
      WHERE assignment_id      = ?
    `;

    const params = [
      trimmedTitle,
      finalPassword,
      assignment_description ?? null,
      start_time,
      end_time,
      Number(group_id),
      (max_attempts === null || max_attempts === undefined) ? null : Number(max_attempts),
      allow_retry ? 1 : 0,
      allow_view ? 1 : 0,
      allow_late ? 1 : 0,
      (allow_late && late_end_at) ? late_end_at : null,
      (allow_late && late_penalty_percent) ? Number(late_penalty_percent) : null,
      Number(set_id),
      id
    ];

    const [r] = await pool.query(sql, params);
    if (!r.affectedRows) return res.status(404).json({ message: 'ไม่พบรายการ' });
    res.json({ message: 'อัปเดตสำเร็จ' });

  } catch (err) {
    console.error('PUT /assignments/:id failed:', err);
    res.status(500).json({ message: 'อัปเดตไม่สำเร็จ' });
  }
});
router.get('/:id/check', requireExerciseAccess, (req, res) => {
  res.json({ ok: true });
});

router.post('/:id/auth', async (req, res) => {
  const assignment_id = Number(req.params.id);
  const { password = '' } = req.body ?? {};

  const [rows] = await pool.query('SELECT assignment_password FROM assignment WHERE assignment_id=?', [assignment_id]);
  if (rows.length === 0) return res.status(404).json({ message: 'ไม่พบแบบฝึกหัด' });
  const assignment_password = rows[0].assignment_password;

  if (!assignment_password || String(password) === String(assignment_password)) {
    const token = signExerciseToken({ assignment_id });
    res.cookie('exercise_access', token, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      path: '/',
      maxAge: 2 * 60 * 60 * 1000
    });
    return res.json({ ok: true });
  }

  return res.status(401).json({ ok: false, message: 'รหัสไม่ถูกต้อง' });
});

router.get('/student/:assignmentId/:userId', JWTdecode, requireRole(2), async (req, res) => {
  try {
    const { assignmentId, userId } = req.params;

    const [assignRows] = await pool.query(
      'SELECT group_id, set_id FROM assignment WHERE assignment_id = ?',
      [assignmentId]
    );
    if (!assignRows[0]) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    const { group_id: groupId, set_id: setId } = assignRows[0];

    const [studentRows] = await pool.query(
      'SELECT user_id, prefix, first_name, last_name, student_id FROM member WHERE user_id = ? AND group_id = ?',
      [userId, groupId]
    );
    if (!studentRows[0]) {
      return res.status(404).json({ error: 'Student not found in this assignment' });
    }
    const student = studentRows[0];

    const [submissions] = await pool.query(
      `WITH latest_attempt AS (
          SELECT s.question_id, MAX(s.attempt_no) AS max_attempt
          FROM submission s
          WHERE s.assignment_id = ? AND s.user_id = ?
          GROUP BY s.question_id
       )
       SELECT s.submission_id, s.user_id, s.assignment_id, s.question_id,
              s.answers_json, s.syntax_score, s.result_score, s.keyword_score, s.teacher_score,
              s.final_score,
              s.is_late,
              s.late_penalty_applied, 
              s.submitted_at,
              q.question_score AS max_question_score,
              (q.question_score * 0.2) AS max_syntax_score,
              (q.question_score * 0.7) AS max_result_score,
              (q.question_score * 0.1) AS max_keyword_score,
              q.answer AS teacher_answer,
              asq.sequence
       FROM submission s
       JOIN latest_attempt la
         ON s.question_id = la.question_id
         AND s.attempt_no = la.max_attempt
       JOIN question q
         ON s.question_id = q.question_id
       JOIN question_set_items asq
         ON asq.set_id = ?
         AND s.question_id = asq.question_id
       WHERE s.assignment_id = ? AND s.user_id = ?
       ORDER BY asq.sequence ASC`,
      [assignmentId, userId, setId, assignmentId, userId]
    );

    let lastSubmittedAt = null;
    if (submissions.length > 0) {
      const sorted = [...submissions].sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
      lastSubmittedAt = sorted[0].submitted_at;
    }

    return res.json({
      student: {
        user_id: student.user_id,
        first_name: student.first_name,
        last_name: student.last_name,
        student_id: student.student_id,
        submitted_at: lastSubmittedAt,
      },
      submissions: submissions || []
    });

  } catch (err) {
    console.error('Error in /Exercise/student/:assignmentId/:userId', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;