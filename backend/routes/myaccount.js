// routes/member.js
import express from 'express';
import bcrypt from 'bcrypt';
import pool from '../config/db.js';
import dotenv from 'dotenv';
import JWTdecode from '../middleware/jwtdecode.js';
import { requireRole } from '../middleware/checkRole.js';

dotenv.config();
const router = express.Router();

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);


router.post('/change-password', JWTdecode, requireRole(1), async (req, res) => {
  const requester = req.user || {};
  const userId = Number(requester.user_id ?? requester.sub ?? requester.uid);

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { currentPassword, newPassword } = req.body;
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ message: 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 8 ตัวอักษร' });
  }

  try {
    const [rows] = await pool.query('SELECT user_id, password FROM member WHERE user_id = ?', [userId]);
    if (!rows.length) {
      return res.status(404).json({ message: 'ไม่พบผู้ใช้งาน' });
    }
    const user = rows[0];

    //const requesterIsAdmin = Number(requester.perm_id ?? -1) >= (parseInt(process.env.ADMIN_PERM_LEVEL || '100', 10));

    if (user.password) {
      if (currentPassword) {
        if (!currentPassword || typeof currentPassword !== 'string') {
          return res.status(400).json({ message: 'กรุณากรอกรหัสผ่านปัจจุบัน' });
        }
        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) {
          return res.status(400).json({ message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
        }
      }
    }

    const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await pool.query('UPDATE member SET password = ?, current_token = NULL WHERE user_id = ?', [hashed, userId]);


    return res.json({ message: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว' });
  } catch (err) {
    console.error('change-password error:', err);
    return res.status(500).json({ message: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});


// แก้ไขอีเมล
router.patch('/change-email', JWTdecode, requireRole(1), async (req, res) => {
  const requester = req.user || {};
  const userId = Number(requester.user_id ?? requester.sub ?? requester.uid);

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ message: 'กรุณาระบุอีเมลใหม่' });
  }

  try {
    await pool.query(
      `UPDATE member SET email = ?, is_verified = 0 WHERE user_id = ?`,
      [email, userId]
    );

    return res.json({ message: 'อัปเดตอีเมลเรียบร้อยแล้ว' });

  } catch (err) {
    console.error('change-email error:', err);
    return res.status(500).json({ message: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

export default router;
