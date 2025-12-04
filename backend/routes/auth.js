// routes/auth.js
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';

const router = express.Router();

const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES || '15m';
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES || '7d';

function generateAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      // ถ้ามี role/อื่น ๆ ใส่เพิ่มได้ เช่น role: user.role
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRES_IN }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES_IN }
  );
}

/**
 * POST /auth/login
 * body: { email, password }
 *
 * สมมติว่าใน DB มี table users:
 *   id INT
 *   email VARCHAR
 *   password_hash VARCHAR (เก็บ bcrypt hash)
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ message: 'กรุณากรอก email และ password ให้ครบ' });
  }

  try {
    const [rows] = await db.query(
      'SELECT user_id, email, password FROM member WHERE email = ? LIMIT 1',
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }

    const user = rows[0];

    // เทียบ password ที่กรอกกับ hash ใน DB
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // เก็บ refresh token ลง table refresh_tokens
    // ต้องมีตารางแบบนี้คร่าว ๆ:
    // id, user_id, token, expires_at, created_at
    await db.query(
      `
        INSERT INTO refresh_tokens (user_id, token, expires_at)
        VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))
      `,
      [user.user_id, refreshToken]
    );

    return res.json({
      message: 'login สำเร็จ',
      user: {
        id: user.id,
        email: user.email,
      },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'มีข้อผิดพลาดภายในระบบ' });
  }
});

/**
 * POST /auth/refresh
 * body: { refreshToken }
 *
 * ใช้ refreshToken เพื่อขอ accessToken ใหม่ (และ refreshToken ใหม่)
 */
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ message: 'ไม่มี refreshToken' });
  }

  let payload;
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch (err) {
    return res
      .status(401)
      .json({ message: 'refreshToken ไม่ถูกต้องหรือหมดอายุแล้ว' });
  }

  const userId = payload.id;

  try {
    // เช็คว่ามี refreshToken นี้อยู่ใน DB จริงไหม และยังไม่หมดอายุ
    const [rows] = await db.query(
      `
        SELECT * FROM refresh_tokens
        WHERE user_id = ? AND token = ? AND expires_at > NOW()
        LIMIT 1
      `,
      [userId, refreshToken]
    );

    if (rows.length === 0) {
      return res
        .status(401)
        .json({ message: 'refreshToken ถูกเพิกถอนแล้ว หรือหมดอายุ' });
    }

    // rotate token: ลบตัวเก่าออกก่อน
    await db.query(
      'DELETE FROM refresh_tokens WHERE user_id = ? AND token = ?',
      [userId, refreshToken]
    );

    const userForToken = {
      id: payload.id,
      email: payload.email,
    };

    const newAccessToken = generateAccessToken(userForToken);
    const newRefreshToken = generateRefreshToken(userForToken);

    // เก็บ refresh token ใหม่
    await db.query(
      `
        INSERT INTO refresh_tokens (user_id, token, expires_at)
        VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))
      `,
      [userId, newRefreshToken]
    );

    return res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ message: 'มีข้อผิดพลาดภายในระบบ' });
  }
});

/**
 * POST /auth/logout
 * body: { refreshToken }
 *
 * ลบ refreshToken ทิ้ง = logout
 */
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ message: 'ไม่มี refreshToken' });
  }

  try {
    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      // ถ้า verify ไม่ผ่าน (หมดอายุ/ปลอม) จะพยายามลบจาก DB ด้วย token อย่างเดียว
      payload = null;
    }

    if (payload) {
      await db.query(
        'DELETE FROM refresh_tokens WHERE user_id = ? AND token = ?',
        [payload.id, refreshToken]
      );
    } else {
      await db.query('DELETE FROM refresh_tokens WHERE token = ?', [
        refreshToken,
      ]);
    }

    return res.json({ message: 'logout สำเร็จ' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ message: 'มีข้อผิดพลาดภายในระบบ' });
  }
});

export default router;
