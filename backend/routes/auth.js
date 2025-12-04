import express from 'express';
import bcrypt from 'bcrypt';
import pool from '../config/db.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config();

const router = express.Router();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function signAccessToken({ user_id, sid }) {
  return jwt.sign(
    { sub: String(user_id), sid },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getClientInfo(req) {
  const ipRaw = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const ip = String(ipRaw).split(',')[0].trim();
  const ua = req.headers['user-agent'] || 'unknown';
  const referrer = req.headers['referer'] || req.headers['referrer'] || 'unknown';
  return { ip, ua, referrer };
}

function clearAuthCookiesAllPaths(res) {
  const isProd = process.env.NODE_ENV === 'production';
  const base = { httpOnly: true, sameSite: isProd ? 'none' : 'lax', secure: isProd };

  // Clear token for all paths
  for (const path of ['/', '/api']) {
    res.clearCookie('token', { ...base, path });
  }
  for (const domain of ['cqcportal.site', '.cqcportal.site']) {
    for (const path of ['/', '/api']) {
      res.clearCookie('token', { ...base, path, domain });
    }
  }
}

function setAuthCookies(res, { accessToken }) {
  console.log('setAuthCookies function called!');
  
  const isProd = process.env.NODE_ENV === 'production';
  const baseOpts = isProd ? {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    // ไม่ระบุ domain ให้ browser จัดการเอง
  } : {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
  };

  console.log('setAuthCookies - isProd:', isProd);
  console.log('setAuthCookies - DOMAIN:', process.env.DOMAIN);
  console.log('setAuthCookies - baseOpts:', baseOpts);
  console.log('setAuthCookies - Setting cookie with token:', accessToken.substring(0, 20) + '...');

  // ใช้ชื่อ cookie เดียวกันทุก environment เพื่อความสม่ำเสมอ
  res.cookie('token', accessToken, baseOpts);
  console.log('setAuthCookies - Main cookie set');
  
  // สำหรับ debugging - ลอง set cookie แบบไม่มี options เพิ่มเติม
  res.cookie('token_debug', accessToken, {
    httpOnly: false,
    secure: false,
    sameSite: 'lax',
    path: '/'
  });
  console.log('setAuthCookies - Debug cookie set');
}

async function logAccess(user_id, ip, action, user_agent, referrer) {
  try {
    await pool.query(
      'INSERT INTO accesslog (user_id, ip_address, action, user_agent, referrer, timestamp) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())',
      [user_id, ip, action, user_agent, referrer]
    );
  } catch (e) {
    console.error('accesslog error:', e.message);
  }
}

export async function authMiddleware(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : (req.cookies?.token || null);
    if (!token) return res.status(401).json({ message: 'Unauthenticated' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const sid = payload.sid;

    const [rows] = await pool.query(
      'SELECT revoked, expires_at FROM member_session WHERE sid = ? LIMIT 1',
      [sid]
    );
    if (!rows.length || rows[0].revoked === 1) {
      return res.status(401).json({ message: 'Session revoked' });
    }

    req.user = { id: Number(payload.sub), sid };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

// Helper function for retry mechanism
async function executeWithRetry(fn, maxRetries = 3, delay = 100) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries || !isRetryableError(err)) {
        throw err;
      }
      console.log(`Retry attempt ${attempt}/${maxRetries} for: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }
}

function isRetryableError(err) {
  return err.code === 'ER_LOCK_WAIT_TIMEOUT' ||
    err.code === 'ER_LOCK_DEADLOCK' ||
    err.code === 'ER_DEADLOCK_FOUND';
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { ip, ua, referrer } = getClientInfo(req);

  try {
    const [users] = await pool.query(
      `SELECT user_id, password, is_verified FROM member WHERE email = ? LIMIT 1`,
      [email]
    );

    if (!users.length) {
      return res.status(401).json({ message: 'ไม่พบบัญชีผู้ใช้' });
    }

    const user = users[0];
    /* if (!user.is_verified) {
       return res.status(403).json({ message: 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ' });
     }*/

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }

    // Use retry mechanism for session revocation
    await executeWithRetry(async () => {
      await pool.query(
        'UPDATE member_session SET revoked = 1 WHERE user_id = ? AND revoked = 0',
        [user.user_id]
      );
    });

    const sid = crypto.randomUUID();
    const expiresAt = addDays(new Date(), 1);

    await pool.query(
      `INSERT INTO member_session (sid, user_id, user_agent, ip_address, revoked, expires_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      [sid, user.user_id, ua, ip, expiresAt]
    );

    const accessToken = signAccessToken({ user_id: user.user_id, sid });
    console.log('Login - Generated token:', accessToken.substring(0, 20) + '...');
    console.log('Login - About to call setAuthCookies...');
    
    try {
      setAuthCookies(res, { accessToken });
      console.log('Login - setAuthCookies called successfully');
    } catch (err) {
      console.error('Login - setAuthCookies error:', err);
    }

    await pool.query(`UPDATE member SET current_token = ? WHERE user_id = ?`, [accessToken, user.user_id]);

    await logAccess(user.user_id, ip, 'login', ua, referrer);

    console.log(`UserID: ${user.user_id} Login success!`);
    res.status(200).json({ message: 'เข้าสู่ระบบสำเร็จ' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ' });
  }
});



router.post('/logout', async (req, res) => {
  try {
    let sid = null;
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : (req.cookies?.token || null);
    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        sid = payload.sid;
      } catch { }
    }

    if (sid) {
      await pool.query('UPDATE member_session SET revoked = 1 WHERE sid = ?', [sid]);
    }

    // Clear token with proper options
    const isProd = process.env.NODE_ENV === 'production';
    const baseOpts = isProd ? {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      // ไม่ระบุ domain ให้ browser จัดการเอง
    } : {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    };

    res.clearCookie('token', baseOpts);

    res.status(200).json({ message: 'ออกจากระบบสำเร็จ' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ' });
  }
});

export default router;