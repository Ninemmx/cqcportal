import express from 'express';
import JWTdecode from '../middleware/jwtdecode.js';
import pool from '../config/db.js';
const router = express.Router();

router.post('/', JWTdecode, async (req, res) => {
  try {
    console.log('Cookies before clear:', req.cookies);
    const ipaddress = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const user_agent = req.headers['user-agent'] || 'unknown';
    const referrer = req.headers['referer'] || req.headers['referrer'] || 'unknown';

    console.log(`User ${req.user.user_id} logging out | IP: ${ipaddress} | User-Agent: ${user_agent} | Referrer: ${referrer}`);
  
    if (req.user.user_id) {
      await pool.query(
        'INSERT INTO accesslog (user_id, ip_address, action, user_agent, referrer) VALUES (?, ?, ?, ?, ?)',
        [req.user.user_id, ipaddress, 'logout', user_agent, referrer]
      );
      await pool.query('UPDATE member SET current_token = NULL WHERE user_id = ?', [req.user.user_id]);
    } else {
      console.warn('No user id found for logout log');
    }

    // Clear both token names with proper options
    const isProd = process.env.NODE_ENV === 'production';
    const baseOpts = isProd ? {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    } : {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    };

    res.clearCookie('token', baseOpts);
    res.clearCookie('__Host-token', baseOpts);
    
    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ message: 'เกิดข้อผิดพลาดในการออกจากระบบ' });
  }
});

export default router;