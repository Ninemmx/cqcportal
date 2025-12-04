// middleware/checkRole.js
import pool from '../config/db.js';

export function requireRole(minPermLevel) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      // join member กับ permission
      const [rows] = await pool.query(
        `SELECT p.perm_level, p.perm_name
           FROM member m
           JOIN permission p ON m.perm_id = p.perm_id
          WHERE m.user_id = ?
          LIMIT 1`,
        [userId]
      );


      if (!rows.length) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { perm_level } = rows[0];

      if (perm_level < minPermLevel) {
        return res.status(403).json({ message: 'Permission denied' });
      }

      // inject เพิ่มลง req.user
      if (!req.user) req.user = {};
      req.user.perm_level = perm_level;

      next();
    } catch (err) {
      console.error('Authorization error:', err.message || err);
      res.status(500).json({ message: 'Authorization check failed' });
    }
  };
}
