import express from 'express';
import pool from '../config/db.js';
import bcrypt from 'bcryptjs';

const router = express.Router();

// GET /permission
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM permission');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching permissions:', err);
    res.status(500).json({ error: 'ไม่สามารถโหลดสิทธิ์ได้' });
  }
});

// POST /permission/resettoken
router.post('/resettoken', async (req, res) => {
  try {
    const { user_id } = req.body || {};
    if (!user_id) return res.status(400).json({ message: 'ต้องระบุ user_id' });

    const [result] = await pool.query(
      'UPDATE member SET current_token = NULL WHERE user_id = ?',
      [user_id]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ message: 'ไม่พบผู้ใช้ หรือสถานะถูกล้างแล้ว' });

    return res.status(200).json({ message: 'ล้างสถานะเรียบร้อย', user_id, online: false });
  } catch (err) {
    console.error('[POST /resettoken] error:', err);
    return res.status(500).json({ message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// GET /permission/members
router.get('/members', async (req, res) => {
  try {
    const { perm_id, search } = req.query;

    let sql = `
      SELECT 
        m.user_id,
        m.prefix,
        m.first_name,
        m.last_name,
        m.email,
        m.student_id,
        m.perm_id,
        m.current_token,
        p.perm_name
      FROM member m
      JOIN permission p ON m.perm_id = p.perm_id
      LEFT JOIN group_student g ON m.group_id = g.group_id
      WHERE 1=1
    `;

    const params = [];

    if (perm_id) {
      sql += ` AND m.perm_id = ?`;
      params.push(perm_id);
    }

    if (search) {
      sql += ` AND (m.first_name LIKE ? OR m.last_name LIKE ? OR m.email LIKE ? OR m.student_id LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    sql += ` ORDER BY m.first_name ASC`;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching members:', err);
    res.status(500).json({ error: 'ดึงข้อมูลผู้ใช้งานล้มเหลว' });
  }
});

// PUT /permission/:user_id/permission (อัปเดตสิทธิ์อย่างเดียว)
router.put('/:user_id/permission', async (req, res) => {
  const { user_id } = req.params;
  const { perm_id } = req.body;

  if (!perm_id) return res.status(400).json({ error: 'กรุณาระบุ perm_id' });

  try {
    // ✅ อัปเดต perm_id พร้อมตั้งค่า group_id = NULL
    const [result] = await pool.query(
      'UPDATE member SET perm_id = ?, group_id = NULL WHERE user_id = ?',
      [Number(perm_id), user_id]
    );

    if (result.affectedRows === 0)
      return res.status(404).json({ error: 'ไม่พบผู้ใช้งาน' });

    res.json({ message: 'อัปเดตสิทธิ์สำเร็จ และออกจากกลุ่มเรียบร้อย' });
  } catch (err) {
    console.error('Error updating permission:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดขณะอัปเดตสิทธิ์' });
  }
});

// PUT /permission/:user_id (อัปเดตข้อมูลโปรไฟล์)
router.put('/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { prefix, first_name, last_name, email, student_id, perm_id, password } = req.body;

  console.log('Received data for update:', { user_id, prefix, first_name, last_name, email, student_id, perm_id, password });

  if (!prefix || !first_name || !last_name || !email || !student_id || perm_id === undefined) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  try {
    let hashed = null;
    if (password && password.trim()) hashed = await bcrypt.hash(password, 10);

    // ✅ รวม group_id = NULL ด้วยทุกครั้งที่เปลี่ยนสิทธิ์
    const fields = [
      'prefix = ?',
      'first_name = ?',
      'last_name = ?',
      'email = ?',
      'student_id = ?',
      'perm_id = ?',
      'group_id = NULL'
    ];
    const params = [prefix, first_name, last_name, email, student_id, Number(perm_id)];
    if (hashed) { fields.push('password = ?'); params.push(hashed); }

    params.push(user_id);
    const sql = `UPDATE member SET ${fields.join(', ')} WHERE user_id = ?`;

    const [result] = await pool.query(sql, params);
    if (result.affectedRows === 0)
      return res.status(404).json({ error: 'ไม่พบผู้ใช้งาน' });

    res.json({ message: 'อัปเดตข้อมูลสำเร็จ และออกจากกลุ่มเรียบร้อย' });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'อีเมลนี้ถูกใช้แล้ว' });

    console.error('Error updating member:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดขณะอัปเดตข้อมูล' });
  }
});

export default router;
