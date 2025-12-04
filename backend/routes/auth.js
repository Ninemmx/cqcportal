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

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

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

router.post('/register', async (req, res) => {
  const { email, studentId, prefix, firstName, lastName, password } = req.body;

  if (!email || !studentId || !prefix || !firstName || !lastName || !password) {
    return res
      .status(400)
      .json({ message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  try {
    const [emailRows] = await db.query(
      'SELECT user_id FROM member WHERE email = ? LIMIT 1',
      [email]
    );

    if (emailRows.length > 0) {
      return res.status(400).json({ message: 'อีเมลนี้ถูกใช้งานแล้ว' });
    }

    const [studentIdRows] = await db.query(
      'SELECT user_id FROM member WHERE student_id = ? LIMIT 1',
      [studentId]
    );

    if (studentIdRows.length > 0) {
      return res.status(400).json({ message: 'รหัสนักศึกษานี้ถูกใช้งานแล้ว' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const [result] = await db.query(
      `INSERT INTO member (email, student_id, prefix, first_name, last_name, password, created_at, perm_id, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), 2, 0)`,
      [email, studentId, title, firstName, lastName, hashedPassword]
    );

    return res.status(201).json({
      message: 'สมัครสมาชิกสำเร็จ',
      user: {
        id: result.insertId,
        email,
        studentId,
        title,
        firstName,
        lastName
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ message: 'มีข้อผิดพลาดภายในระบบ' });
  }
});

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
