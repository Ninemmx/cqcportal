import express from 'express';
import pool from '../config/db.js';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import JWTdecode from '../middleware/jwtdecode.js';
import { requireRole } from '../middleware/checkRole.js';
dotenv.config();

const router = express.Router();

function signExamToken({ exam_id, maxAgeSec = 2 * 60 * 60 }) {
  return jwt.sign(
    { scope: 'exam', exam_id },
    process.env.JWT_SECRET,
    { expiresIn: maxAgeSec }
  );
}

function requireExamAccess(req, res, next) {
  const token = req.cookies?.exam_access;
  if (!token) return res.status(401).json({ ok: false, message: 'ยังไม่ยืนยันรหัส' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.scope !== 'exam') throw new Error('bad scope');
    const paramId = Number(req.params.id);
    if (paramId !== Number(payload.exam_id)) throw new Error('exam mismatch');
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, message: 'สิทธิ์ไม่ถูกต้อง/หมดอายุ' });
  }
}

// GET all exams
router.get('/', JWTdecode, requireRole(2), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT e.*, g.group_name, CONCAT(m.first_name, ' ', m.last_name) as created_by_name
            FROM exam e
            LEFT JOIN group_student g ON e.group_id = g.group_id
            LEFT JOIN member m ON e.created_by = m.user_id
            ORDER BY e.created_at DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching exams:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Temporary route to check data in tables
router.get('/checkdata', JWTdecode, requireRole(3), async (req, res) => {
    try {
        const [members] = await pool.query('SELECT user_id, first_name, last_name FROM member LIMIT 5');
        const [examSets] = await pool.query('SELECT set_id, set_title FROM question_set LIMIT 5');
        const [groups] = await pool.query('SELECT group_id, group_name FROM group_student LIMIT 5');
        
        res.json({
            members,
            examSets,
            groups
        });
    } catch (error) {
        console.error('Error checking data:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET exam by ID
router.get('/:id', JWTdecode, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.user_id; // ดึง user_id จาก token ที่ decode แล้ว
        
        const [rows] = await pool.query(`
            SELECT e.*, g.group_name, CONCAT(m.first_name, ' ', m.last_name) as created_by_name
            FROM exam e
            LEFT JOIN group_student g ON e.group_id = g.group_id
            LEFT JOIN member m ON e.created_by = m.user_id
            WHERE e.exam_id = ?
        `, [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Exam not found' });
        }
        
        const exam = rows[0];
        
        // ดึงข้อมูลคำถามจากชุดคำถามที่เกี่ยวข้องกับสอบ
        if (exam.set_id) {
            const [questionRows] = await pool.query(`
                SELECT
                    q.question_id,
                    q.question_name,
                    q.question_detail,
                    q.question_score,
                    q.keyword,
                    q.database_id,
                    dl.database_name,
                    q.purpose_id,
                    sq.sequence
                FROM question_set_items sq
                JOIN question q ON sq.question_id = q.question_id
                LEFT JOIN database_list dl ON q.database_id = dl.database_id
                WHERE sq.set_id = ?
                ORDER BY sq.sequence ASC
            `, [exam.set_id]);
            
            // เพิ่มฟิลด์ score ที่คำนวณจากคะแนนย่อยต่างๆ และเพิ่มฟิลด์ database_name ที่ ExamForm ต้องการ
            let questionsWithScore = questionRows.map(q => ({
                ...q,
                score: q.question_score,
                database_name: q.database_name
            }));
            
            // ตรวจสอบว่ามีการสุ่มลำดับโจทย์ไว้แล้วหรือไม่ (ถ้า randomize_order = 1)
            if (exam.randomize_order === 1 && userId) {
                const [sequenceRows] = await pool.query(`
                    SELECT question_order_json
                    FROM student_exam_sequence
                    WHERE user_id = ? AND exam_id = ?
                `, [userId, id]);
                
                if (sequenceRows.length > 0) {
                    // มีการสุ่มไว้แล้ว ใช้ลำดับเดิมเสมอ
                    const savedData = sequenceRows[0].question_order_json;
                    console.log('Saved question order data:', savedData, 'Type:', typeof savedData);
                    
                    try {
                        // ตรวจสอบว่าข้อมูลเป็น string หรือไม่ ถ้าไม่ใช่ให้แปลงเป็น string ก่อน
                        const jsonString = typeof savedData === 'string' ? savedData : JSON.stringify(savedData);
                        const savedOrder = JSON.parse(jsonString);
                        
                        // ตรวจสอบว่า savedOrder เป็น array หรือไม่
                        if (!Array.isArray(savedOrder)) {
                            throw new Error('Saved order is not an array');
                        }
                        
                        // เรียงลำดับโจทย์ตามที่บันทึกไว้
                        const orderedQuestions = [];
                        savedOrder.forEach(questionId => {
                            const question = questionsWithScore.find(q => q.question_id === questionId);
                            if (question) {
                                orderedQuestions.push(question);
                            }
                        });
                        
                        // ตรวจสอบว่าจำนวนโจทย์ตรงกันหรือไม่
                        if (orderedQuestions.length !== questionsWithScore.length) {
                            console.warn('Question count mismatch, using original order');
                            // ถ้าจำนวนไม่ตรง ให้ใช้ลำดับเดิมและอัปเดตข้อมูล
                            const questionOrder = questionsWithScore.map(q => q.question_id);
                            await pool.query(`
                                INSERT INTO student_exam_sequence (user_id, exam_id, question_order_json)
                                VALUES (?, ?, ?)
                                ON DUPLICATE KEY UPDATE
                                question_order_json = VALUES(question_order_json),
                                updated_at = CURRENT_TIMESTAMP
                            `, [userId, id, JSON.stringify(questionOrder)]);
                        } else {
                            questionsWithScore = orderedQuestions;
                            console.log('Using saved question order for user', userId, 'exam', id);
                        }
                    } catch (parseError) {
                        console.error('Error parsing saved question order:', parseError);
                        console.log('Saved data type:', typeof savedData, 'Saved data:', savedData);
                        // ถ้า parse ไม่ได้ ให้สุ่มใหม่และบันทึกทันที
                        shuffleQuestions(questionsWithScore);
                        // บันทึกลำดับใหม่ทันที
                        const questionOrder = questionsWithScore.map(q => q.question_id);
                        await pool.query(`
                            INSERT INTO student_exam_sequence (user_id, exam_id, question_order_json)
                            VALUES (?, ?, ?)
                            ON DUPLICATE KEY UPDATE
                            question_order_json = VALUES(question_order_json),
                            updated_at = CURRENT_TIMESTAMP
                        `, [userId, id, JSON.stringify(questionOrder)]);
                        console.log('Created new question order due to parse error');
                    }
                } else {
                    // ยังไม่เคยสุ่ม ให้สุ่มใหม่และบันทึกทันที
                    shuffleQuestions(questionsWithScore);
                    const questionOrder = questionsWithScore.map(q => q.question_id);
                    await pool.query(`
                        INSERT INTO student_exam_sequence (user_id, exam_id, question_order_json)
                        VALUES (?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                        question_order_json = VALUES(question_order_json),
                        updated_at = CURRENT_TIMESTAMP
                    `, [userId, id, JSON.stringify(questionOrder)]);
                    console.log('Created new question order for user', userId, 'exam', id);
                }
            }
            
            // เพิ่มคำถามลงในข้อมูลสอบ
            exam.questions = questionsWithScore;
            exam.assignment_title = exam.exam_title; // เพิ่มฟิลด์ assignment_title เพื่อความเข้ากันได้กับ frontend
        } else {
            exam.questions = [];
            exam.assignment_title = exam.exam_title; // เพิ่มฟิลด์ assignment_title เพื่อความเข้ากันได้กับ frontend
        }
        
        res.json(exam);
    } catch (error) {
        console.error('Error fetching exam:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ฟังก์ชันสำหรับสุ่มลำดับโจทย์
function shuffleQuestions(questions) {
    // ใช้ Fisher-Yates shuffle algorithm
    for (let i = questions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [questions[i], questions[j]] = [questions[j], questions[i]];
    }
}


// CREATE new exam
router.post('/', JWTdecode, requireRole(3), async (req, res) => {
    try {
        const {
            exam_title,
            exam_password,
            created_by,
            start_time,
            end_time,
            group_id,
            max_attempts,
            allow_retry,
            allow_view,
            restrict_ip,
            set_id,
            exam_description,
            randomize_order
        } = req.body;

        const [result] = await pool.query(`
            INSERT INTO exam (
                exam_title, exam_password, created_by, start_time, end_time,
                group_id, max_attempts, allow_retry, allow_view, restrict_ip,
                set_id, exam_description, randomize_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            exam_title,
            exam_password || null,
            created_by,
            start_time,
            end_time,
            group_id,
            max_attempts || null,
            allow_retry || 0,
            allow_view || 0,
            restrict_ip || 0,
            set_id,
            exam_description || null,
            randomize_order || 0
        ]);

        res.status(201).json({
            message: 'Exam created successfully',
            exam_id: result.insertId
        });
    } catch (error) {
        console.error('Error creating exam:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// UPDATE exam
router.put('/:id', JWTdecode, requireRole(3), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            exam_title,
            exam_password,
            start_time,
            end_time,
            group_id,
            max_attempts,
            allow_retry,
            allow_view,
            restrict_ip,
            set_id,
            exam_description,
            randomize_order
        } = req.body;

        const [result] = await pool.query(`
            UPDATE exam SET
                exam_title = ?,
                exam_password = ?,
                start_time = ?,
                end_time = ?,
                group_id = ?,
                max_attempts = ?,
                allow_retry = ?,
                allow_view = ?,
                restrict_ip = ?,
                set_id = ?,
                exam_description = ?,
                randomize_order = ?
            WHERE exam_id = ?
        `, [
            exam_title,
            exam_password || null,
            start_time,
            end_time,
            group_id,
            max_attempts || null,
            allow_retry || 0,
            allow_view || 0,
            restrict_ip || 0,
            set_id,
            exam_description || null,
            randomize_order || 0,
            id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Exam not found' });
        }

        res.json({ message: 'Exam updated successfully' });
    } catch (error) {
        console.error('Error updating exam:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE exam
router.delete('/:id', JWTdecode, requireRole(3), async (req, res) => {
    try {
        const { id } = req.params;
        const [result] = await pool.query('DELETE FROM exam WHERE exam_id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Exam not found' });
        }

        res.json({ message: 'Exam deleted successfully' });
    } catch (error) {
        console.error('Error deleting exam:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Check exam authentication requirements
router.get('/:id/check', requireExamAccess, async (req, res) => {
    try {
        const { id } = req.params;

        const [rows] = await pool.query(`
            SELECT exam_id, exam_password, start_time, end_time
            FROM exam
            WHERE exam_id = ?
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Exam not found' });
        }

        const exam = rows[0];

        // Check if exam is within time range
        const now = new Date();
        const startTime = new Date(exam.start_time);
        const endTime = new Date(exam.end_time);

        if (now < startTime) {
            return res.status(403).json({ message: 'การสอบยังไม่เริ่ม' });
        }

        if (now > endTime) {
            return res.status(403).json({ message: 'การสอบสิ้นสุดแล้ว' });
        }

        // Authentication already verified by requireExamAccess middleware
        res.json({ ok: true });
    } catch (error) {
        console.error('Error checking exam authentication:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Auth exam with password
router.post('/:id/auth', async (req, res) => {
    try {
        const exam_id = Number(req.params.id);
        const { password = '' } = req.body ?? {};

        const [rows] = await pool.query('SELECT exam_password, start_time, end_time FROM exam WHERE exam_id=?', [exam_id]);
        if (rows.length === 0) return res.status(404).json({ message: 'ไม่พบการสอบ' });
        const exam = rows[0];

        // Check if exam is within time range
        const now = new Date();
        const startTime = new Date(exam.start_time);
        const endTime = new Date(exam.end_time);

        if (now < startTime) {
            return res.status(403).json({ message: 'การสอบยังไม่เริ่ม' });
        }

        if (now > endTime) {
            return res.status(403).json({ message: 'การสอบสิ้นสุดแล้ว' });
        }

        const exam_password = exam.exam_password;

        if (!exam_password) {
            const token = signExamToken({ exam_id });
            res.cookie('exam_access', token, {
                httpOnly: true,
                sameSite: 'none',
                secure: true,
                path: '/',
                maxAge: 2 * 60 * 60 * 1000
            });
            return res.json({ ok: true });
        }

        if (String(password) === String(exam_password)) {
            const token = signExamToken({ exam_id });
            res.cookie('exam_access', token, {
                httpOnly: true,
                sameSite: 'none',
                secure: true,
                path: '/',
                maxAge: 2 * 60 * 60 * 1000
            });
            return res.json({ ok: true });
        }

        return res.status(401).json({ ok: false, message: 'รหัสผ่านไม่ถูกต้อง' });
    } catch (error) {
        console.error('Error authenticating exam:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST บันทึกการสุ่มลำดับโจทย์
router.post('/:id/save-sequence', JWTdecode, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.user_id;
        const { questionOrder } = req.body;
        
        if (!userId) {
            return res.status(401).json({ message: 'ไม่พบข้อมูลผู้ใช้' });
        }
        
        if (!questionOrder || !Array.isArray(questionOrder)) {
            return res.status(400).json({ message: 'ข้อมูลลำดับโจทย์ไม่ถูกต้อง' });
        }
        
        // ตรวจสอบว่าข้อสอบมีการเปิดใช้งานการสุ่มลำดับหรือไม่
        const [examRows] = await pool.query(`
            SELECT randomize_order FROM exam WHERE exam_id = ?
        `, [id]);
        
        if (examRows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลข้อสอบ' });
        }
        
        if (examRows[0].randomize_order !== 1) {
            return res.status(400).json({ message: 'ข้อสอบนี้ไม่ได้เปิดใช้งานการสุ่มลำดับ' });
        }
        
        // บันทึกลำดับโจทย์ (ใช้ INSERT ON DUPLICATE KEY UPDATE สำหรับอัปเดตถ้ามีอยู่แล้ว)
        const [result] = await pool.query(`
            INSERT INTO student_exam_sequence (user_id, exam_id, question_order_json)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
            question_order_json = VALUES(question_order_json),
            updated_at = CURRENT_TIMESTAMP
        `, [userId, id, JSON.stringify(questionOrder)]);
        
        res.json({
            message: 'บันทึกลำดับโจทย์สำเร็จ',
            success: true
        });
    } catch (error) {
        console.error('Error saving question sequence:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST สร้างตาราง student_exam_sequence (สำหรับการติดตั้งครั้งแรก)
router.post('/create-sequence-table', async (req, res) => {
    try {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS student_exam_sequence (
                sequence_id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                exam_id INT NOT NULL,
                question_order_json JSON NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_user_exam (user_id, exam_id),
                FOREIGN KEY (user_id) REFERENCES member(user_id) ON DELETE CASCADE,
                FOREIGN KEY (exam_id) REFERENCES exam(exam_id) ON DELETE CASCADE
            )
        `;
        
        await pool.query(createTableSQL);
        
        res.json({
            message: 'สร้างตาราง student_exam_sequence สำเร็จ',
            success: true
        });
    } catch (error) {
        console.error('Error creating student_exam_sequence table:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


export default router;