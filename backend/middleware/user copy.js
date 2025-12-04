import express from 'express';
import JWTdecode from './jwtdecode.js'
import pool from '../config/db.js';

const router = express.Router();

router.get('/me', JWTdecode, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT m.user_id, m.email, m.prefix, m.first_name, m.last_name, m.student_id, m.group_id, m.current_token, p.perm_name, p.perm_level
       FROM member AS m 
       JOIN permission AS p ON m.perm_id = p.perm_id
       WHERE m.user_id = ?`,
      [req.user.user_id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });
    const user = rows[0];

    if (user.current_token == null) {
      return res.status(401).json({ message: 'Session expired' });
    }

    res.json(user);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/access-logs', JWTdecode, async (req, res) => {
  const { user_id } = req.user;  

  console.log("Access logs requested for user ID:", user_id);

  if (!user_id) {
    return res.status(400).json({ message: 'User ID is required' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM accesslog WHERE user_id = ?', [user_id]);
    if (rows.length === 0) return res.status(404).json({ message: 'No access logs found' });
    res.json(rows);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
