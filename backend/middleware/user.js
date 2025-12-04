import express from 'express';
import JWTdecode from './jwtdecode.js';
import pool from '../config/db.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import onlineStatusService from '../services/onlineStatusService.js';
dotenv.config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

async function assertActiveSessionOrThrow(user_id, sid) {
  const [rows] = await pool.query(
    `SELECT revoked, expires_at 
       FROM member_session 
      WHERE sid = ? AND user_id = ? 
      LIMIT 1`,
    [sid, user_id]
  );

  if (!rows.length) {
    const err = new Error('Session not found');
    err.status = 401;
    throw err;
  }
  const { revoked, expires_at } = rows[0];
  if (revoked === 1) {
    const err = new Error('Session revoked');
    err.status = 401;
    throw err;
  }
  if (expires_at && new Date(expires_at) < new Date()) {
    const err = new Error('Session expired');
    err.status = 401;
    throw err;
  }
}

router.get('/me', JWTdecode, async (req, res) => {
  try {
    const { user_id, sid } = req.user;

    // ตรวจสอบว่า session ยัง active
    await assertActiveSessionOrThrow(user_id, sid);

    // ดึงข้อมูลผู้ใช้ (เลิกใช้/เลือก current_token ออกไป)
    const [rows] = await pool.query(
      `SELECT 
  m.user_id, m.email, m.prefix, m.first_name, m.last_name,
  m.student_id, m.group_id, m.is_verified,
  g.group_name,                 
  p.perm_name, p.perm_level

FROM member AS m
JOIN permission AS p ON m.perm_id = p.perm_id
LEFT JOIN group_student AS g ON g.group_id = m.group_id
WHERE m.user_id = ?;
`,
      [user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // จะส่ง sid กลับไปด้วยก็ได้ ถ้าจำเป็นในฝั่ง client
    res.json({
      ...rows[0],
      sid,
    });
  } catch (err) {
    console.log(err);
    const status = err.status || 500;
    res.status(status).json({ message: err.message || 'Server error' });
  }
});

router.get('/online-users', JWTdecode, async (req, res) => {
  try {
    const { user_id, sid } = req.user;
    await assertActiveSessionOrThrow(user_id, sid);

    // ดึงข้อมูลผู้ใช้ออนไลน์จาก Redis
    const onlineUsers = await onlineStatusService.getOnlineUsers();
    
    // แปลงข้อมูลให้อยู่ในรูปแบบเดิมเพื่อความเข้ากันได้กับ frontend
    const users = onlineUsers.map(user => ({
      user_id: user.user_id,
      name: user.name,
      isOnline: true,
      last_seen: user.last_seen,
      is_active: user.is_active
    }));

    res.json({ users, count: users.length });
  } catch (e) {
    console.error('Error getting online users:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/access-logs', JWTdecode, async (req, res) => {
  try {
    const { user_id, sid } = req.user;
    console.log('Access logs requested for user ID:', user_id);

    if (!user_id) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    await assertActiveSessionOrThrow(user_id, sid);

    const [rows] = await pool.query(
      'SELECT * FROM accesslog WHERE user_id = ? ORDER BY timestamp DESC',
      [user_id]
    );

    res.json(rows);
  } catch (err) {
    console.log(err);
    const status = err.status || 500;
    res.status(status).json({ message: err.message || 'Server error' });
  }
});

// Heartbeat endpoint สำหรับอัพเดทสถานะออนไลน์
router.post('/heartbeat', JWTdecode, async (req, res) => {
  try {
    const { user_id, sid } = req.user;
    const { is_active = true } = req.body;

    // ตรวจสอบว่า session ยัง active
    await assertActiveSessionOrThrow(user_id, sid);

    // อัพเดท heartbeat ใน Redis
    const updated = await onlineStatusService.updateUserHeartbeat(user_id);
    
    if (updated) {
      // อัพเดทสถานะ activity ถ้ามีการส่งค่ามา
      if (typeof is_active === 'boolean') {
        await onlineStatusService.updateUserActivity(user_id, is_active);
      }
      
      res.json({
        success: true,
        message: 'Heartbeat updated successfully',
        timestamp: new Date().toISOString()
      });
    } else {
      // ถ้าอัพเดทไม่สำเร็จ ให้ลองเพิ่มผู้ใช้ใหม่
      const added = await onlineStatusService.addUserFromDatabase(user_id);
      if (added) {
        res.json({
          success: true,
          message: 'User added to online status',
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(500).json({ message: 'Failed to update heartbeat' });
      }
    }
  } catch (err) {
    console.error('Heartbeat error:', err);
    const status = err.status || 500;
    res.status(status).json({ message: err.message || 'Server error' });
  }
});

// Cleanup endpoint สำหรับทำความสะอาดข้อมูลผู้ใช้ที่หมดอายุ (admin only)
router.post('/cleanup', JWTdecode, async (req, res) => {
  try {
    const { user_id, sid } = req.user;
    
    // ตรวจสอบว่า session ยัง active
    await assertActiveSessionOrThrow(user_id, sid);

    // ตรวจสอบสิทธิ์ admin (สมมติว่า perm_level <= 2 คือ admin)
    const [userRows] = await pool.query(
      'SELECT perm_level FROM member WHERE user_id = ?',
      [user_id]
    );

    if (userRows.length === 0 || userRows[0].perm_level > 2) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const cleanedCount = await onlineStatusService.cleanupExpiredUsers();
    
    res.json({
      success: true,
      message: `Cleaned up ${cleanedCount} expired users`,
      cleaned_count: cleanedCount
    });
  } catch (err) {
    console.error('Cleanup error:', err);
    const status = err.status || 500;
    res.status(status).json({ message: err.message || 'Server error' });
  }
});

export default router;