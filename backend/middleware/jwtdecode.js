// JWTdecode.js
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import pool from '../config/db.js';
dotenv.config();

export default async function JWTdecode(req, res, next) {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    const cookieName = isProd ? '__Host-token' : 'token';

    const token =
      req.cookies?.[cookieName] ||
      (req.headers.authorization || '').split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'Token missing' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user_id = Number(decoded.sub || decoded.user_id);
    const sid = decoded.sid;

    if (!user_id || !sid) {
      return res.status(400).json({ message: 'Invalid token payload' });
    }

    // เช็คว่า session นี้ยัง active อยู่ไหม (สำคัญมาก)
    const [rows] = await pool.query(
      `SELECT revoked, expires_at
         FROM member_session
        WHERE sid = ? AND user_id = ?
        LIMIT 1`,
      [sid, user_id]
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'Session not found' });
    }
    const { revoked, expires_at } = rows[0];
    if (revoked === 1) {
      return res.status(401).json({ message: 'Session revoked' });
    }
    if (expires_at && new Date(expires_at) < new Date()) {
      return res.status(401).json({ message: 'Session expired' });
    }

    req.user = { user_id, sid, iat: decoded.iat, exp: decoded.exp };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Access token expired' });
    }
    return res.status(403).json({ message: 'Invalid token' });
  }
}
