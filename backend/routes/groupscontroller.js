import express, { Router } from 'express';
import pool from '../config/db.js';
import { log } from 'console';
import JWTdecode from '../middleware/jwtdecode.js'
import { requireRole } from '../middleware/checkRole.js';
const router = express.Router();
router.use(express.json());

// ดึงรายชื่อกลุ่มเรียนทั้งหมด
router.get('/', JWTdecode, async (req, res) => {
  try {
    const user = req.user;
    const userId = user.user_id;
    const [userData] = await pool.query(
      `SELECT p.perm_level 
       FROM member m
       JOIN permission p ON m.perm_id = p.perm_id 
       WHERE m.user_id = ?`, 
      [userId]
    );

    const permLevel = userData[0] ? Number(userData[0].perm_level) : 0;

    let sql = `
      SELECT 
        g.group_id, 
        g.group_name, 
        g.group_password, 
        g.group_status, 
        g.created_by,
        creator.prefix AS creator_prefix,
        creator.first_name AS creator_firstname,
        creator.last_name AS creator_lastname,
        COUNT(m.user_id) AS member_count
      FROM group_student g
      LEFT JOIN member creator ON g.created_by = creator.user_id 
      LEFT JOIN member m ON g.group_id = m.group_id
    `;

    const sqlParams = [];

    if (permLevel === 3) {
      sql += ` WHERE g.created_by = ? `;
      sqlParams.push(userId);
    }
    
    sql += ` GROUP BY g.group_id ORDER BY g.group_name ASC `;

    const [rows] = await pool.query(sql, sqlParams);

    res.json(rows);

  } catch (error) {
    console.error('ดึงข้อมูล groupstudent ล้มเหลว:', error.message || error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูลกลุ่มเรียน' });
  }
});


router.get('/getusergroupdata', JWTdecode, requireRole(1), async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ message: 'กรุณาระบุ user_id' });
    }

    const [rows] = await pool.query(
      `SELECT g.group_id, g.group_name, g.created_by
             FROM group_student AS g
             JOIN member AS ug ON g.group_id = ug.group_id
             WHERE ug.user_id = ?`,
      [user_id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ดึงรายชื่อสมาชิกเฉพาะกลุ่มเรียน
router.get('/getuseringroup', JWTdecode, requireRole(2), async (req, res) => {
  try {
    const { group_id } = req.query;

    if (!group_id) {
      return res.status(400).json({ message: 'การดึงรหัสกลุ่มมีความผิดพลาด' });
    }

    const [rows] = await pool.query(
      `SELECT user_id, prefix, first_name, last_name, email, student_id
             FROM member
             WHERE group_id = ?`,
      [group_id]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// เพิ่มกลุ่มเรียน
router.post('/', JWTdecode, requireRole(3), async (req, res) => {
  const { group_name, group_password, group_status } = req.body;
  const user_id = req.user.user_id;   
  if (!user_id) {
    return res.status(400).json({ message: 'ไม่พบ UID ของผู้ใช้' });
  }
  if (!group_name || !group_password) {
    return res.status(400).json({ message: 'กรุณากรอกชื่อกลุ่มและรหัสผ่าน' });
  }

  try {
    const [check] = await pool.query(
      'SELECT group_id FROM group_student WHERE group_name = ? LIMIT 1',
      [group_name]
    );
    if (check.length > 0) {
      return res.status(409).json({ message: 'ชื่อกลุ่มนี้ถูกใช้ไปแล้ว' });
    }

    const ip_address =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown';
    const user_agent = req.headers['user-agent'] || 'unknown';
    const referrer =
      req.headers['referer'] || req.headers['referrer'] || 'unknown';

    const [result] = await pool.query(
      'INSERT INTO group_student (group_name, group_password, group_status, created_by) VALUES (?, ?, ?, ?)',
      [group_name, group_password, group_status ?? 1, user_id]
    );

    await pool.query(
      `INSERT INTO accesslog 
        (user_id, ip_address, action, user_agent, referrer, timestamp) 
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [user_id, ip_address, 'create_group', user_agent, referrer]
    );

    res
      .status(201)
      .json({ message: 'สร้างกลุ่มเรียนสำเร็จ', groupID: result.insertId });
  } catch (error) {
    console.error('Create group error:', error);
    res
      .status(500)
      .json({ message: 'ไม่สามารถสร้างกลุ่มเรียนได้', error: error.message });
  }
});

// นักศึกษาออกจากกลุ่ม
router.put('/leavegroup', JWTdecode, async (req, res) => {
  try {
    const uid = req.user.user_id;
    console.log('User ID from token:', uid);
    if (!uid) {
      return res.status(400).json({ message: 'ไม่พบ UID ของผู้ใช้' });
    }
    console.log(`UID:${uid} leave grouped!`);
    const ip_address = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const user_agent = req.headers['user-agent'] || 'unknown';
    const referrer = req.headers['referer'] || req.headers['referrer'] || 'unknown';


    await pool.query('UPDATE member SET group_id = null WHERE user_id = ?', [uid]);

    await pool.query(
      'INSERT INTO accesslog (user_id, ip_address, action, user_agent, referrer, timestamp) VALUES (?, ?, ?, ?, ?, NOW())',
      [uid, ip_address, 'leave_group', user_agent, referrer]
    );
    res.status(200).json({ message: 'ออกจากกลุ่มเรียนสำเร็จ' });
  } catch (error) {
    console.error(error.message || error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'เกิดข้อผิดพลาดในเซิฟเวอร์' });
    }
  }
});

// แก้ไขกลุ่มเรียน
router.put('/:id', JWTdecode, requireRole(3), async (req, res) => {
  const { group_name, group_password, group_status } = req.body;
  const { id } = req.params;
  const user_id = req.user.user_id;

  const ip_address =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown';
  const user_agent = req.headers['user-agent'] || 'unknown';
  const referrer =
    req.headers['referer'] || req.headers['referrer'] || 'unknown';

  try {
    const [group] = await pool.query(
      'SELECT group_id FROM group_student WHERE group_id = ? LIMIT 1',
      [id]
    );
    if (!group.length) {
      return res.status(404).json({ message: 'ไม่พบกลุ่มที่ต้องการแก้ไข' });
    }

    const [result] = await pool.query(
      'UPDATE group_student SET group_name = ?, group_password = ?, group_status = ? WHERE group_id = ?',
      [group_name, group_password, group_status ?? 0, id]
    );
    if (result.affectedRows === 0) {
      return res.status(400).json({ message: 'ไม่มีการเปลี่ยนแปลงข้อมูล' });
    }

    await pool.query(
      `INSERT INTO accesslog 
        (user_id, ip_address, action, user_agent, referrer, timestamp) 
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [user_id, ip_address, 'update_group', user_agent, referrer]
    );

    res.json({ message: 'อัปเดตกลุ่มเรียนสำเร็จ' });
  } catch (error) {
    console.error('Update Error:', error.message || error);
    res.status(500).json({ message: 'ไม่สามารถอัปเดตกลุ่มเรียนได้' });
  }
});

// อัพเดตสถานะการใช้งาน
router.patch('/:id', JWTdecode, requireRole(3), async (req, res) => {
  const { id } = req.params;
  const { group_active } = req.body;
  try {
    await pool.query(
      "UPDATE groupstudent SET group_active = ? WHERE groupID = ?",
      [group_active, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Database Error:", err);
    res.status(500).json({ error: err.message || "Database update failed" });
  }
});

// ลบกลุ่มเรียน
router.delete('/:id', JWTdecode, requireRole(3), async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.user_id;

  const ip_address =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown';
  const user_agent = req.headers['user-agent'] || 'unknown';
  const referrer =
    req.headers['referer'] || req.headers['referrer'] || 'unknown';

  try {
    const [result] = await pool.query(
      'DELETE FROM group_student WHERE group_id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'ไม่พบกลุ่มที่ต้องการลบ' });
    }

    await pool.query(
      `INSERT INTO accesslog 
        (user_id, ip_address, action, user_agent, referrer, timestamp) 
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [user_id, ip_address, 'delete_group', user_agent, referrer]
    );

    res.json({ message: 'ลบกลุ่มเรียนสำเร็จ' });
  } catch (error) {
    console.error('Delete Error:', error.message || error);
    res.status(500).json({ message: 'ไม่สามารถลบกลุ่มเรียนได้' });
  }
});


router.get('/:groupID/members', JWTdecode, requireRole(2), async (req, res) => {
  const { groupID } = req.params;
  try {
    const [members] = await pool.query(
      'SELECT user_id, prefix, first_name, last_name, student_id, group_id, email FROM member WHERE group_id = ?',
      [groupID]
    );
    res.json(members);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูลสมาชิก' });
  }
});

router.post('/joingroup', JWTdecode, requireRole(1), async (req, res) => {
  try {
    const { user_id, group_id, group_password } = req.body;
    const ip_address = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const user_agent = req.headers['user-agent'] || 'unknown';
    const referrer = req.headers['referer'] || req.headers['referrer'] || 'unknown';

    if (!user_id || !group_id || !group_password) {
      return res.status(400).json({ message: 'ข้อมูลไม่ครบถ้วน' });
    }

    const [group] = await pool.query('SELECT * FROM group_student WHERE group_id = ?', [group_id]);
    if (!group || group.length === 0) {
      return res.status(404).json({ message: 'ไม่พบกลุ่มเรียน' });
    }

    if (group[0].group_password !== group_password) {
      return res.status(400).json({ message: 'รหัสผ่านไม่ถูกต้อง' });
    }

    await pool.query('UPDATE member SET group_id = ? WHERE user_id = ?', [group_id, user_id]);


    await pool.query(
      'INSERT INTO accesslog (user_id, ip_address, action, user_agent, referrer) VALUES (?, ?, ?, ?, ?)',
      [user_id, ip_address, 'join_group', user_agent, referrer]
    );

    res.json({ message: `เข้าร่วมกลุ่มเรียนสำเร็จ` });
  } catch (error) {
    console.error(error.message || error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
    }
  }
});

//API สำหรับ Toggle เปิด/ปิด สถานะกลุ่มเรียน
router.put('/:id/toggle', JWTdecode, requireRole(3), async (req, res) => {
  const { id } = req.params;
  const { group_status } = req.body;

  try {
    const statusValue = group_status ? 1 : 0;

    const [result] = await pool.query(
      "UPDATE group_student SET group_status = ? WHERE group_id = ?",
      [statusValue, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'ไม่พบกลุ่มเรียน' });
    }

    const ip_address = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    await pool.query(
      `INSERT INTO accesslog (user_id, ip_address, action, user_agent, referrer, timestamp) VALUES (?, ?, ?, ?, ?, NOW())`,
      [req.user.user_id, ip_address, 'toggle_group_status', req.headers['user-agent'] || 'unknown', req.headers['referer'] || 'unknown']
    );

    res.json({ success: true, message: 'อัปเดตสถานะสำเร็จ' });
  } catch (error) {
    console.error("Database Error:", error);
    res.status(500).json({ message: error.message || "Update failed" });
  }
});

export default router;
